const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');

// Listar suscripciones
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
    res.json(result.rows);
  } catch (err) {
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
  const { name, category, amount, currency, billing_cycle, next_billing_date, status, alert_days, url, notes } = req.body;
  if (!name || !amount || !next_billing_date) {
    return res.status(400).json({ error: 'Nombre, importe y fecha de renovación requeridos' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO subscriptions (name, category, amount, currency, billing_cycle, next_billing_date, status, alert_days, url, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
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
  const { name, category, amount, currency, billing_cycle, next_billing_date, status, alert_days, url, notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE subscriptions
       SET name=$1, category=$2, amount=$3, currency=$4, billing_cycle=$5,
           next_billing_date=$6, status=$7, alert_days=$8, url=$9, notes=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [name, category, amount, currency, billing_cycle, next_billing_date, status, alert_days, url || null, notes || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Suscripción no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
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
