const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');

// Listar listas de compra
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.*, u.name as creator_name,
       COUNT(i.id) as total_items,
       COUNT(i.id) FILTER (WHERE i.checked = true) as checked_items
       FROM shopping_lists l
       LEFT JOIN users u ON l.created_by = u.id
       LEFT JOIN shopping_items i ON i.list_id = l.id
       GROUP BY l.id, u.name
       ORDER BY l.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Crear lista
router.post('/', authenticate, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const result = await pool.query(
      'INSERT INTO shopping_lists (name, created_by) VALUES ($1, $2) RETURNING *',
      [name, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener items de una lista
router.get('/:id/items', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM shopping_items WHERE list_id = $1 ORDER BY category, name',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Agregar item
router.post('/:id/items', authenticate, async (req, res) => {
  const { name, quantity, unit, category } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre del item requerido' });
  try {
    const result = await pool.query(
      'INSERT INTO shopping_items (list_id, name, quantity, unit, category) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.params.id, name, quantity || 1, unit, category || 'General']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Marcar/desmarcar item
router.patch('/:listId/items/:itemId/toggle', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE shopping_items SET checked = NOT checked WHERE id = $1 RETURNING *',
      [req.params.itemId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Eliminar item
router.delete('/:listId/items/:itemId', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM shopping_items WHERE id = $1', [req.params.itemId]);
    res.json({ message: 'Item eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Eliminar lista
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM shopping_items WHERE list_id = $1', [req.params.id]);
    await pool.query('DELETE FROM shopping_lists WHERE id = $1', [req.params.id]);
    res.json({ message: 'Lista eliminada' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
