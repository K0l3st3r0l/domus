const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');

// Listar transacciones con filtros
router.get('/', authenticate, async (req, res) => {
  const { month, year, type, category } = req.query;
  try {
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
       WHERE EXTRACT(MONTH FROM date) = $1 AND EXTRACT(YEAR FROM date) = $2
       GROUP BY type, category
       ORDER BY type, total DESC`,
      [m, y]
    );
    const breakdown = result.rows.map(r => ({
      ...r,
      total: parseFloat(r.total)
    }));
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let count = 0;
    for (const tx of transactions) {
      const { type, amount, category, description, date } = tx;
      if (!type || !amount || !category) continue;
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
    const result = await pool.query(
      `UPDATE finance_transactions SET type=$1, amount=$2, category=$3, description=$4, date=$5
       WHERE id=$6 RETURNING *`,
      [type, amount, category, description, date, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Transacción no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Eliminar transacción
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM finance_transactions WHERE id = $1', [req.params.id]);
    res.json({ message: 'Transacción eliminada' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Categorías disponibles
router.get('/categories', authenticate, async (req, res) => {
  const incomeCategories = ['Salario', 'Freelance', 'Alquiler', 'Inversiones', 'Otros ingresos'];
  const expenseCategories = ['Hipoteca/Alquiler', 'Alimentación', 'Suministros', 'Transporte', 'Salud', 'Educación', 'Ocio', 'Ropa', 'Tecnología', 'Seguros', 'Hogar', 'Construcción', 'Mascotas', 'Belleza/Personal', 'Viajes', 'Deportes', 'Muebles', 'Auto', 'Combustible', 'Estacionamiento', 'Mall Chino', 'Servicios', 'Otros gastos'];
  res.json({ income: incomeCategories, expense: expenseCategories });
});

module.exports = router;
