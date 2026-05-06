const fs = require('fs');
const path = require('path');

const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'https://ollama.com';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3-vl:235b-instruct';
const MAX_TOKENS = 800;

const TOKEN_LOG_PATH = path.join('/app/logs', 'ollama_tokens.jsonl');

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function logTokenUsage({ subject, completionTokens, contentWasEmpty, hitLimit }) {
  const entry = {
    ts: new Date().toISOString(),
    subject: subject.slice(0, 60),
    model: OLLAMA_MODEL,
    maxTokens: MAX_TOKENS,
    completionTokens,
    contentWasEmpty,
    hitLimit,
  };

  if (hitLimit) {
    console.warn(
      `[OLLAMA TOKEN LIMIT] max_tokens=${MAX_TOKENS} alcanzado. ` +
      `Asunto: "${entry.subject}". Ajusta MAX_TOKENS en ollamaService.js.`
    );
  }

  try {
    fs.appendFileSync(TOKEN_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('Error escribiendo token log:', err.message);
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

async function processEmail(subject, snippet, emailDate, schedule) {
  if (!OLLAMA_API_KEY) {
    console.warn('OLLAMA_API_KEY not configured, skipping AI processing');
    return { extractedDate: null, type: null, summary: null, model: null };
  }

  try {
    const emailDateObj = emailDate ? new Date(emailDate) : new Date();
    const emailDayName = DAY_NAMES[emailDateObj.getDay() === 0 ? 6 : emailDateObj.getDay() - 1];

    const scheduleText = formatScheduleForPrompt(schedule);
    const scheduleSection = scheduleText
      ? `\nHorario semanal del alumno:\n${scheduleText}\n\nUsa este horario para resolver referencias como "siguiente clase de [materia]" o "próxima clase". Calcula la fecha real a partir de la fecha del correo.`
      : '';

    const prompt = `Eres un experto analizando comunicaciones escolares en Chile. Analiza este correo y responde con JSON.

Asunto: ${subject}
Contenido: ${snippet}
Fecha del correo: ${emailDateObj.toISOString().slice(0, 10)} (${emailDayName})
${scheduleSection}

Responde SOLO con JSON válido, sin markdown, sin explicaciones, sin texto adicional:
{"eventDate":"ISO-datetime o null","type":"reunion|tarea|aviso|otro","summary":"1-2 oraciones para padres"}

REGLAS para eventDate:
- Si dicen "próximo martes/viernes/etc", calcula la fecha real desde la fecha del correo
- Si dicen "siguiente clase de [materia]", busca ese día en el horario y calcula la próxima fecha
- Si dan fecha específica como "28 de abril", úsala
- Si mencionan hora (ej: "9:40"), inclúyela: 2026-04-28T09:40:00
- Si no hay fecha de evento, pon null

REGLAS para type:
- "reunion": asistencia de padres/apoderados (entrevistas, asambleas, PAEC)
- "tarea": prueba, control, evaluación, entrega de trabajo
- "aviso": circular, información general sin acción requerida
- "otro": no encaja

REGLAS para summary: QUÉ es + CUÁNDO (si aplica) + QUÉ hacer. Ej: "Prueba de Historia el lunes 27 de abril. Estudiar para la evaluación."`;

    const response = await fetch(`${OLLAMA_API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OLLAMA_API_KEY}`,
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: MAX_TOKENS,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Ollama API error (${response.status}):`, error);
      return { extractedDate: null, type: null, summary: null, model: null };
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const rawContent = choice?.message?.content || '';
    const contentWasEmpty = !rawContent.trim();
    const completionTokens = data.usage?.completion_tokens ?? null;
    const finishReason = choice?.finish_reason;
    const hitLimit = finishReason === 'length';

    logTokenUsage({ subject, completionTokens, contentWasEmpty, hitLimit });

    let content = rawContent;
    if (contentWasEmpty) {
      // MiniMax puts output in reasoning when it runs out of tokens before writing content
      content = choice?.message?.reasoning || '';
    }

    let parsed;
    try {
      parsed = JSON.parse(content.trim());
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        console.warn(`Failed to extract JSON from response for: ${subject}`);
        return { extractedDate: null, type: null, summary: null, model: OLLAMA_MODEL };
      }
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        console.warn(`Failed to parse extracted JSON for: ${subject}`);
        return { extractedDate: null, type: null, summary: null, model: OLLAMA_MODEL };
      }
    }

    let extractedDate = null;
    if (parsed.eventDate) {
      const raw = String(parsed.eventDate).trim();
      const d = new Date(raw);
      // If the AI returned a date-only string (no time) or midnight UTC,
      // shift to noon UTC so the event lands on the correct local day in
      // any timezone (Chile is UTC-3/UTC-4, so noon UTC = 8–9am local).
      const hasNoTime = !raw.includes('T') || /T00:00(:00)?(Z|[+-]00:00)?$/.test(raw);
      if (hasNoTime) {
        d.setUTCHours(12, 0, 0, 0);
      }
      extractedDate = d;
    }
    const type = parsed.type || 'otro';
    const summary = parsed.summary || null;

    return { extractedDate, type, summary, model: OLLAMA_MODEL };
  } catch (err) {
    console.error('Error calling Ollama API:', err.message);
    return { extractedDate: null, type: null, summary: null, model: null };
  }
}

// Fetches a Drive file thumbnail and describes it using a vision model.
// Returns a text description, or null if vision model is not configured or fails.
async function analyzeImage(driveFileId, accessToken) {
  const visionModel = process.env.OLLAMA_VISION_MODEL;
  if (!visionModel || !OLLAMA_API_KEY || !accessToken) return null;

  try {
    // Google Drive thumbnail URL — accessible with the user's OAuth token
    const thumbnailUrl = `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w1200`;
    const imgRes = await fetch(thumbnailUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!imgRes.ok) return null;

    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

    const response = await fetch(`${OLLAMA_API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OLLAMA_API_KEY}`,
      },
      body: JSON.stringify({
        model: visionModel,
        messages: [{
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
        }],
        max_tokens: 500,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('Error in analyzeImage:', err.message);
    return null;
  }
}

module.exports = { processEmail, getTokenStats, analyzeImage };
