const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');

// Listar eventos (con filtro de rango)
router.get('/', authenticate, async (req, res) => {
  const { start, end } = req.query;
  try {
    let query = `SELECT e.*, u.name as creator_name,
      sa.id as school_assignment_id,
      sa.course_name,
      COALESCE(sa.child_email, email_match.child_email) as child_email
      FROM calendar_events e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN school_assignments sa ON sa.calendar_event_id = e.id
      LEFT JOIN LATERAL (
        SELECT se.child_email
        FROM school_emails se
        WHERE se.user_id = e.created_by
          AND e.title = ('🗓️ ' || COALESCE(se.subject, ''))
          AND (
            DATE(COALESCE(se.extracted_date, se.date)) = DATE(e.start_time)
            OR COALESCE(se.ai_summary, se.snippet, 'Reunión detectada') = COALESCE(e.description, '')
          )
        ORDER BY
          ABS(EXTRACT(EPOCH FROM (COALESCE(se.extracted_date, se.date) - e.start_time))) ASC,
          se.updated_at DESC NULLS LAST,
          se.id DESC
        LIMIT 1
      ) email_match ON true`;
    const params = [];
    if (start && end) {
      query += ' WHERE e.start_time >= $1 AND e.start_time <= $2';
      params.push(start, end);
    }
    query += ' ORDER BY e.start_time';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Crear evento
router.post('/', authenticate, async (req, res) => {
  const { title, description, start_time, end_time, all_day, color, alert_minutes } = req.body;
  if (!title || !start_time) {
    return res.status(400).json({ error: 'Título y fecha de inicio requeridos' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color, alert_minutes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [title, description, start_time, end_time, all_day || false, color || '#4f46e5', alert_minutes, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Actualizar evento
router.put('/:id', authenticate, async (req, res) => {
  const { title, description, start_time, end_time, all_day, color, alert_minutes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE calendar_events SET title=$1, description=$2, start_time=$3, end_time=$4,
       all_day=$5, color=$6, alert_minutes=$7 WHERE id=$8 RETURNING *`,
      [title, description, start_time, end_time, all_day, color, alert_minutes, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Eliminar evento
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM calendar_events WHERE id = $1', [req.params.id]);
    res.json({ message: 'Evento eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
