const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { chileNaiveToUTC, chileDateParts } = require('../utils/chileTime');
const { processEmail, getTokenStats, checkTokenHealth } = require('../services/aiService');
const { SCHEDULE_TEMPLATES, SEED_CHILDREN } = require('../constants/schoolSeed');

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

// Express 4 no captura rejections de handlers async: una promesa rechazada
// deja la request colgada y tumba el proceso (Node >=15 aborta en
// unhandledRejection). Todo handler async del módulo va envuelto acá.
function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(err => {
      console.error(`Error no capturado en ${req.method} ${req.originalUrl}:`, err);
      if (!res.headersSent) res.status(500).json({ error: 'Error del servidor' });
    });
  };
}

// ─── Permisos de familia ─────────────────────────────────────────────────────
// parent → ve todos los hijos. child → solo el hijo cuyo email coincide con el suyo.

// Resuelve rol e hijos visibles de una vez: antes cada endpoint sacaba solo los
// ids y quien necesitaba el rol tenía que inferirlo del conteo de filas.
async function resolveFamilyContext(user) {
  if (!user) return { familyRole: null, childIds: [] };
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
    return { familyRole: 'child', childIds: r.rows.map(x => x.id) };
  }
  const r = await pool.query('SELECT id FROM children');
  return { familyRole: familyRole || 'parent', childIds: r.rows.map(x => x.id) };
}

