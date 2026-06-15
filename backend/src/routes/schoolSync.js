const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { processEmail, getTokenStats, checkTokenHealth } = require('../services/aiService');

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

// ─── Permisos de familia ─────────────────────────────────────────────────────
// parent → ve todos los hijos. child → solo el hijo cuyo email coincide con el suyo.

async function getVisibleChildIds(user) {
  if (!user) return [];
  // family_role no viaja en JWTs viejos, así que se resuelve siempre desde users.
  let familyRole = user.family_role;
  let email = user.email;
  if (!familyRole || !email) {
    const r = await pool.query('SELECT email, family_role FROM users WHERE id = $1', [user.id]);
    if (r.rows[0]) {
      familyRole = r.rows[0].family_role || 'parent';
      email = r.rows[0].email;
    }
  }
  if (familyRole === 'child') {
    const r = await pool.query('SELECT id FROM children WHERE email = $1', [email]);
    return r.rows.map(x => x.id);
  }
  const r = await pool.query('SELECT id FROM children');
  return r.rows.map(x => x.id);
}

async function getChildByEmail(email) {
  const r = await pool.query('SELECT id, email, name FROM children WHERE email = $1', [email]);
  return r.rows[0] || null;
}

async function getChildById(childId) {
  const r = await pool.query('SELECT id, email, name FROM children WHERE id = $1', [childId]);
  return r.rows[0] || null;
}

async function ensureChild(email, name) {
  const existing = await getChildByEmail(email);
  if (existing) return existing;
  const r = await pool.query(
    'INSERT INTO children (email, name) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET name = COALESCE(children.name, EXCLUDED.name) RETURNING id, email, name',
    [email, name || email.split('@')[0]]
  );
  return r.rows[0];
}

