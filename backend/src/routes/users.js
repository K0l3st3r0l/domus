const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Listar miembros de la familia
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role, avatar, active, created_at FROM users ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Actualizar perfil propio
router.put('/me', authenticate, async (req, res) => {
  const { name, avatar } = req.body;
  try {
    const result = await pool.query(
      'UPDATE users SET name = COALESCE($1, name), avatar = COALESCE($2, avatar) WHERE id = $3 RETURNING id, email, name, role, avatar',
      [name, avatar, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Activar/desactivar miembro (solo admin)
router.patch('/:id/toggle', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE users SET active = NOT active WHERE id = $1 RETURNING id, name, active',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener permisos del menú de navegación para miembros
router.get('/nav-permissions', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'member_disabled_nav'"
    );
    const disabled = result.rows[0]?.value || [];
    res.json({ disabled });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Actualizar permisos del menú de navegación (solo admin)
router.put('/nav-permissions', authenticate, requireAdmin, async (req, res) => {
  const { disabled } = req.body;
  if (!Array.isArray(disabled)) {
    return res.status(400).json({ error: 'disabled debe ser un array' });
  }
  try {
    await pool.query(
      "INSERT INTO app_settings (key, value) VALUES ('member_disabled_nav', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
      [JSON.stringify(disabled)]
    );
    res.json({ disabled });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