async function getVisibleChildIds(user) {
  const { childIds } = await resolveFamilyContext(user);
  return childIds;
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
router.get('/status', authenticate, asyncRoute(async (req, res) => {
  try {
    const result = await pool.query(
      // is_connected distingue "hijo registrado" de "hijo con cuenta Google
      // vinculada". El LEFT JOIN devuelve fila para todo hijo de la tabla, así
      // que sin esta bandera el frontend marcaba como conectado a cualquiera.
      `SELECT c.email AS child_email, c.name AS child_name,
              (gt.child_id IS NOT NULL) AS is_connected,
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
}));

// ─── GET /api/school-sync/children ───────────────────────────────────────────
// Hijos que la UI debe mostrar: los registrados en `children` más los semilla
// que todavía no existen (para poder ofrecer la primera conexión).
router.get('/children', authenticate, asyncRoute(async (req, res) => {
  try {
    const { familyRole, childIds } = await resolveFamilyContext(req.user);
    const { rows } = await pool.query(
      'SELECT email, name FROM children WHERE id = ANY($1::int[]) ORDER BY name',
      [childIds]
    );

    const known = new Set(rows.map(r => r.email));
    // Un hijo con family_role=child solo se ve a sí mismo: no se le agregan
    // los semilla, que pertenecen a la vista de los padres.
    const seed = familyRole === 'child' ? [] : SEED_CHILDREN.filter(c => !known.has(c.email));

    const children = [...rows, ...seed].map(c => ({
      email: c.email,
      name: c.name || c.email.split('@')[0],
      has_template: Boolean(SCHEDULE_TEMPLATES[c.email]),
    }));
    res.json({ children });
  } catch (err) {
    console.error('Error listando hijos:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
}));

// ─── GET /api/school-sync/auth-url ───────────────────────────────────────────
// Si ya existe token activo para ese hijo, responde 409 a menos que ?force=1.
router.get('/auth-url', authenticate, asyncRoute(async (req, res) => {
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
}));

// ─── GET /api/school-sync/callback ───────────────────────────────────────────
router.get('/callback', asyncRoute(async (req, res) => {
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

    syncChild(childId, null, null, userId).catch(err =>
      console.error('Error en sync inicial:', err.message)
    );

    res.redirect(`${frontendUrl}/school-sync?connected=${encodeURIComponent(childEmail)}`);
  } catch (err) {
    console.error('Error en callback OAuth:', err);
    res.redirect(`${frontendUrl}/school-sync?error=token_exchange_failed`);
  }
}));

// ─── POST /api/school-sync/sync ──────────────────────────────────────────────
router.post('/sync', authenticate, asyncRoute(async (req, res) => {
  const userId = req.user.id;
  if (syncProgress.get(userId)?.running) {
    return res.status(409).json({ error: 'Ya hay una sincronización en curso' });
  }

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

    const STEPS_PER_CHILD = 5;
    touchProgress(syncProgress, userId, {
      running: true, done: false,
      completed: 0, total: children.length * STEPS_PER_CHILD,
      stepLabel: 'Iniciando…', error: null,
    });

    res.json({ success: true, synced: children.length, background: true });

    const step = (label) => {
      const prev = syncProgress.get(userId);
      if (prev) touchProgress(syncProgress, userId, { ...prev, completed: prev.completed + 1, stepLabel: label });
    };

    for (const row of children) {
      await syncChild(row.id, step, row.name, userId).catch(err =>
        console.error(`Error en sync manual (${row.email}):`, err.message)
      );
    }

    const prev = syncProgress.get(userId);
    if (prev) touchProgress(syncProgress, userId, { ...prev, running: false, done: true, stepLabel: '✅ Completado' });
  } catch (err) {
    console.error('Error en sync manual:', err);
    const prev = syncProgress.get(req.user.id);
    if (prev) touchProgress(syncProgress, req.user.id, { ...prev, running: false, done: true, error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Error del servidor' });
  }
}));

// ─── GET /api/school-sync/emails ─────────────────────────────────────────────
router.get('/emails', authenticate, asyncRoute(async (req, res) => {
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
}));

// ─── GET /api/school-sync/assignments ────────────────────────────────────────
router.get('/assignments', authenticate, asyncRoute(async (req, res) => {
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
}));

// ─── POST /api/school-sync/sync-to-calendar ─────────────────────────────────
router.post('/sync-to-calendar', authenticate, asyncRoute(async (req, res) => {
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

    const startTime = suggestedDate ? new Date(suggestedDate) : (task.due_date || new Date());
    if (Number.isNaN(startTime.getTime())) {
      return res.status(400).json({ error: 'suggestedDate inválida' });
    }

    const event = await createCalendarEventForAssignment({
      assignmentId, task, startTime, userId: req.user.id,
    });
    if (!event) {
      return res.status(400).json({ error: 'Esta tarea ya fue agregada al calendario' });
    }

    res.json({ success: true, event });
  } catch (err) {
    console.error('Error en sync-to-calendar:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
}));

// ─── GET /api/school-sync/emails/:gmailId/body ──────────────────────────────
router.get('/emails/:gmailId/body', authenticate, asyncRoute(async (req, res) => {
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
}));

// ─── GET /api/school-sync/emails/:gmailId/attachments/:attachmentId ──────────
router.get('/emails/:gmailId/attachments/:attachmentId', authenticate, asyncRoute(async (req, res) => {
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
}));

// ─── POST /api/school-sync/sync-to-calendar/bulk ─────────────────────────────
router.post('/sync-to-calendar/bulk', authenticate, asyncRoute(async (req, res) => {
  const { assignmentIds } = req.body;
  if (!Array.isArray(assignmentIds) || assignmentIds.length === 0) {
    return res.status(400).json({ error: 'assignmentIds requerido' });
  }

  const visibleIds = await getVisibleChildIds(req.user);

  // Una sola query para todas las tareas en vez de un SELECT por id.
  const { rows: tasks } = await pool.query(
    'SELECT * FROM school_assignments WHERE id = ANY($1::int[]) AND child_id = ANY($2::int[])',
    [assignmentIds, visibleIds]
  );
  const byId = new Map(tasks.map(t => [t.id, t]));

  const results = [];
  for (const id of assignmentIds) {
    const task = byId.get(Number(id));
    if (!task) {
      results.push({ id, error: 'no encontrada' });
      continue;
    }
    if (task.synced_to_calendar) {
      results.push({ id, skipped: true });
      continue;
    }
    try {
      const event = await createCalendarEventForAssignment({
        assignmentId: task.id,
        task,
        startTime: task.due_date || new Date(),
        userId: req.user.id,
      });
      results.push(event ? { id, success: true } : { id, skipped: true });
    } catch (err) {
      console.error('Error syncing assignment to calendar:', err);
      results.push({ id, error: err.message });
    }
  }
  res.json({ results });
}));

// ─── POST /api/school-sync/sync-email-to-calendar ────────────────────────────
router.post('/sync-email-to-calendar', authenticate, asyncRoute(async (req, res) => {
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
    const newEventId = eventResult.rows[0].id;

    const claim = await pool.query(
      'UPDATE school_emails SET synced_to_calendar = true, calendar_event_id = $1 WHERE id = $2 AND calendar_event_id IS NULL RETURNING id',
      [newEventId, emailId]
    );
    if (claim.rows.length === 0) {
      await pool.query('DELETE FROM calendar_events WHERE id = $1', [newEventId]);
      return res.status(400).json({ error: 'Este correo ya fue agregado al calendario' });
    }

    res.json({ success: true, eventId: newEventId });
  } catch (err) {
    console.error('Error syncing email to calendar:', err);
    res.status(500).json({ error: 'Error al agregar reunión al calendario' });
  }
}));

// ─── GET /api/school-sync/schedules ──────────────────────────────────────────
router.get('/schedules', authenticate, asyncRoute(async (req, res) => {
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
}));

// ─── POST /api/school-sync/schedules ─────────────────────────────────────────
router.post('/schedules', authenticate, asyncRoute(async (req, res) => {
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

    const invalid = schedule.findIndex(e =>
      !Number.isInteger(Number(e?.day_of_week)) || Number(e.day_of_week) < 0 || Number(e.day_of_week) > 6 ||
      !Number.isInteger(Number(e?.period_order)) || Number(e.period_order) < 1 ||
      !e?.subject
    );
    if (invalid !== -1) {
      return res.status(400).json({ error: `Entrada inválida en schedule[${invalid}]` });
    }

    const saved = await replaceSchedule(child.id, schedule);
    res.json({ success: true, saved });
  } catch (err) {
    console.error('Error guardando horarios:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
}));

// El DELETE + INSERT va en una transacción: si fallaba un insert a medio
// camino, el hijo quedaba con el horario parcialmente borrado y sin aviso.
async function replaceSchedule(childId, schedule) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM school_schedules WHERE child_id = $1', [childId]);

    if (schedule.length > 0) {
      const values = [];
      const rows = schedule.map((e, i) => {
        const b = i * 6;
        values.push(childId, e.day_of_week, e.period_order, e.subject, e.start_time || null, e.end_time || null);
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
      });
      await client.query(
        `INSERT INTO school_schedules (child_id, day_of_week, period_order, subject, start_time, end_time)
         VALUES ${rows.join(', ')}`,
        values
      );
    }

    await client.query('COMMIT');
    return schedule.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── POST /api/school-sync/schedules/template ────────────────────────────────
// Aplica el horario semilla del hijo. El template vive en el backend para no
// enviar ~100 líneas de datos escolares en el bundle del frontend.
router.post('/schedules/template', authenticate, asyncRoute(async (req, res) => {
  const { child_email } = req.body;
  if (!child_email) return res.status(400).json({ error: 'child_email requerido' });

  const template = SCHEDULE_TEMPLATES[child_email];
  if (!template) return res.status(404).json({ error: 'No hay horario predefinido para este hijo' });

  try {
    const visibleIds = await getVisibleChildIds(req.user);
    const child = await getChildByEmail(child_email);
    if (!child || !visibleIds.includes(child.id)) {
      return res.status(403).json({ error: 'No tienes permiso sobre este hijo' });
    }
    const saved = await replaceSchedule(child.id, template);
    res.json({ success: true, saved });
  } catch (err) {
    console.error('Error aplicando template de horario:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
}));

// ─── DELETE /api/school-sync/schedules/:childEmail ───────────────────────────
router.delete('/schedules/:childEmail', authenticate, asyncRoute(async (req, res) => {
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
}));

// ─── DELETE /api/school-sync/disconnect ──────────────────────────────────────
router.delete('/disconnect', authenticate, asyncRoute(async (req, res) => {
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
}));

// ─── GET /api/school-sync/token-stats ────────────────────────────────────────
router.get('/token-stats', authenticate, asyncRoute(async (req, res) => {
  const stats = getTokenStats();
  const health = checkTokenHealth();
  if (!stats) return res.json({ message: 'Sin datos aún. Procesa algunos correos primero.' });
  res.json({ ...stats, health });
}));

// ─── In-memory progress stores ───────────────────────────────────────────────
// Se limpian cuando el cliente hace polling hasta el final, pero si cierra la
// pestaña antes la entrada quedaría viva para siempre. El barrido periódico
// descarta las que ya nadie va a leer.
const reprocessProgress = new Map();
const syncProgress = new Map();
const PROGRESS_TTL_MS = 30 * 60 * 1000;

function touchProgress(store, key, value) {
  store.set(key, { ...value, updatedAt: Date.now() });
}

setInterval(() => {
  const cutoff = Date.now() - PROGRESS_TTL_MS;
  for (const store of [reprocessProgress, syncProgress]) {
    for (const [key, value] of store) {
      if ((value.updatedAt || 0) < cutoff) store.delete(key);
    }
  }
}, PROGRESS_TTL_MS).unref();

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
router.post('/process-emails', authenticate, asyncRoute(async (req, res) => {
  try {
    const visibleIds = await getVisibleChildIds(req.user);
    const result = await processUnreadEmails(visibleIds, req.user.id);
    res.json({ success: true, processed: result.count, created: result.eventsCreated });
  } catch (err) {
    console.error('Error processing emails:', err);
    res.status(500).json({ error: 'Error al procesar correos' });
  }
}));

// ─── POST /api/school-sync/reprocess ─────────────────────────────────────────
router.post('/reprocess', authenticate, (req, res) => {
  const { dateFrom, dateTo } = req.body;
  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom y dateTo requeridos' });

  const userId = req.user.id;
  if (reprocessProgress.get(userId)?.running) {
    return res.status(409).json({ error: 'Ya hay un reprocesamiento en curso' });
  }

  touchProgress(reprocessProgress, userId, { running: true, done: false, total: 0, processed: 0, eventsCreated: 0, error: null });
  res.json({ started: true });

  (async () => {
    try {
      const visibleIds = await getVisibleChildIds(req.user);
      await reprocessEmailsByRange(visibleIds, userId, dateFrom, dateTo, reprocessProgress);
    } catch (err) {
      console.error('Error reprocessing emails:', err);
      const prev = reprocessProgress.get(userId) || {};
      touchProgress(reprocessProgress, userId, { ...prev, running: false, done: true, error: err.message });
    }
  })();
});

// ─── AI Training / Feedback ──────────────────────────────────────────────────

router.get('/training/queue', authenticate, asyncRoute(async (req, res) => {
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
}));

router.patch('/emails/:gmailId/feedback', authenticate, asyncRoute(async (req, res) => {
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
}));

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
  try {
    await pool.query(
      'UPDATE google_tokens SET token_valid = FALSE WHERE child_id = $1',
      [childId]
    );
  } catch (e) {
    console.error('Error marcando token inválido:', e.message);
  }
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

  // Schedule times are Chile wall-clock hours (e.g. "13:40" = 1:40pm at
  // school), not UTC — convert them through the same Chile-aware helper
  // used for AI-extracted times so the stored instant matches reality.
  const { year, month, day } = chileDateParts(extractedDate);
  const [startHour, startMinute] = matchingSlot.start_time.substring(0, 5).split(':').map(Number);
  const startTime = chileNaiveToUTC(year, month, day, startHour, startMinute);

  let endTime;
  if (matchingSlot.end_time) {
    const [endHour, endMinute] = matchingSlot.end_time.substring(0, 5).split(':').map(Number);
    endTime = chileNaiveToUTC(year, month, day, endHour, endMinute);
  } else {
    endTime = new Date(startTime.getTime() + 45 * 60000);
  }

  return { startTime, endTime, allDay: false };
}

const PROCESS_BATCH_SIZE = 10;

// Email types that warrant an auto-created calendar event. 'aviso' and
// 'otro' are informational and shouldn't clutter the calendar.
const CALENDAR_EVENT_TYPES = ['evaluacion', 'tarea', 'reunion'];

// Inserts a calendar event and atomically claims it for `emailId` via a
// conditional UPDATE. If another concurrent run already linked this email
// to a different event (e.g. two overlapping reprocess passes), the just
// inserted row is rolled back instead of leaving an orphaned duplicate.
// Mismo patrón que createCalendarEventForEmail, para tareas de Classroom.
// Sin el claim condicional, dos clics seguidos en "Agregar" pasan ambos el
// chequeo de synced_to_calendar y dejan dos eventos idénticos.
async function createCalendarEventForAssignment({ assignmentId, task, startTime, userId }) {
  const description = [task.course_name, task.description].filter(Boolean).join('\n');
  const insertResult = await pool.query(
    `INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [`📚 ${task.title}`, description, startTime, startTime, true, '#10b981', userId]
  );
  const event = insertResult.rows[0];

  const claim = await pool.query(
    `UPDATE school_assignments SET synced_to_calendar = true, calendar_event_id = $1
      WHERE id = $2 AND synced_to_calendar IS NOT TRUE RETURNING id`,
    [event.id, assignmentId]
  );

  if (claim.rows.length === 0) {
    await pool.query('DELETE FROM calendar_events WHERE id = $1', [event.id]);
    return null;
  }
  return event;
}

async function createCalendarEventForEmail({ emailId, title, description, timing, userId }) {
  const insertResult = await pool.query(
    `INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [title, description, timing.startTime, timing.endTime, timing.allDay, '#f59e0b', userId]
  );
  const newEventId = insertResult.rows[0].id;

  const claim = await pool.query(
    `UPDATE school_emails SET calendar_event_id = $1 WHERE id = $2 AND calendar_event_id IS NULL RETURNING id`,
    [newEventId, emailId]
  );

  if (claim.rows.length === 0) {
    await pool.query('DELETE FROM calendar_events WHERE id = $1', [newEventId]);
    return null;
  }

  return newEventId;
}

async function processUnreadEmails(visibleChildIds, userId) {
  let processedCount = 0;
  let eventsCreated = 0;

  try {
    const scheduleCache = {};
    // Un correo cuyo UPDATE de ai_processed falla sigue calzando con el WHERE,
    // así que el mismo lote volvería en cada vuelta y el while nunca terminaría.
    // Se excluyen explícitamente los que ya fallaron en esta corrida.
    const failedIds = [];

    while (true) {
      const emails = await pool.query(
        `SELECT id, gmail_id, child_id, subject, snippet, body, date FROM school_emails
         WHERE child_id = ANY($1::int[])
           AND is_read = false
           AND ai_processed = false
           AND NOT (id = ANY($3::int[]))
           AND (date IS NULL OR date >= CURRENT_DATE - INTERVAL '60 days')
         ORDER BY date ASC
         LIMIT $2`,
        [visibleChildIds, PROCESS_BATCH_SIZE, failedIds]
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

          if (extractedDate && extractedDate >= new Date() && CALENDAR_EVENT_TYPES.includes(type)) {
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
                const newEventId = await createCalendarEventForEmail({
                  emailId: email.id,
                  title: `🗓️ ${email.subject}`,
                  description: summary || 'Evento detectado por IA',
                  timing,
                  userId,
                });
                if (newEventId) eventsCreated++;
              }
            } catch (err) {
              console.error('Error creating calendar event:', err.message);
            }
          }
        } catch (err) {
          console.error(`Error processing email ${email.id}:`, err.message);
          failedIds.push(email.id);
        }
      }
    }

    if (failedIds.length > 0) {
      console.warn(`⚠ ${failedIds.length} correo(s) omitido(s) tras fallar: ${failedIds.join(', ')}`);
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
    touchProgress(progressStore, userId, { ...progressStore.get(userId), ...patch });
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

        if (extractedDate && extractedDate >= new Date() && CALENDAR_EVENT_TYPES.includes(type)) {
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
              const newEventId = await createCalendarEventForEmail({
                emailId: email.id,
                title: `🗓️ ${email.subject}`,
                description: summary || 'Evento detectado por IA',
                timing,
                userId,
              });
              if (newEventId) {
                eventsCreated++;
                setProgress({ eventsCreated });
              }
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

// Dominio del colegio y correo del apoderado salen de env para no dejar datos
// personales incrustados en el código.
const SCHOOL_MAIL_DOMAIN = process.env.SCHOOL_MAIL_DOMAIN || 'cicpm.cl';
const GUARDIAN_EMAIL = process.env.SCHOOL_GUARDIAN_EMAIL || '';
const SYNC_WINDOW_DAYS = Number(process.env.SCHOOL_SYNC_WINDOW_DAYS) || 60;

function buildGmailQueries() {
  const queries = [
    { q: `from:${SCHOOL_MAIL_DOMAIN} newer_than:${SYNC_WINDOW_DAYS}d`, includeSpamTrash: false },
  ];
  // Búsqueda libre por el correo del apoderado: matchea from/to/cc/body, así
  // que ya cubre el `from:` que antes se consultaba por separado.
  if (GUARDIAN_EMAIL) {
    queries.push({ q: `${GUARDIAN_EMAIL} newer_than:${SYNC_WINDOW_DAYS}d`, includeSpamTrash: true });
  }
  return queries;
}

async function syncGmail(childId, auth) {
  const gmail = google.gmail({ version: 'v1', auth });

  const seenIds = new Set();
  const messages = [];

  for (const { q, includeSpamTrash } of buildGmailQueries()) {
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

  // Una sola query para saber cuáles ya están guardados, en vez de un SELECT
  // por mensaje (eran cientos por sync).
  const known = new Set();
  if (messages.length > 0) {
    const { rows } = await pool.query(
      'SELECT gmail_id FROM school_emails WHERE gmail_id = ANY($1::text[])',
      [messages.map(m => m.id)]
    );
    for (const r of rows) known.add(r.gmail_id);
  }

  for (const msg of messages) {
    if (known.has(msg.id)) continue;

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
    let parsedDate = rawDate ? new Date(rawDate) : null;
    if (parsedDate && Number.isNaN(parsedDate.getTime())) parsedDate = null;
    const isUnread = detail.data.labelIds?.includes('UNREAD') || false;

    await pool.query(
      `INSERT INTO school_emails (child_id, gmail_id, from_address, subject, snippet, date, is_read)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (gmail_id) DO NOTHING`,
      [childId, msg.id, getHeader('From'), getHeader('Subject'), detail.data.snippet, parsedDate, !isUnread]
    );
  }
}

// syncClassroom y syncClassroomAnnouncements pedían la misma lista de cursos y
// repetían el filtro por año palabra por palabra. Se resuelve una vez por sync
// y se reparte a los dos.
async function listActiveCoursesForYear(childId, auth) {
  const classroom = google.classroom({ version: 'v1', auth });

  let courses = [];
  try {
    const res = await classroom.courses.list({ studentId: 'me', courseStates: ['ACTIVE'] });
    courses = res.data.courses || [];
  } catch (err) {
    console.error(`Error obteniendo cursos para child_id=${childId}:`, err.message);
    return null;
  }

  const currentYear = new Date().getFullYear();
  const yearRe = /20(\d{2})/g;
  return courses.filter(course => {
    const years = [...(course.name || '').matchAll(yearRe)].map(m => parseInt(m[0], 10));
    if (years.length > 0) return years.some(y => y === currentYear);
    // Sin año en el nombre: excluir si el curso no tuvo actividad este año
    const lastUpdate = course.updateTime ? new Date(course.updateTime) : null;
    return lastUpdate ? lastUpdate.getFullYear() >= currentYear : true;
  });
}

async function syncClassroom(childId, auth, courses) {
  const classroom = google.classroom({ version: 'v1', auth });
  if (!courses) return;

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
        // Classroom entrega dueDate/dueTime en UTC. Construir la fecha desde un
        // string sin designador la interpretaba en la TZ del servidor, así que
        // se usa Date.UTC explícitamente. Y como proto3 omite los campos en
        // cero, un dueTime de 00:00 llega como {} — hay que distinguir "sin
        // hora" (23:59) de "hora cero" en vez de usar ?? sobre cada campo.
        const hour = work.dueTime ? (work.dueTime.hours ?? 0) : 23;
        const min  = work.dueTime ? (work.dueTime.minutes ?? 0) : 59;
        dueDate = new Date(Date.UTC(year, month - 1, day, hour, min, 0));
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

async function syncClassroomAnnouncements(childId, auth, courses) {
  const classroom = google.classroom({ version: 'v1', auth });
  const { analyzeImage } = require('../services/aiService');
  if (!courses) return;

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

// Lock por hijo: el sync manual, el callback de OAuth y el cron de cada 6h
// pueden coincidir sobre el mismo niño. Sin esto se duplican las llamadas a
// Gmail/Classroom y dos pasadas de IA compiten por los mismos correos.
const syncingChildren = new Set();

async function syncChild(childId, onStep = null, childName = null, userId = null) {
  const child = await getChildById(childId);
  if (!child) {
    console.error(`syncChild: child_id=${childId} no existe`);
    return;
  }
  const label = childName || child.name || child.email.split('@')[0];
  const step = (text) => { if (onStep) onStep(text); };

  if (syncingChildren.has(childId)) {
    console.warn(`syncChild: ${child.email} ya se está sincronizando, se omite`);
    step(`${label}: ya en curso, omitido`);
    return;
  }
  syncingChildren.add(childId);

  try {
    step(`${label}: autenticando…`);
    const auth = await getAuthClient(childId);
    step(`${label}: descargando correos…`);
    await syncGmail(childId, auth);
    const courses = await listActiveCoursesForYear(childId, auth);
    step(`${label}: descargando tareas…`);
    await syncClassroom(childId, auth, courses);
    step(`${label}: descargando anuncios…`);
    await syncClassroomAnnouncements(childId, auth, courses);
    step(`${label}: procesando con IA…`);
    // Sin userId explícito (ej. cron), usar quien conectó la cuenta de Google
    // del niño como dueño de los eventos auto-creados en el calendario.
    let effectiveUserId = userId;
    if (!effectiveUserId) {
      const owner = await pool.query('SELECT connected_by_user_id FROM google_tokens WHERE child_id = $1', [childId]);
      effectiveUserId = owner.rows[0]?.connected_by_user_id || null;
    }
    await processUnreadEmails([childId], effectiveUserId).catch(err =>
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
  } finally {
    syncingChildren.delete(childId);
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
