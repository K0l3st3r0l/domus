const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { callAI } = require('../services/aiService');

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function fmtCLP(n) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(n ?? 0);
}

// Extrae el último objeto JSON válido de un texto. Robusto ante modelos de
// razonamiento que anteponen prosa o envuelven el JSON en bloques markdown.
function extractJsonObject(text) {
  if (!text) return null;
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* sigue */ }

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* sigue */ } }

  // Escaneo con conteo de llaves: recolecta cada {...} balanceado (ignora llaves dentro de strings)
  const candidates = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < t.length; j++) {
      const ch = t[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { if (--depth === 0) { candidates.push(t.slice(i, j + 1)); break; } }
    }
  }
  // Preferir el último candidato que parsee y tenga la forma esperada
  for (let k = candidates.length - 1; k >= 0; k--) {
    try { const o = JSON.parse(candidates[k]); if (o && typeof o === 'object' && 'resumen' in o) return o; } catch { /* sigue */ }
  }
  for (let k = candidates.length - 1; k >= 0; k--) {
    try { return JSON.parse(candidates[k]); } catch { /* sigue */ }
  }
  return null;
}

function normalizeDescription(desc) {
  if (!desc || !desc.trim()) return null;
  return desc.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Listar transacciones con filtros
router.get('/', authenticate, async (req, res) => {
  const { month, year, type, category } = req.query;
  try {
    // Finanzas familiares: se muestran las transacciones de todos los miembros (la sección está restringida por permisos)
    let query = `SELECT t.*, u.name as creator_name FROM finance_transactions t LEFT JOIN users u ON t.created_by = u.id WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (month && year) {
      query += ` AND EXTRACT(MONTH FROM t.date) = $${idx++} AND EXTRACT(YEAR FROM t.date) = $${idx++}`;
      params.push(month, year);
    }
    if (type) { query += ` AND t.type = $${idx++}`; params.push(type); }
    if (category) { query += ` AND t.category = $${idx++}`; params.push(category); }
    query += ' ORDER BY t.date DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Resumen del mes
router.get('/summary', authenticate, async (req, res) => {
  const { month, year } = req.query;
  const m = month || new Date().getMonth() + 1;
  const y = year || new Date().getFullYear();
  try {
    const result = await pool.query(
      `SELECT
        type,
        category,
        SUM(amount) as total,
        COUNT(*) as count
       FROM finance_transactions
       WHERE EXTRACT(MONTH FROM date) = $1
         AND EXTRACT(YEAR FROM date) = $2
       GROUP BY type, category
       ORDER BY type, total DESC`,
      [m, y]
    );
    const breakdown = result.rows.map(r => ({ ...r, total: parseFloat(r.total) }));
    const income = breakdown.filter(r => r.type === 'income').reduce((s, r) => s + r.total, 0);
    const expenses = breakdown.filter(r => r.type === 'expense').reduce((s, r) => s + r.total, 0);
    res.json({ income, expenses, balance: income - expenses, breakdown });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Crear transacción
router.post('/', authenticate, async (req, res) => {
  const { type, amount, category, description, date, recurring, recurring_period } = req.body;
  if (!type || !amount || !category) {
    return res.status(400).json({ error: 'Tipo, importe y categoría requeridos' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO finance_transactions (type, amount, category, description, date, recurring, recurring_period, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [type, amount, category, description, date || new Date(), recurring || false, recurring_period, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Importar múltiples transacciones (estado de cuenta)
router.post('/batch', authenticate, async (req, res) => {
  const { transactions } = req.body;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({ error: 'No hay transacciones para importar' });
  }

  // Resolver preferencias de categoría en lote antes de insertar
  const descriptions = [...new Set(
    transactions.map(tx => normalizeDescription(tx.description)).filter(Boolean)
  )];
  const categoryMap = {};
  if (descriptions.length > 0) {
    const res2 = await pool.query(
      `SELECT normalized_description, category FROM description_category_map
       WHERE created_by = $1 AND normalized_description = ANY($2)`,
      [req.user.id, descriptions]
    );
    for (const row of res2.rows) {
      categoryMap[row.normalized_description] = row.category;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let count = 0;
    for (const tx of transactions) {
      const { type, amount, description, date } = tx;
      let { category } = tx;
      if (!type || !amount || !category) continue;

      const norm = normalizeDescription(description);
      if (norm && categoryMap[norm]) {
        category = categoryMap[norm];
      }

      await client.query(
        `INSERT INTO finance_transactions (type, amount, category, description, date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [type, amount, category, description || null, date || new Date(), req.user.id]
      );
      count++;
    }
    await client.query('COMMIT');
    res.status(201).json({ imported: count });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error importando transacciones' });
  } finally {
    client.release();
  }
});

