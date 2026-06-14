const fs = require('fs');
const path = require('path');

const AI_API_URL = process.env.AI_API_URL || 'https://opencode.ai/zen/go';
const AI_API_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || 'deepseek-v4-pro';
const AI_VISION_MODEL = process.env.AI_VISION_MODEL;
const MAX_TOKENS = 16000;

const TOKEN_LOG_PATH = path.join('/app/logs', 'ai_tokens.jsonl');

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Modelos que usan endpoint Anthropic (/messages) en vez de OpenAI (/chat/completions)
const ANTHROPIC_FORMAT_PREFIXES = ['minimax', 'qwen'];

function getApiFormat(model) {
  const lower = (model || '').toLowerCase();
  return ANTHROPIC_FORMAT_PREFIXES.some(p => lower.startsWith(p)) ? 'anthropic' : 'openai';
}

function logTokenUsage({ subject, completionTokens, contentWasEmpty, hitLimit }) {
  const entry = {
    ts: new Date().toISOString(),
    subject: subject.slice(0, 60),
    model: AI_MODEL,
    maxTokens: MAX_TOKENS,
    completionTokens,
    contentWasEmpty,
    hitLimit,
  };

  if (hitLimit) {
    console.warn(
      `[AI TOKEN LIMIT] max_tokens=${MAX_TOKENS} alcanzado. ` +
      `Asunto: "${entry.subject}". Sube MAX_TOKENS en aiService.js.`
    );
  } else if (completionTokens && completionTokens / MAX_TOKENS > 0.8) {
    console.warn(
      `[AI TOKEN WARNING] ${Math.round(completionTokens / MAX_TOKENS * 100)}% del límite usado ` +
      `(${completionTokens}/${MAX_TOKENS}). Asunto: "${entry.subject}".`
    );
  }

  try {
    fs.appendFileSync(TOKEN_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('Error escribiendo token log:', err.message);
  }
}

// Analiza el historial de tokens y retorna un diagnóstico con recomendaciones.
function checkTokenHealth() {
  try {
    if (!fs.existsSync(TOKEN_LOG_PATH)) return null;
    const lines = fs.readFileSync(TOKEN_LOG_PATH, 'utf8')
      .split('\n').filter(Boolean).map(l => JSON.parse(l));

    if (lines.length === 0) return null;

    // Solo entradas del límite actual (descartar runs anteriores con distinto MAX_TOKENS)
    const recent = lines.filter(l => l.maxTokens === MAX_TOKENS).slice(-50);
    const tokens = recent.map(l => l.completionTokens).filter(Number.isFinite);
    if (tokens.length === 0) return null;

    const avg = Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length);
    const max = Math.max(...tokens);
    const sorted = [...tokens].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    const hitLimitCount = recent.filter(l => l.hitLimit).length;
    const nearLimitCount = recent.filter(l => l.completionTokens && l.completionTokens / MAX_TOKENS > 0.8).length;
    // Si hay emails cortados, el max observado es el límite (no el real) → recomendar MAX_TOKENS * 2
    const recommended = hitLimitCount > 0
      ? Math.ceil(MAX_TOKENS * 2)
      : Math.ceil(p90 * 1.3);
    const status = hitLimitCount > 0 ? 'critical' : nearLimitCount > 2 ? 'warning' : 'ok';

    return {
      status,
      currentMaxTokens: MAX_TOKENS,
      recentSamples: tokens.length,
      avgTokens: avg,
      maxTokens: max,
      p90Tokens: p90,
      recommendedMaxTokens: recommended,
      hitLimitCount,
      nearLimitCount,
      needsIncrease: recommended > MAX_TOKENS,
      message: status === 'critical'
        ? `⛔ ${hitLimitCount} correo(s) cortados. Sube MAX_TOKENS a ${recommended} en aiService.js.`
        : status === 'warning'
        ? `⚠️ ${nearLimitCount} correo(s) usaron >80% del límite. Considera subir MAX_TOKENS a ${recommended}.`
        : `✅ Uso saludable. Promedio: ${avg} tokens, máximo: ${max}, límite: ${MAX_TOKENS}.`,
    };
  } catch (err) {
    console.error('Error en checkTokenHealth:', err.message);
    return null;
  }
}