// ─── GET /api/school-sync/status ─────────────────────────────────────────────
// Devuelve el estado por hijo (no por usuario). Toda la familia ve lo mismo.
router.get('/status', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.email AS child_email, c.name AS child_name,
              gt.last_sync, gt.created_at, gt.token_valid,
              gt.connected_by_user_id, gt.connected_at,
              u.name AS connected_by_name, u.email AS connected_by_email
         FROM children c
         LEFT JOIN google_tokens gt ON gt.child_id = c.id
         LEFT JOIN users u ON u.id = gt.connected_by_user_id
        ORDER BY c.name`
    );
    res.json({ connected: result.rows });
  } catch (err) {
    console.error('Error en status:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── GET /api/school-sync/auth-url ───────────────────────────────────────────
// Si ya existe token activo para ese hijo, responde 409 a menos que ?force=1.
router.get('/auth-url', authenticate, async (req, res) => {
  const { child_email, child_name, force } = req.query;
  if (!child_email) return res.status(400).json({ error: 'child_email requerido' });

  // Asegurar que el child existe (auto-creación al primer intento de conexión)
  const child = await ensureChild(child_email, child_name);

  if (!force) {
    const existing = await pool.query(
      `SELECT gt.token_valid, gt.connected_at, u.name AS connected_by_name, u.email AS connected_by_email
         FROM google_tokens gt
         LEFT JOIN users u ON u.id = gt.connected_by_user_id
        WHERE gt.child_id = $1 AND gt.token_valid = TRUE`,
      [child.id]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return res.status(409).json({
        error: 'already_connected',
        connected_by_name: row.connected_by_name,
        connected_by_email: row.connected_by_email,
        connected_at: row.connected_at,
      });
    }
  }

  const state = jwt.sign(
    { userId: req.user.id, childId: child.id, childEmail: child.email, childName: child.name },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });

  res.json({ url });
});

// ─── GET /api/school-sync/callback ───────────────────────────────────────────
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';

  if (error) return res.redirect(`${frontendUrl}/school-sync?error=${encodeURIComponent(error)}`);
  if (!code || !state) return res.redirect(`${frontendUrl}/school-sync?error=missing_params`);

  let decoded;
  try {
    decoded = jwt.verify(state, process.env.JWT_SECRET);
  } catch (err) {
    return res.redirect(`${frontendUrl}/school-sync?error=invalid_state`);
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    const { userId, childId, childEmail } = decoded;

    await pool.query(
      `INSERT INTO google_tokens (child_id, access_token, refresh_token, token_expiry, connected_by_user_id, connected_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (child_id) DO UPDATE SET
         access_token         = EXCLUDED.access_token,
         refresh_token        = COALESCE(EXCLUDED.refresh_token, google_tokens.refresh_token),
         token_expiry         = EXCLUDED.token_expiry,
         token_valid          = TRUE,
         connected_by_user_id = EXCLUDED.connected_by_user_id,
         connected_at         = NOW(),
         updated_at           = NOW()`,
      [
        childId,
        tokens.access_token,
        tokens.refresh_token,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        userId,
      ]
    );

    syncChild(childId).catch(err =>
      console.error('Error en sync inicial:', err.message)
    );

    res.redirect(`${frontendUrl}/school-sync?connected=${encodeURIComponent(childEmail)}`);
  } catch (err) {
    console.error('Error en callback OAuth:', err);
    res.redirect(`${frontendUrl}/school-sync?error=token_exchange_failed`);
  }
});

// ─── POST /api/school-sync/sync ──────────────────────────────────────────────
router.post('/sync', authenticate, async (req, res) => {
  try {
    const visibleIds = await getVisibleChildIds(req.user);
    const result = await pool.query(
      `SELECT c.id, c.email, c.name
         FROM children c
         JOIN google_tokens gt ON gt.child_id = c.id
        WHERE c.id = ANY($1::int[]) AND gt.token_valid = TRUE
        ORDER BY c.name`,
      [visibleIds]
    );

    const children = result.rows;
    const userId = req.user.id;

    const STEPS_PER_CHILD = 5;
    syncProgress.set(userId, {
      running: true, done: false,
      completed: 0, total: children.length * STEPS_PER_CHILD,
      stepLabel: 'Iniciando…', error: null,
    });

    res.json({ success: true, synced: children.length, background: true });

    const step = (label) => {
      const prev = syncProgress.get(userId);
      if (prev) syncProgress.set(userId, { ...prev, completed: prev.completed + 1, stepLabel: label });
    };

    for (const row of children) {
      await syncChild(row.id, step, row.name).catch(err =>
        console.error(`Error en sync manual (${row.email}):`, err.message)
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

// ─── GET /api/school-sync/emails ─────────────────────────────────────────────
router.get('/emails', authenticate, async (req, res) => {
  const { child } = req.query;
  try {
    const visibleIds = await getVisibleChildIds(req.user);
    if (visibleIds.length === 0) return res.json([]);

    let filterIds = visibleIds;
    if (child) {
      const c = await getChildByEmail(child);
      if (!c || !visibleIds.includes(c.id)) return res.json([]);
      filterIds = [c.id];
    }

    const result = await pool.query(
      `SELECT se.id, se.gmail_id, se.from_address, se.subject, se.snippet,
              se.date, se.is_read, se.created_at, se.ai_processed, se.ai_summary,
              se.extracted_date, se.ai_model, se.ai_type, se.updated_at,
              se.attachments, se.synced_to_calendar, se.calendar_event_id, se.child_id,
              c.email AS child_email, c.name AS child_name
         FROM school_emails se
         JOIN children c ON c.id = se.child_id
        WHERE se.child_id = ANY($1::int[])
        ORDER BY se.date DESC NULLS LAST
        LIMIT 200`,
      [filterIds]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error en /emails:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── GET /api/school-sync/assignments ────────────────────────────────────────
router.get('/assignments', authenticate, async (req, res) => {
  const { child } = req.query;
  try {
    const visibleIds = await getVisibleChildIds(req.user);
    if (visibleIds.length === 0) return res.json([]);

    let filterIds = visibleIds;
    if (child) {
      const c = await getChildByEmail(child);
      if (!c || !visibleIds.includes(c.id)) return res.json([]);
      filterIds = [c.id];
    }

    // Filtra por año vigente. Prioriza update_time de Classroom (fuente de verdad);
    // si está NULL (registros pre-migración 017) usa el año del course_name o de la due_date.
    // Registros sin update_time, sin año en el course_name y sin due_date se excluyen
    // porque no se puede determinar su año con certeza (created_at se renueva en re-syncs).
    const result = await pool.query(
      `SELECT sa.*, c.email AS child_email, c.name AS child_name
         FROM school_assignments sa
         JOIN children c ON c.id = sa.child_id
        WHERE sa.child_id = ANY($1::int[])
          AND (
            sa.update_time IS NOT NULL AND sa.update_time >= $2
            OR sa.update_time IS NULL AND (
              sa.course_name ~ '(20[0-9]{2})'
              AND EXISTS (
                SELECT 1 FROM regexp_matches(sa.course_name, '(20[0-9]{2})', 'g') AS m
                HAVING bool_or(m[1]::int = $3)
              )
            )
            OR sa.update_time IS NULL
               AND sa.due_date IS NOT NULL
               AND EXTRACT(YEAR FROM sa.due_date)::int >= $3
          )
        ORDER BY sa.due_date ASC NULLS LAST`,
      [filterIds, `${new Date().getFullYear()}-01-01 00:00:00`, new Date().getFullYear()]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error en /assignments:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── POST /api/school-sync/sync-to-calendar ─────────────────────────────────
router.post('/sync-to-calendar', authenticate, async (req, res) => {
  const { assignmentId, suggestedDate } = req.body;
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId requerido' });

  try {
    const visibleIds = await getVisibleChildIds(req.user);
    const assignResult = await pool.query(
      'SELECT * FROM school_assignments WHERE id = $1 AND child_id = ANY($2::int[])',
      [assignmentId, visibleIds]
    );
    if (assignResult.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    const task = assignResult.rows[0];

    if (task.synced_to_calendar) {
      return res.status(400).json({ error: 'Esta tarea ya fue agregada al calendario' });
    }

    const description = [task.course_name, task.description].filter(Boolean).join('\n');
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

// ─── GET /api/school-sync/emails/:gmailId/body ──────────────────────────────
router.get('/emails/:gmailId/body', authenticate, async (req, res) => {
  const { gmailId } = req.params;
  try {
    const visibleIds = await getVisibleChildIds(req.user);
    const emailResult = await pool.query(
      `SELECT se.*, c.email AS child_email
         FROM school_emails se
         JOIN children c ON c.id = se.child_id
        WHERE se.gmail_id = $1 AND se.child_id = ANY($2::int[])`,
      [gmailId, visibleIds]
    );
    if (emailResult.rows.length === 0) return res.status(404).json({ error: 'Correo no encontrado' });
    const emailRow = emailResult.rows[0];

    const existingAtts = Array.isArray(emailRow.attachments) ? emailRow.attachments : [];
    const gmailAttsAlreadyFetched = emailRow.attachments !== null;

    if (gmailId.startsWith('classroom:ann:')) {
      if (emailRow.body) {
        return res.json({ body: emailRow.body, htmlBody: null, attachments: existingAtts });
      }
      const [, , courseId, announcementId] = gmailId.split(':');
      const auth = await getAuthClient(emailRow.child_id);
      const classroom = google.classroom({ version: 'v1', auth });
      const detail = await classroom.courses.announcements.get({ courseId, id: announcementId });
      const bodyText = detail.data?.text || emailRow.snippet || null;
      if (bodyText) {
        pool.query('UPDATE school_emails SET body = $1 WHERE gmail_id = $2', [bodyText, gmailId])
          .catch(err => console.error('Error caching classroom announcement body:', err.message));
      }
      return res.json({ body: bodyText, htmlBody: null, attachments: existingAtts });
    }

    if ((emailRow.body || emailRow.html_body) && gmailAttsAlreadyFetched) {
      return res.json({ body: emailRow.body || null, htmlBody: emailRow.html_body || null, attachments: existingAtts });
    }

    const auth = await getAuthClient(emailRow.child_id);
    const gmail = google.gmail({ version: 'v1', auth });
    const detail = await gmail.users.messages.get({ userId: 'me', id: gmailId, format: 'full' });

    const textBody = emailRow.body || extractTextBody(detail.data.payload);
    const htmlBody = emailRow.html_body || extractHtmlBody(detail.data.payload);
    const gmailAttachments = extractAttachments(detail.data.payload);

    const mergedAtts = existingAtts.filter(a => a.type !== 'gmail');
    for (const a of gmailAttachments) mergedAtts.push({ ...a, type: 'gmail' });

    pool.query(
      'UPDATE school_emails SET body = $1, html_body = $2, attachments = $3, ai_processed = CASE WHEN ai_summary ILIKE $4 THEN false ELSE ai_processed END WHERE gmail_id = $5',
      [textBody || null, htmlBody || null, JSON.stringify(mergedAtts), '%incompleto%', gmailId]
    ).catch(err => console.error('Error caching email body:', err.message));

    res.json({ body: textBody, htmlBody, attachments: mergedAtts });
  } catch (err) {
    console.error('Error fetching email body:', err);
    if (isTokenRevokedError(err)) {
      const r = await pool.query('SELECT child_id FROM school_emails WHERE gmail_id = $1', [req.params.gmailId]).catch(() => null);
      if (r?.rows[0]?.child_id) await markTokenInvalid(r.rows[0].child_id);
      return res.status(401).json({ error: 'token_revoked' });
    }
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── GET /api/school-sync/emails/:gmailId/attachments/:attachmentId ──────────
router.get('/emails/:gmailId/attachments/:attachmentId', authenticate, async (req, res) => {
  const { gmailId, attachmentId } = req.params;
  try {
    const visibleIds = await getVisibleChildIds(req.user);
    const emailResult = await pool.query(
      `SELECT child_id, attachments
         FROM school_emails
        WHERE gmail_id = $1 AND child_id = ANY($2::int[])`,
      [gmailId, visibleIds]
    );
    if (emailResult.rows.length === 0) return res.status(404).json({ error: 'Correo no encontrado' });

    const emailRow = emailResult.rows[0];
    const atts = Array.isArray(emailRow.attachments) ? emailRow.attachments : [];
    const meta = atts.find(a => a.attachmentId === attachmentId);
    if (!meta) return res.status(404).json({ error: 'Adjunto no encontrado' });

    const auth = await getAuthClient(emailRow.child_id);
    const gmail = google.gmail({ version: 'v1', auth });
    const attRes = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: gmailId,
      id: attachmentId,
    });

    const data = Buffer.from(attRes.data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.filename)}"`);
    res.send(data);
  } catch (err) {
    console.error('Error descargando adjunto:', err);
    if (isTokenRevokedError(err)) return res.status(401).json({ error: 'token_revoked' });
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── POST /api/school-sync/sync-to-calendar/bulk ─────────────────────────────
router.post('/sync-to-calendar/bulk', authenticate, async (req, res) => {
  const { assignmentIds } = req.body;
  if (!Array.isArray(assignmentIds) || assignmentIds.length === 0) {
    return res.status(400).json({ error: 'assignmentIds requerido' });
  }

  const visibleIds = await getVisibleChildIds(req.user);
  const results = [];
  for (const id of assignmentIds) {
    try {
      const assignResult = await pool.query(
        'SELECT * FROM school_assignments WHERE id = $1 AND child_id = ANY($2::int[])',
        [id, visibleIds]
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
      const startTime = task.due_date || new Date();
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

// ─── POST /api/school-sync/sync-email-to-calendar ────────────────────────────
router.post('/sync-email-to-calendar', authenticate, async (req, res) => {
  const { emailId } = req.body;
  if (!emailId) return res.status(400).json({ error: 'emailId requerido' });

  try {
    const visibleIds = await getVisibleChildIds(req.user);
    const emailResult = await pool.query(
      'SELECT * FROM school_emails WHERE id = $1 AND child_id = ANY($2::int[])',
      [emailId, visibleIds]
    );
    if (emailResult.rows.length === 0) return res.status(404).json({ error: 'Correo no encontrado' });

    const email = emailResult.rows[0];
    if (email.calendar_event_id) {
      return res.status(400).json({ error: 'Este correo ya fue agregado al calendario' });
    }

    const extractedDate = email.extracted_date || email.date || new Date();
    const schedule = await getScheduleForChild(email.child_id);
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
      'UPDATE school_emails SET synced_to_calendar = true, calendar_event_id = $1 WHERE id = $2',
      [eventResult.rows[0].id, emailId]
    );

    res.json({ success: true, eventId: eventResult.rows[0].id });
  } catch (err) {
    console.error('Error syncing email to calendar:', err);
    res.status(500).json({ error: 'Error al agregar reunión al calendario' });
  }
});

// ─── GET /api/school-sync/schedules ──────────────────────────────────────────
router.get('/schedules', authenticate, async (req, res) => {
  try {
    const visibleIds = await getVisibleChildIds(req.user);
    if (visibleIds.length === 0) return res.json([]);
    const result = await pool.query(
      `SELECT ss.*, c.email AS child_email, c.name AS child_name
         FROM school_schedules ss
         JOIN children c ON c.id = ss.child_id
        WHERE ss.child_id = ANY($1::int[])
        ORDER BY c.email, ss.day_of_week, ss.period_order`,
      [visibleIds]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo horarios:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── POST /api/school-sync/schedules ─────────────────────────────────────────
router.post('/schedules', authenticate, async (req, res) => {
  const { child_email, schedule } = req.body;
  if (!child_email || !Array.isArray(schedule)) {
    return res.status(400).json({ error: 'child_email y schedule[] requeridos' });
  }
  try {
    const visibleIds = await getVisibleChildIds(req.user);
    const child = await getChildByEmail(child_email);
    if (!child || !visibleIds.includes(child.id)) {
      return res.status(403).json({ error: 'No tienes permiso sobre este hijo' });
    }
    await pool.query('DELETE FROM school_schedules WHERE child_id = $1', [child.id]);
    for (const entry of schedule) {
      await pool.query(
        `INSERT INTO school_schedules (child_id, day_of_week, period_order, subject, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [child.id, entry.day_of_week, entry.period_order, entry.subject,
         entry.start_time || null, entry.end_time || null]
      );
    }
    res.json({ success: true, saved: schedule.length });
  } catch (err) {
    console.error('Error guardando horarios:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── DELETE /api/school-sync/schedules/:childEmail ───────────────────────────
router.delete('/schedules/:childEmail', authenticate, async (req, res) => {
  try {
    const visibleIds = await getVisibleChildIds(req.user);
    const child = await getChildByEmail(decodeURIComponent(req.params.childEmail));
    if (!child || !visibleIds.includes(child.id)) {
      return res.status(403).json({ error: 'No tienes permiso sobre este hijo' });
    }
    await pool.query('DELETE FROM school_schedules WHERE child_id = $1', [child.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error borrando horarios:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── DELETE /api/school-sync/disconnect ──────────────────────────────────────
router.delete('/disconnect', authenticate, async (req, res) => {
  const { child_email } = req.body;
  if (!child_email) return res.status(400).json({ error: 'child_email requerido' });

  try {
    const visibleIds = await getVisibleChildIds(req.user);
    const child = await getChildByEmail(child_email);
    if (!child || !visibleIds.includes(child.id)) {
      return res.status(403).json({ error: 'No tienes permiso sobre este hijo' });
    }
    const result = await pool.query(
      'DELETE FROM google_tokens WHERE child_id = $1 RETURNING id',
      [child.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ─── GET /api/school-sync/token-stats ────────────────────────────────────────
router.get('/token-stats', authenticate, async (req, res) => {
  const stats = getTokenStats();
  const health = checkTokenHealth();
  if (!stats) return res.json({ message: 'Sin datos aún. Procesa algunos correos primero.' });
  res.json({ ...stats, health });
});

// ─── In-memory progress stores ───────────────────────────────────────────────
const reprocessProgress = new Map();
const syncProgress = new Map();

router.get('/sync/progress', authenticate, (req, res) => {
  const progress = syncProgress.get(req.user.id);
  if (!progress) return res.json({ running: false, done: true, pct: 100 });
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  res.json({ ...progress, pct });
  if (progress.done) syncProgress.delete(req.user.id);
});

router.get('/reprocess/progress', authenticate, (req, res) => {
  const progress = reprocessProgress.get(req.user.id);
  if (!progress) return res.json({ running: false });
  res.json(progress);
  if (progress.done) reprocessProgress.delete(req.user.id);
});

// ─── POST /api/school-sync/process-emails ────────────────────────────────────
router.post('/process-emails', authenticate, async (req, res) => {
  try {
    const visibleIds = await getVisibleChildIds(req.user);
    const result = await processUnreadEmails(visibleIds, req.user.id);
    res.json({ success: true, processed: result.count, created: result.eventsCreated });
  } catch (err) {
    console.error('Error processing emails:', err);
    res.status(500).json({ error: 'Error al procesar correos' });
  }
});

// ─── POST /api/school-sync/reprocess ─────────────────────────────────────────
router.post('/reprocess', authenticate, (req, res) => {
  const { dateFrom, dateTo } = req.body;
  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom y dateTo requeridos' });

  const userId = req.user.id;
  if (reprocessProgress.get(userId)?.running) {
    return res.status(409).json({ error: 'Ya hay un reprocesamiento en curso' });
  }

  reprocessProgress.set(userId, { running: true, done: false, total: 0, processed: 0, eventsCreated: 0, error: null });
  res.json({ started: true });

  (async () => {
    try {
      const visibleIds = await getVisibleChildIds(req.user);
      await reprocessEmailsByRange(visibleIds, userId, dateFrom, dateTo, reprocessProgress);
    } catch (err) {
      console.error('Error reprocessing emails:', err);
      const prev = reprocessProgress.get(userId) || {};
      reprocessProgress.set(userId, { ...prev, running: false, done: true, error: err.message });
    }
  })();
});

// ─── AI Training / Feedback ──────────────────────────────────────────────────

router.get('/training/queue', authenticate, async (req, res) => {
  try {
    const visibleIds = await getVisibleChildIds(req.user);
    const { rows } = await pool.query(
      `SELECT se.id, se.gmail_id, se.subject, se.snippet, se.from_address, se.date,
              se.ai_summary, se.ai_type, se.extracted_date, se.ai_model,
              se.ai_feedback, se.ai_observation, se.ai_original_type,
              c.name AS child_name
         FROM school_emails se
         JOIN children c ON c.id = se.child_id
        WHERE se.child_id = ANY($1::int[])
          AND se.ai_processed = true
          AND se.ai_feedback IS NULL
        ORDER BY se.date DESC`,
      [visibleIds]
    );
    const { rows: stats } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE ai_processed = true) AS total,
         COUNT(*) FILTER (WHERE ai_processed = true AND ai_feedback IS NOT NULL) AS reviewed
         FROM school_emails WHERE child_id = ANY($1::int[])`,
      [visibleIds]
    );
    res.json({ queue: rows, stats: stats[0] });
  } catch (err) {
    console.error('Error loading training queue:', err.message);
    res.status(500).json({ error: 'Error cargando cola de entrenamiento' });
  }
});

router.patch('/emails/:gmailId/feedback', authenticate, async (req, res) => {
  try {
    const { gmailId } = req.params;
    const { feedback, correctedType, observation } = req.body;
    if (!['approved', 'corrected'].includes(feedback)) {
      return res.status(400).json({ error: 'feedback debe ser "approved" o "corrected"' });
    }
    const visibleIds = await getVisibleChildIds(req.user);
    const { rows } = await pool.query(
      'SELECT id, ai_type FROM school_emails WHERE gmail_id = $1 AND child_id = ANY($2::int[])',
      [gmailId, visibleIds]
    );
    if (!rows.length) return res.status(404).json({ error: 'Email no encontrado' });

    const current = rows[0];
    const newType = feedback === 'corrected' && correctedType ? correctedType : current.ai_type;
    const originalType = feedback === 'corrected' ? current.ai_type : null;

    await pool.query(
      `UPDATE school_emails SET
         ai_feedback = $1,
         ai_type = $2,
         ai_original_type = COALESCE(ai_original_type, $3),
         ai_observation = $4
       WHERE gmail_id = $5`,
      [feedback, newType, originalType, observation || null, gmailId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Error saving feedback:', err.message);
    res.status(500).json({ error: 'Error guardando feedback' });
  }
});

// ─── Email body parsing helpers ──────────────────────────────────────────────

function decodeBase64Url(data) {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

async function fetchBodyIfMissing(childId, email) {
  if (email.body) return email.body.slice(0, 1500);
  if (!email.gmail_id || email.gmail_id.startsWith('classroom:')) return email.snippet;
  try {
    const auth = await getAuthClient(childId);
    const gmail = google.gmail({ version: 'v1', auth });
    const detail = await gmail.users.messages.get({ userId: 'me', id: email.gmail_id, format: 'full' });
    const textBody = extractTextBody(detail.data.payload);
    if (textBody) {
      pool.query('UPDATE school_emails SET body = $1 WHERE id = $2', [textBody, email.id])
        .catch(err => console.error('Error caching email body:', err.message));
      return textBody.slice(0, 1500);
    }
  } catch (err) {
    console.error(`Error fetching body for email ${email.id}:`, err.message);
  }
  return email.snippet;
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

function extractAttachments(payload, results = []) {
  if (!payload) return results;
  const { mimeType, filename, body, parts, headers } = payload;

  let effectiveFilename = filename;
  if (!effectiveFilename && headers) {
    const cd = headers.find(h => h.name.toLowerCase() === 'content-disposition')?.value || '';
    const ctMatch = (headers.find(h => h.name.toLowerCase() === 'content-type')?.value || '').match(/name="?([^";\r\n]+)"?/i);
    const cdMatch = cd.match(/filename\*?="?([^";\r\n]+)"?/i);
    effectiveFilename = (cdMatch?.[1] || ctMatch?.[1] || '').trim();
  }

  if (body?.attachmentId) {
    results.push({
      attachmentId: body.attachmentId,
      filename: effectiveFilename || `adjunto_${results.length + 1}`,
      mimeType: mimeType || 'application/octet-stream',
      size: body.size || 0,
    });
  }
  if (parts) {
    for (const part of parts) extractAttachments(part, results);
  }
  return results;
}

// ─── Sync internals (todos basados en childId) ───────────────────────────────

function isTokenRevokedError(err) {
  const msg = (err?.message || '').toLowerCase();
  const desc = (err?.response?.data?.error_description || '').toLowerCase();
  return msg.includes('token has been expired or revoked') ||
    desc.includes('token has been expired or revoked') ||
    msg.includes('invalid_grant') ||
    (err?.response?.data?.error === 'invalid_grant');
}

async function markTokenInvalid(childId) {
  pool.query(
    'UPDATE google_tokens SET token_valid = FALSE WHERE child_id = $1',
    [childId]
  ).catch(e => console.error('Error marcando token inválido:', e.message));
}

async function getAuthClient(childId) {
  const result = await pool.query(
    'SELECT * FROM google_tokens WHERE child_id = $1',
    [childId]
  );
  if (result.rows.length === 0) throw new Error(`No hay tokens para child_id=${childId}`);

  const row = result.rows[0];
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expiry_date: row.token_expiry ? new Date(row.token_expiry).getTime() : undefined,
  });

  oauth2Client.on('tokens', async (tokens) => {
    const sets = ['updated_at = NOW()', 'token_valid = TRUE'];
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
    vals.push(childId);
    pool
      .query(
        `UPDATE google_tokens SET ${sets.join(', ')} WHERE child_id = $${vals.length}`,
        vals
      )
      .catch(err => console.error('Error guardando tokens renovados:', err.message));
  });

  return oauth2Client;
}

async function getScheduleForChild(childId) {
  const result = await pool.query(
    'SELECT day_of_week, subject, start_time, end_time FROM school_schedules WHERE child_id = $1 ORDER BY day_of_week, start_time',
    [childId]
  );
  return result.rows;
}

function normalizeSubject(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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

const PROCESS_BATCH_SIZE = 10;

async function processUnreadEmails(visibleChildIds, userId) {
  let processedCount = 0;
  let eventsCreated = 0;

  try {
    const scheduleCache = {};

    while (true) {
      const emails = await pool.query(
        `SELECT id, gmail_id, child_id, subject, snippet, body, date FROM school_emails
         WHERE child_id = ANY($1::int[])
           AND is_read = false
           AND ai_processed = false
           AND (date IS NULL OR date >= CURRENT_DATE - INTERVAL '60 days')
         ORDER BY date ASC
         LIMIT $2`,
        [visibleChildIds, PROCESS_BATCH_SIZE]
      );

      if (emails.rows.length === 0) break;

      for (const email of emails.rows) {
        try {
          if (!scheduleCache[email.child_id]) {
            scheduleCache[email.child_id] = await getScheduleForChild(email.child_id);
          }
          const schedule = scheduleCache[email.child_id];
          const content = await fetchBodyIfMissing(email.child_id, email);
          const { extractedDate, type, summary, model } = await processEmail(email.subject, content, email.date, schedule, pool);

          await pool.query(
            `UPDATE school_emails
             SET ai_processed = true, ai_summary = $1, extracted_date = $2, ai_model = $3, ai_type = $4
             WHERE id = $5`,
            [summary, extractedDate, model, type, email.id]
          );
          processedCount++;

          if (extractedDate && extractedDate >= new Date() && (type === 'tarea' || type === 'reunion')) {
            try {
              const existingForEmail = await pool.query(
                `SELECT calendar_event_id FROM school_emails WHERE id = $1 AND calendar_event_id IS NOT NULL`,
                [email.id]
              );
              let alreadyExists = existingForEmail.rows.length > 0;

              if (!alreadyExists && userId) {
                const dup = await pool.query(
                  `SELECT id FROM calendar_events
                   WHERE created_by = $1 AND title = $2 AND start_time::date = $3::date`,
                  [userId, `🗓️ ${email.subject}`, extractedDate]
                );
                alreadyExists = dup.rows.length > 0;
              }

              if (!alreadyExists && userId) {
                const timing = inferCalendarTimingFromSchedule({
                  subject: email.subject, summary, extractedDate, schedule,
                });
                const insertResult = await pool.query(
                  `INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color, created_by)
                   VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                  [`🗓️ ${email.subject}`, summary || 'Evento detectado por IA', timing.startTime, timing.endTime, timing.allDay, '#f59e0b', userId]
                );
                await pool.query(
                  `UPDATE school_emails SET calendar_event_id = $1 WHERE id = $2`,
                  [insertResult.rows[0].id, email.id]
                );
                eventsCreated++;
              }
            } catch (err) {
              console.error('Error creating calendar event:', err.message);
            }
          }
        } catch (err) {
          console.error(`Error processing email ${email.id}:`, err.message);
        }
      }
    }

    console.log(`✓ Processed ${processedCount} emails, created ${eventsCreated} calendar events`);
    return { count: processedCount, eventsCreated };
  } catch (err) {
    console.error('Error in processUnreadEmails:', err.message);
    throw err;
  }
}

async function reprocessEmailsByRange(visibleChildIds, userId, dateFrom, dateTo, progressStore) {
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
      `SELECT id, gmail_id, child_id, subject, snippet, body, date FROM school_emails
       WHERE child_id = ANY($1::int[])
         AND date >= $2 AND date <= $3
       ORDER BY date ASC`,
      [visibleChildIds, fromDate, toDate]
    );

    setProgress({ total: emails.rows.length, processed: 0, eventsCreated: 0 });

    const scheduleCache = {};
    for (const email of emails.rows) {
      try {
        if (!scheduleCache[email.child_id]) {
          scheduleCache[email.child_id] = await getScheduleForChild(email.child_id);
        }
        const schedule = scheduleCache[email.child_id];
        const content = await fetchBodyIfMissing(email.child_id, email);
        const { extractedDate, type, summary, model } = await processEmail(email.subject, content, email.date, schedule, pool);

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
            const existingForEmail = await pool.query(
              `SELECT calendar_event_id FROM school_emails WHERE id = $1 AND calendar_event_id IS NOT NULL`,
              [email.id]
            );
            let alreadyExists = existingForEmail.rows.length > 0;

            if (!alreadyExists) {
              const dup = await pool.query(
                `SELECT id FROM calendar_events
                 WHERE created_by = $1 AND title = $2 AND start_time::date = $3::date`,
                [userId, `🗓️ ${email.subject}`, extractedDate]
              );
              alreadyExists = dup.rows.length > 0;
            }

            if (!alreadyExists) {
              const timing = inferCalendarTimingFromSchedule({
                subject: email.subject, summary, extractedDate, schedule,
              });
              const insertResult = await pool.query(
                `INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [`🗓️ ${email.subject}`, summary || 'Evento detectado por IA', timing.startTime, timing.endTime, timing.allDay, '#f59e0b', userId]
              );
              await pool.query(
                `UPDATE school_emails SET calendar_event_id = $1 WHERE id = $2`,
                [insertResult.rows[0].id, email.id]
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

async function syncGmail(childId, auth) {
  const gmail = google.gmail({ version: 'v1', auth });

  const queries = [
    { q: 'from:cicpm.cl newer_than:60d', includeSpamTrash: false },
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
      `INSERT INTO school_emails (child_id, gmail_id, from_address, subject, snippet, date, is_read)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (gmail_id) DO NOTHING`,
      [childId, msg.id, getHeader('From'), getHeader('Subject'), detail.data.snippet, parsedDate, !isUnread]
    );
  }
}

async function syncClassroom(childId, auth) {
  const classroom = google.classroom({ version: 'v1', auth });

  let courses = [];
  try {
    const res = await classroom.courses.list({ studentId: 'me', courseStates: ['ACTIVE'] });
    courses = res.data.courses || [];
  } catch (err) {
    console.error(`Error obteniendo cursos para child_id=${childId}:`, err.message);
    return;
  }

  const currentYear = new Date().getFullYear();
  const yearRe = /20(\d{2})/g;
  courses = courses.filter(course => {
    const years = [...course.name.matchAll(yearRe)].map(m => parseInt(m[0], 10));
    if (years.length > 0) return years.some(y => y === currentYear);
    // Sin año en el nombre: excluir si el curso no tuvo actividad este año
    const lastUpdate = course.updateTime ? new Date(course.updateTime) : null;
    return lastUpdate ? lastUpdate.getFullYear() >= currentYear : true;
  });

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

      const creationTime = work.creationTime ? new Date(work.creationTime) : null;
      const updateTime   = work.updateTime   ? new Date(work.updateTime)   : null;

      await pool.query(
        `INSERT INTO school_assignments (child_id, classroom_id, course_name, title, description, due_date, creation_time, update_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (child_id, classroom_id) DO UPDATE SET
           title         = EXCLUDED.title,
           description   = EXCLUDED.description,
           due_date      = EXCLUDED.due_date,
           course_name   = EXCLUDED.course_name,
           creation_time = EXCLUDED.creation_time,
           update_time   = EXCLUDED.update_time`,
        [childId, work.id, course.name, work.title, work.description || '', dueDate, creationTime, updateTime]
      );
    }
  }
}

async function syncClassroomAnnouncements(childId, auth) {
  const classroom = google.classroom({ version: 'v1', auth });
  const { analyzeImage } = require('../services/aiService');

  let courses = [];
  try {
    const res = await classroom.courses.list({ studentId: 'me', courseStates: ['ACTIVE'] });
    courses = res.data.courses || [];
  } catch (err) {
    console.error(`Error obteniendo cursos para anuncios (child_id=${childId}):`, err.message);
    return;
  }

  const currentYear = new Date().getFullYear();
  const yearRe = /20(\d{2})/g;
  courses = courses.filter(course => {
    const years = [...course.name.matchAll(yearRe)].map(m => parseInt(m[0], 10));
    if (years.length > 0) return years.some(y => y === currentYear);
    const lastUpdate = course.updateTime ? new Date(course.updateTime) : null;
    return lastUpdate ? lastUpdate.getFullYear() >= currentYear : true;
  });

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
        console.warn(`[school-sync] Sin permiso de anuncios para child_id=${childId} — debe reconectarse.`);
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
      const ageCheckDate = annUpdateTime || annDate;
      if (ageCheckDate && ageCheckDate < thirtyDaysAgo) continue;

      const exists = await pool.query(
        'SELECT id, updated_at FROM school_emails WHERE gmail_id = $1',
        [gmailId]
      );
      if (exists.rows.length > 0 && annUpdateTime) {
        const storedAt = exists.rows[0].updated_at ? new Date(exists.rows[0].updated_at) : null;
        if (storedAt && storedAt >= annUpdateTime) continue;
      }

      let snippet = (ann.text || '').slice(0, 500);

      const allDriveFiles = (ann.materials || [])
        .map(m => m.driveFile?.driveFile)
        .filter(f => f?.id && (
          /image\//i.test(f.mimeType || '') ||
          /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(f.title || '')
        ));

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

          if (accessToken) {
            try {
              const description = await analyzeImage(file.id, accessToken);
              if (description) snippet += `\n[Imagen adjunta: ${description}]`;
            } catch (err) {
              console.error('Error analizando imagen de anuncio:', err.message);
            }
          }
        }
      }

      for (const m of otherMaterials) attachments.push(m);

      const subject = `${course.name}: ${(ann.text || '').slice(0, 60).replace(/\n/g, ' ')}…`;

      await pool.query(
        `INSERT INTO school_emails (child_id, gmail_id, from_address, subject, snippet, body, date, is_read, updated_at, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
         ON CONFLICT (gmail_id) DO UPDATE SET
           from_address = EXCLUDED.from_address,
           subject      = EXCLUDED.subject,
           snippet      = EXCLUDED.snippet,
           body         = EXCLUDED.body,
           date         = EXCLUDED.date,
           attachments  = EXCLUDED.attachments,
           updated_at   = NOW()`,
        [childId, gmailId, 'Classroom', subject, snippet, ann.text || null, annDate, false, JSON.stringify(attachments)]
      );
    }
  }
}

async function syncChild(childId, onStep = null, childName = null) {
  const child = await getChildById(childId);
  if (!child) {
    console.error(`syncChild: child_id=${childId} no existe`);
    return;
  }
  const label = childName || child.name || child.email.split('@')[0];
  const step = (text) => { if (onStep) onStep(text); };
  try {
    step(`${label}: autenticando…`);
    const auth = await getAuthClient(childId);
    step(`${label}: descargando correos…`);
    await syncGmail(childId, auth);
    step(`${label}: descargando tareas…`);
    await syncClassroom(childId, auth);
    step(`${label}: descargando anuncios…`);
    await syncClassroomAnnouncements(childId, auth);
    step(`${label}: procesando con IA…`);
    await processUnreadEmails([childId], null).catch(err =>
      console.error('Error processing emails with AI:', err.message)
    );
    await pool.query('UPDATE google_tokens SET last_sync = NOW() WHERE child_id = $1', [childId]);
    console.log(`✓ Sync completado para ${child.email}`);
  } catch (err) {
    console.error(`Error sincronizando ${child.email}:`, err.message);
    if (isTokenRevokedError(err)) {
      await markTokenInvalid(childId);
      if (onStep) step(`${label}: token revocado — reconectar cuenta`);
    } else {
      if (onStep) step(`${label}: error — ${err.message}`);
    }
  }
}

async function syncAllChildren() {
  try {
    const result = await pool.query(
      `SELECT c.id FROM children c
         JOIN google_tokens gt ON gt.child_id = c.id
        WHERE gt.token_valid = TRUE`
    );
    for (const row of result.rows) {
      await syncChild(row.id);
    }
  } catch (err) {
    console.error('Error en syncAllChildren:', err.message);
  }
}

module.exports = router;
module.exports.syncAllChildren = syncAllChildren;