// Actualizar transacción
router.put('/:id', authenticate, async (req, res) => {
  const { type, amount, category, description, date } = req.body;
  try {
    // Buscar la transacción actual verificando ownership
    const current = await pool.query(
      `SELECT * FROM finance_transactions WHERE id = $1 AND created_by = $2`,
      [req.params.id, req.user.id]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Transacción no encontrada' });
    }

    const prev = current.rows[0];
    const categoryChanged = prev.category !== category;

    const result = await pool.query(
      `UPDATE finance_transactions SET type=$1, amount=$2, category=$3, description=$4, date=$5
       WHERE id=$6 AND created_by=$7 RETURNING *`,
      [type, amount, category, description, date, req.params.id, req.user.id]
    );

    // Si la categoría cambió y hay descripción válida, aprender y propagar en cascada
    if (categoryChanged && description && description.trim()) {
      const norm = normalizeDescription(description);
      if (norm) {
        await pool.query(
          `INSERT INTO description_category_map (created_by, normalized_description, original_description, category, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (created_by, normalized_description)
           DO UPDATE SET category = EXCLUDED.category, original_description = EXCLUDED.original_description, updated_at = NOW()`,
          [req.user.id, norm, description.trim(), category]
        );
        // Actualizar en cascada todas las transacciones del usuario con esa descripción normalizada
        await pool.query(
          `UPDATE finance_transactions
           SET category = $1
           WHERE created_by = $2
             AND LOWER(TRIM(REGEXP_REPLACE(description, '\\s+', ' ', 'g'))) = $3
             AND id != $4`,
          [category, req.user.id, norm, req.params.id]
        );
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Eliminar transacción
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM finance_transactions WHERE id = $1 AND created_by = $2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Transacción no encontrada' });
    res.json({ message: 'Transacción eliminada' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Verificar transacciones duplicadas (batch, una sola query)
router.post('/check-duplicates', authenticate, async (req, res) => {
  const { transactions } = req.body;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({ error: 'No hay transacciones para verificar' });
  }
  try {
    const keys = transactions
      .filter(tx => tx.description && tx.date && tx.amount)
      .map(tx => `('${tx.description.replace(/'/g, "''")}', '${tx.date}', ${tx.amount})`);

    if (keys.length === 0) return res.json({ duplicates: [], count: 0 });

    const result = await pool.query(
      `SELECT description, date::text, amount::numeric
       FROM finance_transactions
       WHERE created_by = $1
         AND (description, date, amount) IN (
           SELECT t.description, t.date::date, t.amount::numeric
           FROM finance_transactions t
           WHERE t.created_by = $1
             AND (description, date::text, amount::numeric) IN (${keys})
         )`,
      [req.user.id]
    );

    const dupSet = new Set(result.rows.map(r => `${r.description}|${r.date}|${parseFloat(r.amount)}`));
    const duplicates = transactions.filter(tx =>
      dupSet.has(`${tx.description}|${tx.date}|${parseFloat(tx.amount)}`)
    ).map(tx => ({ description: tx.description, date: tx.date, amount: tx.amount, isDuplicate: true }));

    res.json({ duplicates, count: duplicates.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error verificando duplicados' });
  }
});

// Obtener categorías aprendidas por descripción (batch)
router.post('/categories-by-description', authenticate, async (req, res) => {
  const { descriptions } = req.body;
  if (!Array.isArray(descriptions) || descriptions.length === 0) {
    return res.json({});
  }
  try {
    const normalized = [...new Set(descriptions.map(normalizeDescription).filter(Boolean))];
    if (normalized.length === 0) return res.json({});

    const result = await pool.query(
      `SELECT normalized_description, category FROM description_category_map
       WHERE created_by = $1 AND normalized_description = ANY($2)`,
      [req.user.id, normalized]
    );

    // Devolver mapa: descripción original → categoría preferida
    const normMap = {};
    for (const row of result.rows) {
      normMap[row.normalized_description] = row.category;
    }

    const out = {};
    for (const desc of descriptions) {
      const norm = normalizeDescription(desc);
      if (norm && normMap[norm]) {
        out[desc] = normMap[norm];
      }
    }
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo categorías' });
  }
});

// Resumen consolidado: finanzas + suscripciones + créditos
router.get('/dashboard-summary', authenticate, async (req, res) => {
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  const year  = parseInt(req.query.year)  || new Date().getFullYear();
  try {
    const [finRes, subRes, credRes] = await Promise.all([
      pool.query(
        `SELECT type, category, SUM(amount) AS total
         FROM finance_transactions
         WHERE EXTRACT(MONTH FROM date) = $1
           AND EXTRACT(YEAR  FROM date) = $2
         GROUP BY type, category ORDER BY type, total DESC`,
        [month, year]
      ),
      pool.query(
        `SELECT name, amount, currency, billing_cycle, next_billing_date, category
         FROM subscriptions WHERE status = 'active' ORDER BY amount DESC`
      ),
      pool.query(
        `SELECT name, institution, type, current_balance, monthly_payment,
                total_installments, paid_installments, interest_rate
         FROM credits WHERE active = true ORDER BY current_balance DESC`
      ),
    ]);

    const breakdown = finRes.rows.map(r => ({ ...r, total: parseFloat(r.total) }));
    const income    = breakdown.filter(r => r.type === 'income').reduce((s, r) => s + r.total, 0);
    const expenses  = breakdown.filter(r => r.type === 'expense').reduce((s, r) => s + r.total, 0);
    const expenseByCategory = breakdown.filter(r => r.type === 'expense');

    const monthlySubCost = subRes.rows.reduce((s, sub) => {
      const a = parseFloat(sub.amount);
      if (sub.billing_cycle === 'monthly') return s + a;
      if (sub.billing_cycle === 'yearly')  return s + a / 12;
      if (sub.billing_cycle === 'weekly')  return s + a * 4.33;
      return s;
    }, 0);

    const monthlyCredits = credRes.rows.reduce((s, c) => s + parseFloat(c.monthly_payment || 0), 0);
    const totalBalance   = credRes.rows.reduce((s, c) => s + parseFloat(c.current_balance || 0), 0);

    res.json({
      month, year,
      finances: { income, expenses, balance: income - expenses, expenseByCategory },
      subscriptions: {
        active: subRes.rows.length,
        monthlyEquivalent: Math.round(monthlySubCost),
        items: subRes.rows,
      },
      credits: {
        active: credRes.rows.length,
        monthlyCommitment: Math.round(monthlyCredits),
        totalBalance: Math.round(totalBalance),
        items: credRes.rows,
      },
      realBalance: Math.round(income - expenses - monthlySubCost - monthlyCredits),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Análisis IA del mes financiero consolidado
router.post('/ai-analyze', authenticate, async (req, res) => {
  const month = parseInt(req.body.month) || new Date().getMonth() + 1;
  const year  = parseInt(req.body.year)  || new Date().getFullYear();
  try {
    const [finRes, subRes, credRes] = await Promise.all([
      pool.query(
        `SELECT type, category, SUM(amount) AS total
         FROM finance_transactions
         WHERE EXTRACT(MONTH FROM date) = $1
           AND EXTRACT(YEAR  FROM date) = $2
         GROUP BY type, category ORDER BY type, total DESC`,
        [month, year]
      ),
      pool.query(`SELECT name, amount, currency, billing_cycle, category FROM subscriptions WHERE status = 'active' ORDER BY amount DESC`),
      pool.query(`SELECT name, institution, type, current_balance, monthly_payment, interest_rate FROM credits WHERE active = true ORDER BY current_balance DESC`),
    ]);

    const breakdown = finRes.rows.map(r => ({ ...r, total: parseFloat(r.total) }));
    const income    = breakdown.filter(r => r.type === 'income').reduce((s, r) => s + r.total, 0);
    const expenses  = breakdown.filter(r => r.type === 'expense').reduce((s, r) => s + r.total, 0);
    const expCat    = breakdown.filter(r => r.type === 'expense');

    const monthlySubCost = subRes.rows.reduce((s, sub) => {
      const a = parseFloat(sub.amount);
      if (sub.billing_cycle === 'monthly') return s + a;
      if (sub.billing_cycle === 'yearly')  return s + a / 12;
      if (sub.billing_cycle === 'weekly')  return s + a * 4.33;
      return s;
    }, 0);
    const monthlyCredits = credRes.rows.reduce((s, c) => s + parseFloat(c.monthly_payment || 0), 0);
    const realBalance    = income - expenses - monthlySubCost - monthlyCredits;

    const expCatLines = expCat.length
      ? expCat.map(c => `  - ${c.category}: ${fmtCLP(c.total)} (${income > 0 ? Math.round(c.total / income * 100) : 0}% del ingreso)`).join('\n')
      : '  (sin gastos registrados)';

    const subLines = subRes.rows.length
      ? subRes.rows.map(s => `  - ${s.name}: ${s.currency} ${s.amount}/${s.billing_cycle} [${s.category}]`).join('\n')
      : '  (sin suscripciones activas)';

    const credLines = credRes.rows.length
      ? credRes.rows.map(c => `  - ${c.name} (${c.institution}): cuota ${fmtCLP(c.monthly_payment)}/mes, saldo ${fmtCLP(c.current_balance)}${c.interest_rate ? `, tasa ${c.interest_rate}%` : ''}`).join('\n')
      : '  (sin créditos activos)';

    const prompt = `Eres un asesor financiero personal analizando las finanzas familiares chilenas de ${MONTHS_ES[month - 1]} ${year}.

DATOS DEL MES:
Ingresos: ${fmtCLP(income)}
Gastos registrados: ${fmtCLP(expenses)}
Suscripciones activas (${subRes.rows.length}): ${fmtCLP(Math.round(monthlySubCost))}/mes equivalente
Compromisos de créditos (${credRes.rows.length} activos): ${fmtCLP(Math.round(monthlyCredits))}/mes
Balance real disponible tras compromisos fijos: ${fmtCLP(Math.round(realBalance))}

GASTOS POR CATEGORÍA:
${expCatLines}

SUSCRIPCIONES:
${subLines}

CRÉDITOS:
${credLines}

Evalúa internamente, SIN mostrar tu razonamiento: salud financiera (ratio gasto/ingreso, carga de deuda, diversificación de gastos), oportunidades de optimización concretas (suscripciones redundantes, categorías sobredimensionadas, créditos costosos) y riesgos (créditos con alta tasa, compromisos fijos vs ingreso disponible).

IMPORTANTE: Tu respuesta debe ser UN ÚNICO objeto JSON válido y NADA MÁS. No escribas análisis, explicaciones, ni markdown antes o después. Formato exacto:
{"resumen":"evaluación global en 1-2 oraciones directas","hallazgos":["hallazgo 1","hallazgo 2","hallazgo 3"],"recomendaciones":["acción concreta 1","acción concreta 2","acción concreta 3"],"alertas":["alerta 1"],"puntuacion":7}

Si no hay alertas reales, usa alertas:[]. La puntuación es del 1 al 10 (10=excelente salud financiera).`;

    const { content, finishReason } = await callAI([{ role: 'user', content: prompt }], { maxTokens: 4000 });

    const parsed = extractJsonObject(content);

    if (!parsed) {
      console.error(`ai-analyze: respuesta no parseable. finishReason=${finishReason}, len=${content?.length}, head=${(content || '').slice(0, 200)}`);
      const msg = finishReason === 'length'
        ? 'El análisis se truncó por límite de tokens. Intenta de nuevo.'
        : 'No se pudo parsear respuesta de IA';
      return res.status(500).json({ error: msg });
    }

    res.json({ ...parsed, month, year, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error analizando finanzas' });
  }
});

// Categorías disponibles
router.get('/categories', authenticate, async (req, res) => {
  const incomeCategories = ['Salario', 'Freelance', 'Alquiler', 'Inversiones', 'Otros ingresos'];
  const expenseCategories = ['Hipoteca/Alquiler', 'Alimentación', 'Suministros', 'Transporte', 'Salud', 'Educación', 'Ocio', 'Ropa', 'Tecnología', 'Seguros', 'Hogar', 'Construcción', 'Mascotas', 'Belleza/Personal', 'Viajes', 'Deportes', 'Muebles', 'Auto', 'Combustible', 'Estacionamiento', 'Mall Chino', 'Servicios', 'Otros gastos'];
  res.json({ income: incomeCategories, expense: expenseCategories });
});

module.exports = router;