const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../models/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Setup inicial — solo funciona si no hay usuarios
router.get('/setup/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM users');
    const count = parseInt(result.rows[0].count, 10);
    res.json({ setupRequired: count === 0 });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.post('/setup', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM users');
    const count = parseInt(result.rows[0].count, 10);
    if (count > 0) {
      return res.status(403).json({ error: 'Setup ya completado. Esta ruta está deshabilitada.' });
    }
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)',
      [email.toLowerCase(), name, hash, 'admin']
    );
    res.json({ message: 'Administrador creado. Ya puedes iniciar sesión.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND active = true',
      [email.toLowerCase()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, avatar: user.avatar }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Registro por invitación
router.post('/register', async (req, res) => {
  const { token, name, password } = req.body;
  if (!token || !name || !password) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  try {
    const invite = await pool.query(
      'SELECT * FROM invitations WHERE token = $1 AND used = false AND expires_at > NOW()',
      [token]
    );
    if (invite.rows.length === 0) {
      return res.status(400).json({ error: 'Invitación inválida o expirada' });
    }
    const { email, role } = invite.rows[0];
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)',
      [email, name, hash, role]
    );
    await pool.query('UPDATE invitations SET used = true WHERE token = $1', [token]);
    res.json({ message: 'Usuario creado correctamente. Ya puedes iniciar sesión.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Crear invitación (solo admin)
router.post('/invite', authenticate, requireAdmin, async (req, res) => {
  const { email, role } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });
  try {
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días
    await pool.query(
      'INSERT INTO invitations (email, role, token, expires_at) VALUES ($1, $2, $3, $4)',
      [email.toLowerCase(), role || 'member', token, expiresAt]
    );
    const inviteUrl = `${process.env.FRONTEND_URL}/register?token=${token}`;
    res.json({ message: 'Invitación creada', inviteUrl, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Me
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role, avatar, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Cambiar contraseña
router.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;