function getTokenStats() {
  try {
    if (!fs.existsSync(TOKEN_LOG_PATH)) return null;
    const lines = fs.readFileSync(TOKEN_LOG_PATH, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));

    if (lines.length === 0) return null;

    const tokens = lines.map(l => l.completionTokens).filter(Number.isFinite);
    const avg = Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length);
    const max = Math.max(...tokens);
    const hitLimitCount = lines.filter(l => l.hitLimit).length;
    const emptyContentCount = lines.filter(l => l.contentWasEmpty).length;

    return {
      calls: lines.length,
      avgCompletionTokens: avg,
      maxCompletionTokens: max,
      currentMaxTokens: MAX_TOKENS,
      recommendedMaxTokens: Math.ceil(max * 1.2),
      hitLimitCount,
      emptyContentCount,
      since: lines[0]?.ts,
    };
  } catch (err) {
    console.error('Error leyendo token stats:', err.message);
    return null;
  }
}

function formatScheduleForPrompt(schedule) {
  if (!schedule || schedule.length === 0) return null;

  const byDay = {};
  for (const entry of schedule) {
    const day = entry.day_of_week;
    if (!byDay[day]) byDay[day] = {};
    const subj = entry.subject;
    if (!byDay[day][subj] || entry.start_time < byDay[day][subj]) {
      byDay[day][subj] = entry.start_time;
    }
  }

  return Object.entries(byDay)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([day, subjects]) => {
      const subjList = Object.entries(subjects)
        .sort(([, a], [, b]) => (a || '').localeCompare(b || ''))
        .map(([subj, time]) => (time ? `${subj} (${time.slice(0, 5)})` : subj))
        .join(', ');
      return `  ${DAY_NAMES[Number(day)]}: ${subjList}`;
    })
    .join('\n');
}

