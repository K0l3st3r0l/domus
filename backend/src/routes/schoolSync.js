const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { processEmail, getTokenStats } = require('../services/ollamaService');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
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
      'SELECT child_email, child_name FROM google_tokens WHERE user_id = $1',
      [req.user.id]
    );

    const children = result.rows;
    const userId = req.user.id;

    // Steps per child: auth, gmail, tareas, anuncios, IA = 5
    const STEPS_PER_CHILD = 5;
    syncProgress.set(userId, {
      running: true, done: false,
      completed: 0, total: children.length * STEPS_PER_CHILD,
      stepLabel: 'Iniciando…', error: null,
    });

    // Respond immediately to avoid Cloudflare 524 timeout; sync runs in background
    res.json({ success: true, synced: children.length, background: true });

    const step = (label) => {
      const prev = syncProgress.get(userId);
      if (prev) syncProgress.set(userId, { ...prev, completed: prev.completed + 1, stepLabel: label });
    };

    for (const row of children) {
      await syncChild(userId, row.child_email, step, row.child_name).catch(err =>
        console.error(`Error en sync manual (${row.child_email}):`, err.message)
      );
    }

    const prev = syncProgress.get(userId);
    if (prev) syncProgress.set(userId, { ...prev, running: false, done: true, stepLabel: '✅ Completado' });
  } catch (err) {
    console.error('Error en sync manual:', err);
    const prev = syncProgress.get(req.user.id);
    if (prev) syncProgress.set(req.user.id, { ...prev, running: false, done: true, error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Error del servidor' });
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
    query += ' ORDER BY date DESC NULLS LAST LIMIT 200';
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

    // Classroom announcements are synthetic records, not Gmail messages.
    // Fetch them from Classroom and cache the full text locally.
    if (gmailId.startsWith('classroom:ann:')) {
      const [, , courseId, announcementId] = gmailId.split(':');
      const auth = await getAuthClientForChild(req.user.id, emailRow.child_email);
      const classroom = google.classroom({ version: 'v1', auth });
      const detail = await classroom.courses.announcements.get({
        courseId,
        id: announcementId,
      });

      const bodyText = detail.data?.text || emailRow.snippet || null;
      if (bodyText) {
        pool.query(
          'UPDATE school_emails SET body = $1 WHERE gmail_id = $2',
          [bodyText, gmailId]
        ).catch(err => console.error('Error caching classroom announcement body:', err.message));
      }

      return res.json({ body: bodyText, htmlBody: null });
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
        'UPDATE school_emails SET body = $1, html_body = $2, ai_processed = CASE WHEN ai_summary ILIKE $3 THEN false ELSE ai_processed END WHERE gmail_id = $4',
        [textBody || null, htmlBody || null, '%incompleto%', gmailId]
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
    const extractedDate = email.extracted_date || email.date || new Date();
    const schedule = await getScheduleForChild(req.user.id, email.child_email);
    const timing = inferCalendarTimingFromSchedule({
      subject: email.subject,
      summary: email.ai_summary || email.snippet || 'Reunión detectada',
      extractedDate: new Date(extractedDate),
      schedule,
    });
    const eventResult = await pool.query(
      `INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [`🗓️ ${email.subject}`, email.ai_summary || email.snippet || 'Reunión detectada', timing.startTime, timing.endTime, timing.allDay, '#f59e0b', req.user.id]
    );

    await pool.query(
      'UPDATE school_emails SET synced_to_calendar = true WHERE id = $1',
      [emailId]
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

// GET /api/school-sync/token-stats — AI token usage stats for tuning max_tokens
router.get('/token-stats', authenticate, async (req, res) => {
  const stats = getTokenStats();
  if (!stats) return res.json({ message: 'Sin datos aún. Procesa algunos correos primero.' });
  res.json(stats);
});

// ─── In-memory reprocess progress store ──────────────────────────────────────
// keyed by userId; cleared after client reads a completed job
const reprocessProgress = new Map();

// ─── In-memory sync progress store ──────────────────────────────────────────
// { running, done, step, stepLabel, completed, total, childName, error }
const syncProgress = new Map();

// GET /api/school-sync/sync/progress
router.get('/sync/progress', authenticate, (req, res) => {
  const progress = syncProgress.get(req.user.id);
  if (!progress) return res.json({ running: false, done: true, pct: 100 });
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  res.json({ ...progress, pct });
  if (progress.done) syncProgress.delete(req.user.id);
});

// GET /api/school-sync/reprocess/progress
router.get('/reprocess/progress', authenticate, (req, res) => {
  const progress = reprocessProgress.get(req.user.id);
  if (!progress) return res.json({ running: false });

  res.json(progress);

  // Clean up once the client has seen the completed result
  if (progress.done) reprocessProgress.delete(req.user.id);
});

// POST /api/school-sync/process-emails — process unread emails with AI
router.post('/process-emails', authenticate, async (req, res) => {
  try {
    const result = await processUnreadEmails(req.user.id);
    res.json({ success: true, processed: result.count, created: result.eventsCreated });
  } catch (err) {
    console.error('Error processing emails:', err);
    res.status(500).json({ error: 'Error al procesar correos' });
  }
});

// POST /api/school-sync/reprocess — starts background reprocess, returns immediately
router.post('/reprocess', authenticate, (req, res) => {
  const { dateFrom, dateTo } = req.body;
  if (!dateFrom || !dateTo) {
    return res.status(400).json({ error: 'dateFrom y dateTo requeridos' });
  }

  const userId = req.user.id;

  if (reprocessProgress.get(userId)?.running) {
    return res.status(409).json({ error: 'Ya hay un reprocesamiento en curso' });
  }

  reprocessProgress.set(userId, { running: true, done: false, total: 0, processed: 0, eventsCreated: 0, error: null });
  res.json({ started: true });

  // Run in background — no await
  reprocessEmailsByRange(userId, dateFrom, dateTo, reprocessProgress).catch(err => {
    console.error('Error reprocessing emails:', err);
    const prev = reprocessProgress.get(userId) || {};
    reprocessProgress.set(userId, { ...prev, running: false, done: true, error: err.message });
  });
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

async function getScheduleForChild(userId, childEmail) {
  const result = await pool.query(
    'SELECT day_of_week, subject, start_time, end_time FROM school_schedules WHERE user_id = $1 AND child_email = $2 ORDER BY day_of_week, start_time',
    [userId, childEmail]
  );
  return result.rows;
}

function normalizeSubject(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function subjectMatches(scheduleSubject, eventText) {
  const normalizedSchedule = normalizeSubject(scheduleSubject);
  const normalizedEvent = normalizeSubject(eventText);
  if (!normalizedSchedule || !normalizedEvent) return false;
  if (normalizedEvent.includes(normalizedSchedule) || normalizedSchedule.includes(normalizedEvent)) return true;

  const scheduleWords = normalizedSchedule.split(' ').filter(word => word.length >= 4);
  const eventWords = normalizedEvent.split(' ').filter(word => word.length >= 4);
  return scheduleWords.some(scheduleWord =>
    eventWords.some(eventWord =>
      scheduleWord === eventWord || scheduleWord.startsWith(eventWord) || eventWord.startsWith(scheduleWord)
    )
  );
}

function inferCalendarTimingFromSchedule({ subject, summary, extractedDate, schedule }) {
  if (!extractedDate || !(extractedDate instanceof Date) || Number.isNaN(extractedDate.getTime())) {
    return { startTime: extractedDate, endTime: null, allDay: true };
  }

  const hasExplicitTime = extractedDate.getHours() !== 12 || extractedDate.getMinutes() !== 0;
  if (hasExplicitTime || !Array.isArray(schedule) || schedule.length === 0) {
    return { startTime: extractedDate, endTime: hasExplicitTime ? extractedDate : null, allDay: !hasExplicitTime };
  }

  const jsDay = extractedDate.getDay();
  const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1;
  const candidateText = [subject, summary].filter(Boolean).join(' ');
  const matchingSlot = schedule
    .filter(slot => Number(slot.day_of_week) === dayOfWeek)
    .find(slot => subjectMatches(slot.subject, candidateText));

  if (!matchingSlot?.start_time) {
    return { startTime: extractedDate, endTime: null, allDay: true };
  }

  const [startHour, startMinute] = matchingSlot.start_time.substring(0, 5).split(':').map(Number);
  const startTime = new Date(extractedDate);
  startTime.setHours(startHour, startMinute, 0, 0);

  const endTime = new Date(startTime);
  if (matchingSlot.end_time) {
    const [endHour, endMinute] = matchingSlot.end_time.substring(0, 5).split(':').map(Number);
    endTime.setHours(endHour, endMinute, 0, 0);
  } else {
    endTime.setMinutes(endTime.getMinutes() + 45);
  }

  return { startTime, endTime, allDay: false };
}

async function processUnreadEmails(userId) {
  let processedCount = 0;
  let eventsCreated = 0;

  try {
    const emails = await pool.query(
      `SELECT id, child_email, subject, snippet, body, date FROM school_emails
       WHERE user_id = $1
         AND is_read = false
         AND ai_processed = false
         AND (date IS NULL OR date >= CURRENT_DATE - INTERVAL '60 days')
       ORDER BY date ASC`,
      [userId]
    );

    const scheduleCache = {};
    for (const email of emails.rows) {
      try {
        if (!scheduleCache[email.child_email]) {
          scheduleCache[email.child_email] = await getScheduleForChild(userId, email.child_email);
        }
        const schedule = scheduleCache[email.child_email];
        // Use full body when cached; fall back to snippet
        const content = email.body ? email.body.slice(0, 3000) : email.snippet;
        const { extractedDate, type, summary, model } = await processEmail(email.subject, content, email.date, schedule);

        // Save AI processing results
        await pool.query(
          `UPDATE school_emails
           SET ai_processed = true, ai_summary = $1, extracted_date = $2, ai_model = $3, ai_type = $4
           WHERE id = $5`,
          [summary, extractedDate, model, type, email.id]
        );
        processedCount++;

        // Auto-create calendar event if date was extracted and is in the future
        if (extractedDate && extractedDate >= new Date()) {
          try {
            const timing = inferCalendarTimingFromSchedule({
              subject: email.subject,
              summary,
              extractedDate,
              schedule,
            });
            await pool.query(
              `INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [`🗓️ ${email.subject}`, summary || 'Evento detectado por IA', timing.startTime, timing.endTime, timing.allDay, '#f59e0b', userId]
            );
            eventsCreated++;
          } catch (err) {
            console.error('Error creating calendar event:', err.message);
          }
        }
      } catch (err) {
        console.error(`Error processing email ${email.id}:`, err.message);
      }
    }

    console.log(`✓ Processed ${processedCount} emails, created ${eventsCreated} calendar events`);
    return { count: processedCount, eventsCreated };
  } catch (err) {
    console.error('Error in processUnreadEmails:', err.message);
    throw err;
  }
}

