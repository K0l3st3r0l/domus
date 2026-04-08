const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');

// Listar créditos
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM credits ORDER BY active DESC, created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Crear crédito
router.post('/', authenticate, async (req, res) => {
  const { name, institution, type, original_amount, current_balance, monthly_payment,
          interest_rate, total_installments, paid_installments, start_date, end_date, notes } = req.body;
  if (!name || !institution || !original_amount || !monthly_payment) {
    return res.status(400).json({ error: 'Nombre, institución, monto original y cuota son requeridos' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO credits
         (name, institution, type, original_amount, current_balance, monthly_payment,
          interest_rate, total_installments, paid_installments, start_date, end_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        name, institution, type || 'consumo',
        parseInt(original_amount),
        parseInt(current_balance ?? original_amount),
        parseInt(monthly_payment),
        interest_rate ? parseFloat(interest_rate) : null,
        total_installments ? parseInt(total_installments) : null,
        paid_installments ? parseInt(paid_installments) : 0,
        start_date || null,
        end_date || null,
        notes || null,
        req.user.id,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creando crédito:', err.message, err.detail);
    res.status(500).json({ error: 'Error del servidor', details: err.message });
  }
});

// Actualizar crédito
router.put('/:id', authenticate, async (req, res) => {
  const { name, institution, type, original_amount, current_balance, monthly_payment,
          interest_rate, total_installments, paid_installments, start_date, end_date, notes, active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE credits SET
         name=$1, institution=$2, type=$3, original_amount=$4, current_balance=$5,
         monthly_payment=$6, interest_rate=$7, total_installments=$8, paid_installments=$9,
         start_date=$10, end_date=$11, notes=$12, active=$13
       WHERE id=$14 RETURNING *`,
      [
        name, institution, type, original_amount, current_balance,
        monthly_payment, interest_rate || null, total_installments || null,
        paid_installments || 0, start_date || null, end_date || null,
        notes || null, active ?? true, req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Crédito no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Registrar cuota pagada (incrementa paid_installments, reduce saldo)
// Acepta amount opcional en el body; si no, usa monthly_payment
router.patch('/:id/pay', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM credits WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Crédito no encontrado' });
    const c = rows[0];
    const newPaid = parseInt(c.paid_installments) + 1;
    // Usar amount del body si se envía; si no, usar monthly_payment
    const paymentAmount = req.body?.amount ? parseFloat(req.body.amount) : parseFloat(c.monthly_payment);
    const newBalance = Math.max(0, parseFloat(c.current_balance) - paymentAmount);
    const finished = c.total_installments && newPaid >= parseInt(c.total_installments);
    const result = await pool.query(
      'UPDATE credits SET paid_installments=$1, current_balance=$2, active=$3 WHERE id=$4 RETURNING *',
      [newPaid, newBalance, !finished, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Eliminar crédito
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM credits WHERE id=$1', [req.params.id]);
    res.json({ message: 'Crédito eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;