// Llama a la API según el formato que necesita el modelo (OpenAI o Anthropic).
// Siempre recibe mensajes en formato OpenAI y retorna { content, completionTokens, finishReason }.
async function callAI(messages, { maxTokens = MAX_TOKENS, model = AI_MODEL } = {}) {
  if (!AI_API_KEY) {
    throw new Error('AI_API_KEY not configured');
  }

  const format = getApiFormat(model);

  if (format === 'anthropic') {
    // Convertir mensajes OpenAI → Anthropic
    // Los mensajes de sistema van en el campo top-level "system"
    const systemMsg = messages.find(m => m.role === 'system');
    const userMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => {
        // Si el content es array (multimodal), convertir image_url → Anthropic image source
        if (Array.isArray(m.content)) {
          return {
            role: m.role,
            content: m.content.map(block => {
              if (block.type === 'image_url') {
                const url = block.image_url?.url || '';
                const base64Match = url.match(/^data:(.+?);base64,(.+)$/);
                if (base64Match) {
                  return {
                    type: 'image',
                    source: { type: 'base64', media_type: base64Match[1], data: base64Match[2] },
                  };
                }
                return { type: 'image', source: { type: 'url', url } };
              }
              return block;
            }),
          };
        }
        return m;
      });

    const body = { model, max_tokens: maxTokens, messages: userMessages };
    if (systemMsg) body.system = typeof systemMsg.content === 'string' ? systemMsg.content : systemMsg.content[0]?.text;

    const response = await fetch(`${AI_API_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': AI_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`AI API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    const content = data.content?.find(b => b.type === 'text')?.text || '';
    return {
      content,
      completionTokens: data.usage?.output_tokens ?? null,
      finishReason: data.stop_reason || null,
    };
  }

  // Formato OpenAI (/chat/completions)
  const response = await fetch(`${AI_API_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: maxTokens }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const rawContent = choice?.message?.content || '';
  // DeepSeek reasoning models pueden devolver content vacío con el texto en reasoning_content
  const content = rawContent || choice?.message?.reasoning_content || '';

  return {
    content,
    completionTokens: data.usage?.completion_tokens ?? null,
    finishReason: choice?.finish_reason || null,
  };
}

async function processEmail(subject, snippet, emailDate, schedule) {
  if (!AI_API_KEY) {
    console.warn('AI_API_KEY not configured, skipping AI processing');
    return { extractedDate: null, type: null, summary: null, model: null };
  }

  try {
    const emailDateObj = emailDate ? new Date(emailDate) : new Date();
    const emailDayName = DAY_NAMES[emailDateObj.getDay() === 0 ? 6 : emailDateObj.getDay() - 1];

    const scheduleText = formatScheduleForPrompt(schedule);
    const scheduleSection = scheduleText
      ? `\nHorario semanal del alumno:\n${scheduleText}\n\nUsa este horario para resolver referencias como "siguiente clase de [materia]" o "próxima clase". Calcula la fecha real a partir de la fecha del correo.`
      : '';

    const prompt = `Analiza este correo escolar chileno y extrae información estructurada para los apoderados.

CORREO:
Asunto: ${subject}
Fecha: ${emailDateObj.toISOString().slice(0, 10)} (${emailDayName})
Contenido: ${snippet}
${scheduleSection}

TAREA: Razona brevemente y luego entrega el JSON final.

Paso 1 — Detectar evento o acción:
- ¿El correo exige alguna acción del alumno o apoderado? (prueba, entrega, reunión, traer algo)
- ¿Menciona una fecha concreta, relativa ("próximo viernes") o implícita ("la siguiente clase de [materia]")?
- Si es relativa, calcula la fecha real usando la fecha del correo y el horario si está disponible.

Paso 2 — Clasificar tipo:
- "tarea": prueba, control, evaluación, entrega, investigación, traer materiales para una clase específica
- "reunion": asistencia presencial de padres/apoderados (entrevistas, asambleas, citaciones, PAEC)
- "aviso": información general sin acción requerida (comunicados, links, recordatorios sin fecha)
- "otro": no encaja en ninguna categoría anterior

Paso 3 — Resumir para el apoderado en 1-2 oraciones directas: QUÉ + CUÁNDO (si aplica) + QUÉ HACER.

RESPONDE ÚNICAMENTE con el siguiente JSON válido, sin markdown ni texto adicional:
{"eventDate":"YYYY-MM-DDTHH:mm:ss o null","type":"tarea|reunion|aviso|otro","summary":"resumen para el apoderado"}

Notas sobre eventDate:
- Incluir hora si se menciona (ej: 2026-05-10T09:40:00)
- Si no hay fecha de evento, usar null (no inventar fechas)
- Formato: fecha local de Chile sin zona horaria`;

    const { content, completionTokens, finishReason } = await callAI(
      [{ role: 'user', content: prompt }],
    );

    const contentWasEmpty = !content.trim();
    const hitLimit = finishReason === 'length' || finishReason === 'max_tokens';
    logTokenUsage({ subject, completionTokens, contentWasEmpty, hitLimit });

    let parsed;
    try {
      parsed = JSON.parse(content.trim());
    } catch {
      // Intentar extraer JSON desde bloque markdown (```json ... ```) o texto libre
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
                        content.match(/(\{[\s\S]*"type"[\s\S]*?\})/);
      if (!jsonMatch) {
        console.warn(`Failed to extract JSON from response for: ${subject}`);
        return { extractedDate: null, type: null, summary: null, model: AI_MODEL };
      }
      try {
        parsed = JSON.parse((jsonMatch[1] || jsonMatch[0]).trim());
      } catch {
        console.warn(`Failed to parse extracted JSON for: ${subject}`);
        return { extractedDate: null, type: null, summary: null, model: AI_MODEL };
      }
    }

    let extractedDate = null;
    if (parsed.eventDate) {
      const raw = String(parsed.eventDate).trim();
      const d = new Date(raw);
      // Shift date-only strings to noon UTC so the event lands on the correct
      // local day in Chile (UTC-3/UTC-4).
      const hasNoTime = !raw.includes('T') || /T00:00(:00)?(Z|[+-]00:00)?$/.test(raw);
      if (hasNoTime) {
        d.setUTCHours(12, 0, 0, 0);
      }
      extractedDate = d;
    }

    return { extractedDate, type: parsed.type || 'otro', summary: parsed.summary || null, model: AI_MODEL };
  } catch (err) {
    console.error('Error calling AI API:', err.message);
    return { extractedDate: null, type: null, summary: null, model: null };
  }
}

// Fetches a Drive file thumbnail and describes it using a vision-capable model.
async function analyzeImage(driveFileId, accessToken) {
  if (!AI_VISION_MODEL || !AI_API_KEY || !accessToken) return null;

  try {
    const thumbnailUrl = `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w1200`;
    const imgRes = await fetch(thumbnailUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!imgRes.ok) return null;

    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

    const { content } = await callAI([{
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Esta imagen es material escolar. Extrae y describe en español: fechas, materia, contenidos, temas de evaluación, cualquier texto visible. Sé conciso.',
        },
        {
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${base64}` },
        },
      ],
    }], { maxTokens: 500, model: AI_VISION_MODEL });

    return content || null;
  } catch (err) {
    console.error('Error in analyzeImage:', err.message);
    return null;
  }
}

module.exports = { processEmail, getTokenStats, analyzeImage, callAI, checkTokenHealth };