async function reprocessEmailsByRange(userId, dateFrom, dateTo, progressStore) {
  let processedCount = 0;
  let eventsCreated = 0;

  const setProgress = (patch) => {
    if (!progressStore) return;
    progressStore.set(userId, { ...progressStore.get(userId), ...patch });
  };

  try {
    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);

    const emails = await pool.query(
      `SELECT id, child_email, subject, snippet, body, date FROM school_emails
       WHERE user_id = $1
         AND date >= $2
         AND date <= $3
       ORDER BY date ASC`,
      [userId, fromDate, toDate]
    );

    setProgress({ total: emails.rows.length, processed: 0, eventsCreated: 0 });

    const scheduleCache = {};
    for (const email of emails.rows) {
      try {
        if (!scheduleCache[email.child_email]) {
          scheduleCache[email.child_email] = await getScheduleForChild(userId, email.child_email);
        }
        const schedule = scheduleCache[email.child_email];
        const content = email.body ? email.body.slice(0, 3000) : email.snippet;
        const { extractedDate, type, summary, model } = await processEmail(email.subject, content, email.date, schedule);

        await pool.query(
          `UPDATE school_emails
           SET ai_processed = true, ai_summary = $1, extracted_date = $2, ai_model = $3, ai_type = $4
           WHERE id = $5`,
          [summary, extractedDate, model, type, email.id]
        );
        processedCount++;
        setProgress({ processed: processedCount });

        if (extractedDate && extractedDate >= new Date()) {
          try {
            const existing = await pool.query(
              `SELECT id FROM calendar_events
               WHERE created_by = $1
                 AND title LIKE $2
                 AND start_time::date = $3::date`,
              [userId, `%${email.subject}%`, extractedDate]
            );

            if (existing.rows.length === 0) {
              const timing = inferCalendarTimingFromSchedule({
                subject: email.subject,
                summary,
                extractedDate,
                schedule,
              });
              await pool.query(
                `INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [`🗓️ ${email.subject}`, summary || 'Evento detectado por IA', timing.startTime, timing.endTime, timing.allDay, '#f59e0b', userId]
              );
              eventsCreated++;
              setProgress({ eventsCreated });
            }
          } catch (err) {
            console.error('Error creating calendar event:', err.message);
          }
        }
      } catch (err) {
        console.error(`Error processing email ${email.id}:`, err.message);
      }
    }

    setProgress({ running: false, done: true, processed: processedCount, eventsCreated });
    console.log(`✓ Reprocessed ${processedCount} emails, created ${eventsCreated} calendar events`);
    return { count: processedCount, eventsCreated };
  } catch (err) {
    console.error('Error in reprocessEmailsByRange:', err.message);
    throw err;
  }
}

async function syncGmail(userId, childEmail, auth) {
  const gmail = google.gmail({ version: 'v1', auth });

  // Use narrow queries and dedupe the results to avoid Gmail search precedence issues.
  // Parent-forwarded emails may not always keep mhrehbein@gmail.com in the From header,
  // so we also search for the parent email anywhere in the message metadata/body.
  const queries = [
    { q: 'from:cicpm.cl newer_than:60d', includeSpamTrash: false },
    { q: 'from:classroom.google.com newer_than:60d', includeSpamTrash: false },
    { q: 'from:mhrehbein@gmail.com newer_than:60d', includeSpamTrash: true },
    { q: 'mhrehbein@gmail.com newer_than:60d', includeSpamTrash: true },
  ];

  const seenIds = new Set();
  const messages = [];

  for (const { q, includeSpamTrash } of queries) {
    let pageToken;
    do {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q,
        maxResults: 100,
        pageToken,
        ...(includeSpamTrash ? { includeSpamTrash: true } : {}),
      });
      for (const m of (listRes.data.messages || [])) {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          messages.push(m);
        }
      }
      pageToken = listRes.data.nextPageToken;
    } while (pageToken);
  }

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
    const isUnread = detail.data.labelIds?.includes('UNREAD') || false;

    await pool.query(
      `INSERT INTO school_emails (user_id, child_email, gmail_id, from_address, subject, snippet, date, is_read)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (gmail_id) DO NOTHING`,
      [userId, childEmail, msg.id, getHeader('From'), getHeader('Subject'), detail.data.snippet, parsedDate, !isUnread]
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
      let cwPageToken;
      do {
        const res = await classroom.courses.courseWork.list({
          courseId: course.id,
          courseWorkStates: ['PUBLISHED'],
          orderBy: 'updateTime desc',
          pageSize: 100,
          pageToken: cwPageToken,
        });
        (res.data.courseWork || []).forEach(w => works.push(w));
        cwPageToken = res.data.nextPageToken;
      } while (cwPageToken);
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

async function syncClassroomAnnouncements(userId, childEmail, auth) {
  const classroom = google.classroom({ version: 'v1', auth });
  const { analyzeImage } = require('../services/ollamaService');

  let courses = [];
  try {
    const res = await classroom.courses.list({ studentId: 'me', courseStates: ['ACTIVE'] });
    courses = res.data.courses || [];
  } catch (err) {
    console.error(`Error obteniendo cursos para anuncios (${childEmail}):`, err.message);
    return;
  }

  for (const course of courses) {
    let announcements = [];
    try {
      let annPageToken;
      do {
        const res = await classroom.courses.announcements.list({
          courseId: course.id,
          announcementStates: ['PUBLISHED'],
          orderBy: 'updateTime desc',
          pageSize: 100,
          pageToken: annPageToken,
        });
        (res.data.announcements || []).forEach(a => announcements.push(a));
        annPageToken = res.data.nextPageToken;
      } while (annPageToken);
    } catch (err) {
      if (err.code === 403) {
        console.warn(`[school-sync] Sin permiso de anuncios para ${childEmail} — debe reconectarse para otorgar el nuevo scope.`);
        return;
      }
      console.error(`Error obteniendo anuncios del curso "${course.name}":`, err.message);
      continue;
    }

    for (const ann of announcements) {
      const gmailId = `classroom:ann:${course.id}:${ann.id}`;

      const annDate = ann.creationTime ? new Date(ann.creationTime) : null;
      const annUpdateTime = ann.updateTime ? new Date(ann.updateTime) : annDate;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      // Use updateTime for the age check so recently-modified old announcements are not skipped
      const ageCheckDate = annUpdateTime || annDate;
      if (ageCheckDate && ageCheckDate < thirtyDaysAgo) continue;

      // Check if already stored and unchanged (compare updateTime to avoid re-processing)
      const exists = await pool.query(
        'SELECT id, updated_at FROM school_emails WHERE gmail_id = $1',
        [gmailId]
      );
      if (exists.rows.length > 0 && annUpdateTime) {
        const storedAt = exists.rows[0].updated_at ? new Date(exists.rows[0].updated_at) : null;
        // Skip only if we already have a version as recent as the announcement's updateTime
        if (storedAt && storedAt >= annUpdateTime) continue;
      }

      // Build snippet from text content
      let snippet = (ann.text || '').slice(0, 500);

      // Collect ALL Drive file materials (images by mimeType or by filename extension)
      const allDriveFiles = (ann.materials || [])
        .map(m => m.driveFile?.driveFile)
        .filter(f => f?.id && (
          /image\//i.test(f.mimeType || '') ||
          /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(f.title || '')
        ));

      // Also collect non-image attachments (links, YouTube, forms, etc.) for display
      const otherMaterials = (ann.materials || []).flatMap(m => {
        if (m.link) return [{ type: 'link', title: m.link.title || m.link.url, url: m.link.url }];
        if (m.youtubeVideo) return [{ type: 'youtube', title: m.youtubeVideo.title, url: `https://youtu.be/${m.youtubeVideo.id}` }];
        if (m.form) return [{ type: 'form', title: m.form.title, url: m.form.formUrl }];
        const df = m.driveFile?.driveFile;
        if (df?.id && !allDriveFiles.find(f => f.id === df.id)) {
          return [{ type: 'drive', title: df.title || df.id, url: df.alternateLink, id: df.id }];
        }
        return [];
      });

      // Build attachments array with thumbnail URLs for images
      const attachments = [];
      let accessToken = null;

      if (allDriveFiles.length > 0) {
        try {
          const tokenResult = await auth.getAccessToken();
          accessToken = tokenResult?.token || tokenResult?.credentials?.access_token;
        } catch (err) {
          console.error('Error obteniendo access token para imágenes:', err.message);
        }

        for (const file of allDriveFiles) {
          const thumbnailUrl = `https://drive.google.com/thumbnail?id=${file.id}&sz=w1200`;
          attachments.push({
            type: 'image',
            id: file.id,
            title: file.title || file.id,
            thumbnailUrl,
            mimeType: file.mimeType || 'image/jpeg',
          });

          // Also describe with vision AI for searchability in snippet
          if (accessToken) {
            try {
              const description = await analyzeImage(file.id, accessToken);
              if (description) {
                snippet += `\n[Imagen adjunta: ${description}]`;
              }
            } catch (err) {
              console.error('Error analizando imagen de anuncio:', err.message);
            }
          }
        }
      }

      // Add non-image materials to attachments too
      for (const m of otherMaterials) attachments.push(m);

      const subject = `${course.name}: ${(ann.text || '').slice(0, 60).replace(/\n/g, ' ')}…`;

      await pool.query(
        `INSERT INTO school_emails (user_id, child_email, gmail_id, from_address, subject, snippet, body, date, is_read, updated_at, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
         ON CONFLICT (gmail_id) DO UPDATE SET
           from_address = EXCLUDED.from_address,
           subject      = EXCLUDED.subject,
           snippet      = EXCLUDED.snippet,
           body         = EXCLUDED.body,
           date         = EXCLUDED.date,
           attachments  = EXCLUDED.attachments,
           updated_at   = NOW()`,
        [userId, childEmail, gmailId, 'Classroom', subject, snippet, ann.text || null, annDate, false, JSON.stringify(attachments)]
      );
    }
  }
}

async function syncChild(userId, childEmail, onStep = null, childName = null) {
  const label = childName || childEmail.split('@')[0];
  const step = (text) => { if (onStep) onStep(text); };
  try {
    step(`${label}: autenticando…`);
    const auth = await getAuthClientForChild(userId, childEmail);
    step(`${label}: descargando correos…`);
    await syncGmail(userId, childEmail, auth);
    step(`${label}: descargando tareas…`);
    await syncClassroom(userId, childEmail, auth);
    step(`${label}: descargando anuncios…`);
    await syncClassroomAnnouncements(userId, childEmail, auth);
    step(`${label}: procesando con IA…`);
    // Process unread emails with AI after sync
    await processUnreadEmails(userId).catch(err =>
      console.error('Error processing emails with AI:', err.message)
    );
    await pool.query(
      'UPDATE google_tokens SET last_sync = NOW() WHERE user_id = $1 AND child_email = $2',
      [userId, childEmail]
    );
    console.log(`✓ Sync completado para ${childEmail}`);
  } catch (err) {
    console.error(`Error sincronizando ${childEmail}:`, err.message);
    // Count remaining steps as completed so progress doesn't stall
    if (onStep) { step(`${label}: error — ${err.message}`); }
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
