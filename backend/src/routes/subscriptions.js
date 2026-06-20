const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');

// Listar suscripciones (con auto-detección de pagos por transacciones)
router.get('/', authenticate, async (req, res) => {
  const { status } = req.query;
  try {
    let query = 'SELECT * FROM subscriptions WHERE 1=1';
    const params = [];
    if (status) {
      query += ' AND status = $1';
      params.push(status);
    }
    query += ' ORDER BY next_billing_date ASC';
    const result = await pool.query(query, params);
    const subs = result.rows;

    // Cargar transacciones de gastos de los últimos 40 días para auto-match
    const txRes = await pool.query(
      `SELECT id, amount, date, description FROM finance_transactions
       WHERE type = 'expense' AND date >= CURRENT_DATE - 40 ORDER BY date DESC`
    );

    for (const sub of subs) {
      if (sub.last_paid_at) continue; // ya registrado manualmente

      // Construir keywords: match_keywords + palabras del nombre (≥3 chars)
      const keywords = new Set();
      if (sub.match_keywords) {
        sub.match_keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length >= 3).forEach(k => keywords.add(k));
      }
      sub.name.split(/\s+/).map(w => w.toLowerCase()).filter(w => w.length >= 3).forEach(w => keywords.add(w));

      // Calcular inicio del ciclo actual
      const nextDate = new Date(sub.next_billing_date);
      const cycleStart = new Date(nextDate);
      if (sub.billing_cycle === 'monthly') cycleStart.setMonth(cycleStart.getMonth() - 1);
      else if (sub.billing_cycle === 'yearly') cycleStart.setFullYear(cycleStart.getFullYear() - 1);
      else if (sub.billing_cycle === 'weekly') cycleStart.setDate(cycleStart.getDate() - 7);

      // Buscar transacción que coincida en el período, descripción y monto.
      // El monto es necesario porque varias suscripciones del mismo proveedor (ej:
      // Amazon Music y Prime Video, ambas con "amazon" como keyword) no deben
      // cruzarse entre sí solo por compartir palabra clave.
      const subAmount = parseFloat(sub.amount);
      const amountTolerance = Math.max(500, subAmount * 0.1);
      const match = txRes.rows.find(tx => {
        const txDate = new Date(tx.date);
        if (txDate < cycleStart) return false;
        if (Math.abs(parseFloat(tx.amount) - subAmount) > amountTolerance) return false;
        const desc = (tx.description || '').toLowerCase();
        return [...keywords].some(k => desc.includes(k));
      });

      if (match) {
        sub.auto_matched_tx = {
          id: match.id,
          amount: parseFloat(match.amount),
          date: match.date,
          description: match.description,
        };
      }
    }

    res.json(subs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Próximas renovaciones (dentro de N días)
router.get('/upcoming', authenticate, async (req, res) => {
  const days = Math.max(1, Math.min(parseInt(req.query.days) || 7, 365));
  try {
    const result = await pool.query(
      `SELECT * FROM subscriptions
       WHERE status = 'active'
       AND next_billing_date <= CURRENT_DATE + make_interval(days => $1)
       AND next_billing_date >= CURRENT_DATE
       ORDER BY next_billing_date ASC`,
      [days]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Resumen de costes
router.get('/summary', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'active') AS active_count,
        COALESCE(SUM(
          CASE
            WHEN status = 'active' AND billing_cycle = 'monthly' THEN amount
            WHEN status = 'active' AND billing_cycle = 'yearly'  THEN amount / 12
            WHEN status = 'active' AND billing_cycle = 'weekly'  THEN amount * 4.33
            ELSE 0
          END
        ), 0) AS monthly_cost,
        COALESCE(SUM(
          CASE
            WHEN status = 'active' AND billing_cycle = 'monthly' THEN amount * 12
            WHEN status = 'active' AND billing_cycle = 'yearly'  THEN amount
            WHEN status = 'active' AND billing_cycle = 'weekly'  THEN amount * 52
            ELSE 0
          END
        ), 0) AS yearly_cost
       FROM subscriptions`
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Crear suscripción
router.post('/', authenticate, async (req, res) => {
  const { name, category, amount, currency, billing_cycle, next_billing_date, status, alert_days, url, notes, match_keywords } = req.body;
  if (!name || !amount || !next_billing_date) {
    return res.status(400).json({ error: 'Nombre, importe y fecha de renovación requeridos' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO subscriptions (name, category, amount, currency, billing_cycle, next_billing_date, status, alert_days, url, notes, match_keywords, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        name,
        category || 'Entretenimiento',
        amount,
        currency || 'CLP',
        billing_cycle || 'monthly',
        next_billing_date,
        status || 'active',
        alert_days ?? 3,
        url || null,
        notes || null,
        match_keywords || null,
        req.user.id,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Actualizar suscripción
router.put('/:id', authenticate, async (req, res) => {
  const { name, category, amount, currency, billing_cycle, next_billing_date, status, alert_days, url, notes, match_keywords } = req.body;
  try {
    const result = await pool.query(
      `UPDATE subscriptions
       SET name=$1, category=$2, amount=$3, currency=$4, billing_cycle=$5,
           next_billing_date=$6, status=$7, alert_days=$8, url=$9, notes=$10, match_keywords=$11, updated_at=NOW()
       WHERE id=$12 RETURNING *`,
      [name, category, amount, currency, billing_cycle, next_billing_date, status, alert_days, url || null, notes || null, match_keywords || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Suscripción no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Registrar pago de una suscripción
router.post('/:id/pay', authenticate, async (req, res) => {
  const { amount_clp, paid_date } = req.body;
  if (!amount_clp) {
    return res.status(400).json({ error: 'Monto en CLP requerido' });
  }
  try {
    const sub = await pool.query('SELECT * FROM subscriptions WHERE id = $1', [req.params.id]);
    if (sub.rows.length === 0) return res.status(404).json({ error: 'Suscripción no encontrada' });

    const s = sub.rows[0];
    const paidAt = paid_date || new Date().toISOString().split('T')[0];

    // Avanzar next_billing_date al siguiente ciclo
    let nextDate;
    if (s.billing_cycle === 'monthly') {
      nextDate = new Date(s.next_billing_date);
      nextDate.setMonth(nextDate.getMonth() + 1);
    } else if (s.billing_cycle === 'yearly') {
      nextDate = new Date(s.next_billing_date);
      nextDate.setFullYear(nextDate.getFullYear() + 1);
    } else if (s.billing_cycle === 'weekly') {
      nextDate = new Date(s.next_billing_date);
      nextDate.setDate(nextDate.getDate() + 7);
    } else {
      nextDate = new Date(s.next_billing_date);
    }

    const result = await pool.query(
      `UPDATE subscriptions
       SET last_paid_at = $1, last_paid_amount = $2, next_billing_date = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [paidAt, amount_clp, nextDate.toISOString().split('T')[0], req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Eliminar suscripción
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM subscriptions WHERE id = $1', [req.params.id]);
    res.json({ message: 'Suscripción eliminada' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
