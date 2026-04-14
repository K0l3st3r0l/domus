const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
];

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// GET /api/school-sync/status
router.get('/status', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT child_email, child_name, last_sync, created_at FROM google_tokens WHERE user_id = $1 ORDER BY child_name',
      [req.user.id]
    );
    res.json({ connected: result.rows });
  } catch (err) {
    console.error('Error en status:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/school-sync/auth-url
router.get('/auth-url', authenticate, async (req, res) => {
  const { child_email, child_name } = req.query;
  if (!child_email) return res.status(400).json({ error: 'child_email requerido' });

  // Encode user context in state JWT with short expiry to prevent stale OAuth flows
  const state = jwt.sign(
    { userId: req.user.id, childEmail: child_email, childName: child_name || child_email },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'login',
    scope: SCOPES,
    state,
  });

  res.json({ url });
});

// GET /api/school-sync/callback — ruta pública (recibe redirect de Google)
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';

  if (error) {
    return res.redirect(`${frontendUrl}/school-sync?error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return res.redirect(`${frontendUrl}/school-sync?error=missing_params`);
  }

  let decoded;
  try {
    decoded = jwt.verify(state, process.env.JWT_SECRET);
  } catch (err) {
    return res.redirect(`${frontendUrl}/school-sync?error=invalid_state`);
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    const { userId, childEmail, childName } = decoded;

    await pool.query(
      `INSERT INTO google_tokens (user_id, child_email, child_name, access_token, refresh_token, token_expiry)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, child_email) DO UPDATE SET
         access_token  = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, google_tokens.refresh_token),
         token_expiry  = EXCLUDED.token_expiry,
         updated_at    = NOW()`,
      [
        userId,
        childEmail,
        childName,
        tokens.access_token,
        tokens.refresh_token || null,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      ]
    );

    // Trigger initial sync in background (don't block redirect)
    syncChild(userId, childEmail).catch(err =>
      console.error('Error en sync inicial:', err.message)
    );

    res.redirect(`${frontendUrl}/school-sync?connected=${encodeURIComponent(childEmail)}`);
  } catch (err) {
    console.error('Error en callback OAuth:', err);
    res.redirect(`${frontendUrl}/school-sync?error=token_exchange_failed`);
  }
});

// POST /api/school-sync/sync
router.post('/sync', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT child_email FROM google_tokens WHERE user_id = $1',
      [req.user.id]
    );

    for (const row of result.rows) {
      await syncChild(req.user.id, row.child_email);
    }

    res.json({ success: true, synced: result.rows.length });
  } catch (err) {
    console.error('Error en sync manual:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/school-sync/emails
router.get('/emails', authenticate, async (req, res) => {
  const { child } = req.query;
  try {
    const params = [req.user.id];
    let query = 'SELECT * FROM school_emails WHERE user_id = $1';
    if (child) {
      query += ' AND child_email = $2';
      params.push(child);
    }
    query += ' ORDER BY date DESC NULLS LAST LIMIT 50';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/school-sync/assignments
router.get('/assignments', authenticate, async (req, res) => {
  const { child } = req.query;
  try {
    const params = [req.user.id];
    let query = 'SELECT * FROM school_assignments WHERE user_id = $1';
    if (child) {
      query += ' AND child_email = $2';
      params.push(child);
    }
    query += ' ORDER BY due_date ASC NULLS LAST';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/school-sync/sync-to-calendar
router.post('/sync-to-calendar', authenticate, async (req, res) => {
  const { assignmentId, suggestedDate } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId requerido' });

  try {
    const assignResult = await pool.query(
      'SELECT * FROM school_assignments WHERE id = $1 AND user_id = $2',
      [assignmentId, req.user.id]
    );
    if (assignResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }
    const task = assignResult.rows[0];

    if (task.synced_to_calendar) {
      return res.status(400).json({ error: 'Esta tarea ya fue agregada al calendario' });
    }

    const description = [task.course_name, task.description].filter(Boolean).join('\n');
    // Use suggestedDate (from schedule) > due_date > today
    const startTime = suggestedDate ? new Date(suggestedDate) : (task.due_date || new Date());
    const eventResult = await pool.query(
      `INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [`📚 ${task.title}`, description, startTime, startTime, true, '#10b981', req.user.id]
    );

    await pool.query(
      'UPDATE school_assignments SET synced_to_calendar = true, calendar_event_id = $1 WHERE id = $2',
      [eventResult.rows[0].id, assignmentId]
    );

    res.json({ success: true, event: eventResult.rows[0] });
  } catch (err) {
    console.error('Error en sync-to-calendar:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/school-sync/emails/:gmailId/body
router.get('/emails/:gmailId/body', authenticate, async (req, res) => {
  const { gmailId } = req.params;
  try {
    const emailResult = await pool.query(
      'SELECT * FROM school_emails WHERE gmail_id = $1 AND user_id = $2',
      [gmailId, req.user.id]
    );
    if (emailResult.rows.length === 0) {
      return res.status(404).json({ error: 'Correo no encontrado' });
    }
    const emailRow = emailResult.rows[0];

    // Return cached body if available
    if (emailRow.body || emailRow.html_body) {
      return res.json({ body: emailRow.body || null, htmlBody: emailRow.html_body || null });
    }

    // Fetch full message from Gmail API
    const auth = await getAuthClientForChild(req.user.id, emailRow.child_email);
    const gmail = google.gmail({ version: 'v1', auth });
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: gmailId,
      format: 'full',
    });

    const textBody = extractTextBody(detail.data.payload);
    const htmlBody = extractHtmlBody(detail.data.payload);

    // Cache both plain text and HTML body for future reads
    if (textBody || htmlBody) {
      pool.query(
        'UPDATE school_emails SET body = $1, html_body = $2 WHERE gmail_id = $3',
        [textBody || null, htmlBody || null, gmailId]
      ).catch(err => console.error('Error caching email body:', err.message));
    }

    res.json({ body: textBody, htmlBody });
  } catch (err) {
    console.error('Error fetching email body:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/school-sync/sync-to-calendar/bulk
router.post('/sync-to-calendar/bulk', authenticate, async (req, res) => {
  const { assignmentIds } = req.body;
  if (!Array.isArray(assignmentIds) || assignmentIds.length === 0) {
    return res.status(400).json({ error: 'assignmentIds requerido' });
  }

  const results = [];
  for (const id of assignmentIds) {
    try {
      const assignResult = await pool.query(
        'SELECT * FROM school_assignments WHERE id = $1 AND user_id = $2',
        [id, req.user.id]
      );
      if (assignResult.rows.length === 0) {
        results.push({ id, error: 'no encontrada' });
        continue;
      }
      const task = assignResult.rows[0];
      if (task.synced_to_calendar) {
        results.push({ id, skipped: true });
        continue;
      }
      const description = [task.course_name, task.description].filter(Boolean).join('\n');
      const startTime = task.due_date || new Date(); // Default to today if no due date
      const eventResult = await pool.query(
        `INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [`📚 ${task.title}`, description, startTime, startTime, true, '#10b981', req.user.id]
      );
      await pool.query(
        'UPDATE school_assignments SET synced_to_calendar = true, calendar_event_id = $1 WHERE id = $2',
        [eventResult.rows[0].id, id]
      );
      results.push({ id, success: true });
    } catch (err) {
      console.error('Error syncing assignment to calendar:', err);
      results.push({ id, error: err.message });
    }
  }
  res.json({ results });
});

// POST /api/school-sync/sync-email-to-calendar
router.post('/sync-email-to-calendar', authenticate, async (req, res) => {
  const { emailId } = req.body;
  if (!emailId) {
    return res.status(400).json({ error: 'emailId requerido' });
  }

  try {
    const emailResult = await pool.query(
      'SELECT * FROM school_emails WHERE id = $1 AND user_id = $2',
      [emailId, req.user.id]
    );
    if (emailResult.rows.length === 0) {
      return res.status(404).json({ error: 'Correo no encontrado' });
    }

    const email = emailResult.rows[0];
    const startTime = email.date || new Date(); // Default to today if no date
    const eventResult = await pool.query(
      `INSERT INTO calendar_events (title, description, start_time, all_day, color, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [`🗓️ ${email.subject}`, email.snippet || 'Reunión detectada', startTime, true, '#f59e0b', req.user.id]
    );

    res.json({ success: true, eventId: eventResult.rows[0].id });
  } catch (err) {
    console.error('Error syncing email to calendar:', err);
    res.status(500).json({ error: 'Error al agregar reunión al calendario' });
  }
});

// GET /api/school-sync/schedules
router.get('/schedules', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM school_schedules WHERE user_id = $1 ORDER BY child_email, day_of_week, period_order',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo horarios:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/school-sync/schedules — reemplaza todos los bloques de un hijo
router.post('/schedules', authenticate, async (req, res) => {
  const { child_email, schedule } = req.body;
  if (!child_email || !Array.isArray(schedule)) {
    return res.status(400).json({ error: 'child_email y schedule[] requeridos' });
  }
  try {
    await pool.query(
      'DELETE FROM school_schedules WHERE user_id = $1 AND child_email = $2',
      [req.user.id, child_email]
    );
    for (const entry of schedule) {
      await pool.query(
        `INSERT INTO school_schedules (user_id, child_email, day_of_week, period_order, subject, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.user.id, child_email, entry.day_of_week, entry.period_order, entry.subject,
         entry.start_time || null, entry.end_time || null]
      );
    }
    res.json({ success: true, saved: schedule.length });
  } catch (err) {
    console.error('Error guardando horarios:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/school-sync/schedules/:childEmail — borra el horario de un hijo
router.delete('/schedules/:childEmail', authenticate, async (req, res) => {
  const { childEmail } = req.params;
  try {
    await pool.query(
      'DELETE FROM school_schedules WHERE user_id = $1 AND child_email = $2',
      [req.user.id, decodeURIComponent(childEmail)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error borrando horarios:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/school-sync/disconnect
router.delete('/disconnect', authenticate, async (req, res) => {
  const { child_email } = req.body;
  if (!child_email) return res.status(400).json({ error: 'child_email requerido' });

  try {
    const result = await pool.query(
      'DELETE FROM google_tokens WHERE user_id = $1 AND child_email = $2 RETURNING id',
      [req.user.id, child_email]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cuenta no encontrada' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── Email body parsing helpers ──────────────────────────────────────────────

function decodeBase64Url(data) {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function extractTextBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }
  return '';
}

function extractHtmlBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const html = extractHtmlBody(part);
      if (html) return html;
    }
  }
  return '';
}

// ─── Funciones internas de sincronización ────────────────────────────────────

async function getAuthClientForChild(userId, childEmail) {
  const result = await pool.query(
    'SELECT * FROM google_tokens WHERE user_id = $1 AND child_email = $2',
    [userId, childEmail]
  );
  if (result.rows.length === 0) {
    throw new Error(`No hay tokens para ${childEmail}`);
  }

  const row = result.rows[0];
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expiry_date: row.token_expiry ? new Date(row.token_expiry).getTime() : undefined,
  });

  // Persist refreshed tokens automatically
  oauth2Client.on('tokens', async (tokens) => {
    const sets = ['updated_at = NOW()'];
    const vals = [];
    if (tokens.access_token) {
      sets.push(`access_token = $${vals.length + 1}`);
      vals.push(tokens.access_token);
    }
    if (tokens.refresh_token) {
      sets.push(`refresh_token = $${vals.length + 1}`);
      vals.push(tokens.refresh_token);
    }
    if (tokens.expiry_date) {
      sets.push(`token_expiry = $${vals.length + 1}`);
      vals.push(new Date(tokens.expiry_date));
    }
    vals.push(userId, childEmail);
    pool
      .query(
        `UPDATE google_tokens SET ${sets.join(', ')} WHERE user_id = $${vals.length - 1} AND child_email = $${vals.length}`,
        vals
      )
      .catch(err => console.error('Error guardando tokens renovados:', err.message));
  });

  return oauth2Client;
}

async function syncGmail(userId, childEmail, auth) {
  const gmail = google.gmail({ version: 'v1', auth });

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'from:cicpm.cl OR from:classroom.google.com newer_than:30d',
    maxResults: 30,
  });

  const messages = listRes.data.messages || [];
  for (const msg of messages) {
    const exists = await pool.query('SELECT id FROM school_emails WHERE gmail_id = $1', [msg.id]);
    if (exists.rows.length > 0) continue;

    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });

    const headers = detail.data.payload?.headers || [];
    const getHeader = name =>
      headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const rawDate = getHeader('Date');
    const parsedDate = rawDate ? new Date(rawDate) : null;

    await pool.query(
      `INSERT INTO school_emails (user_id, child_email, gmail_id, from_address, subject, snippet, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (gmail_id) DO NOTHING`,
      [userId, childEmail, msg.id, getHeader('From'), getHeader('Subject'), detail.data.snippet, parsedDate]
    );
  }
}

async function syncClassroom(userId, childEmail, auth) {
  const classroom = google.classroom({ version: 'v1', auth });

  let courses = [];
  try {
    const res = await classroom.courses.list({ studentId: 'me', courseStates: ['ACTIVE'] });
    courses = res.data.courses || [];
  } catch (err) {
    console.error(`Error obteniendo cursos para ${childEmail}:`, err.message);
    return;
  }

  for (const course of courses) {
    let works = [];
    try {
      const res = await classroom.courses.courseWork.list({
        courseId: course.id,
        courseWorkStates: ['PUBLISHED'],
        orderBy: 'updateTime desc',
        pageSize: 20,
      });
      works = res.data.courseWork || [];
    } catch (err) {
      console.error(`Error obteniendo tareas del curso "${course.name}":`, err.message);
      continue;
    }

    for (const work of works) {
      let dueDate = null;
      if (work.dueDate) {
        const { year, month, day } = work.dueDate;
        const hour = work.dueTime?.hours ?? 23;
        const min = work.dueTime?.minutes ?? 59;
        dueDate = new Date(
          `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`
        );
      }

      await pool.query(
        `INSERT INTO school_assignments (user_id, child_email, classroom_id, course_name, title, description, due_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (child_email, classroom_id) DO UPDATE SET
           title       = EXCLUDED.title,
           description = EXCLUDED.description,
           due_date    = EXCLUDED.due_date,
           course_name = EXCLUDED.course_name`,
        [userId, childEmail, work.id, course.name, work.title, work.description || '', dueDate]
      );
    }
  }
}

async function syncChild(userId, childEmail) {
  try {
    const auth = await getAuthClientForChild(userId, childEmail);
    await Promise.all([
      syncGmail(userId, childEmail, auth),
      syncClassroom(userId, childEmail, auth),
    ]);
    await pool.query(
      'UPDATE google_tokens SET last_sync = NOW() WHERE user_id = $1 AND child_email = $2',
      [userId, childEmail]
    );
    console.log(`✓ Sync completado para ${childEmail}`);
  } catch (err) {
    console.error(`Error sincronizando ${childEmail}:`, err.message);
  }
}

async function syncAllChildren() {
  try {
    const result = await pool.query(
      'SELECT DISTINCT user_id, child_email FROM google_tokens'
    );
    for (const row of result.rows) {
      await syncChild(row.user_id, row.child_email);
    }
  } catch (err) {
    console.error('Error en syncAllChildren:', err.message);
  }
}

module.exports = router;
module.exports.syncAllChildren = syncAllChildren;
