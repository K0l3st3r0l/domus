const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');

// Obtener menú de una semana (por fecha de inicio de semana)
router.get('/', authenticate, async (req, res) => {
  const { week_start } = req.query;
  try {
    let query = `SELECT m.*, u.name as creator_name FROM weekly_menu m LEFT JOIN users u ON m.created_by = u.id`;
    const params = [];
    if (week_start) {
      query += ' WHERE m.week_start = $1';
      params.push(week_start);
    }
    query += ' ORDER BY m.week_start DESC, m.day_of_week, m.meal_type';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Agregar/actualizar plato del menú
router.post('/', authenticate, async (req, res) => {
  const { week_start, day_of_week, meal_type, dish_name, notes } = req.body;
  if (!week_start || day_of_week === undefined || !meal_type || !dish_name) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  try {
    // Upsert: si ya existe ese slot, actualiza
    const result = await pool.query(
      `INSERT INTO weekly_menu (week_start, day_of_week, meal_type, dish_name, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (week_start, day_of_week, meal_type)
       DO UPDATE SET dish_name = EXCLUDED.dish_name, notes = EXCLUDED.notes, created_by = EXCLUDED.created_by
       RETURNING *`,
      [week_start, day_of_week, meal_type, dish_name, notes, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Eliminar plato del menú
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM weekly_menu WHERE id = $1', [req.params.id]);
    res.json({ message: 'Plato eliminado del menú' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Generar lista de compra desde el menú actual
router.post('/:week_start/generate-shopping', authenticate, async (req, res) => {
  const { week_start } = req.params;
  try {
    const menuItems = await pool.query(
      'SELECT dish_name FROM weekly_menu WHERE week_start = $1',
      [week_start]
    );
    const listName = `Compra semana ${week_start}`;
    const list = await pool.query(
      'INSERT INTO shopping_lists (name, created_by) VALUES ($1, $2) RETURNING id',
      [listName, req.user.id]
    );
    res.json({ message: 'Lista de compra creada', listId: list.rows[0].id, menuItems: menuItems.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
