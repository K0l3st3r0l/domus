import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Button, Badge, Spinner, Alert, Modal, Form } from 'react-bootstrap';
import { toast } from 'react-toastify';
import { useNavigate, useLocation } from 'react-router-dom';
import apiClient from '../utils/apiClient';

// Los hijos salen de /school-sync/status (tabla children); antes estaban
// hardcodeados acá y un hijo nuevo en la BD nunca aparecía en la UI.
const BADGE_PALETTE = ['primary', 'success', 'info', 'warning'];

const MEETING_RE = /reuni[oó]n|citaci[oó]n|convocatoria|acto oficial|ceremonia|entrevista/i;
const MATERIALS_RE = /traer|materiales?|[uú]tiles?|llevar|implementos?|cuaderno|libros?\s|carpeta|l[aá]piz/i;

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];


const SUBJECT_COLORS = {
  'matematica':    '#e74c3c',
  'lenguaje':      '#3498db',
  'historia':      '#8e44ad',
  'ciencias':      '#27ae60',
  'ingles':        '#f39c12',
  'ed fisica':     '#16a085',
  'educacion fis': '#16a085',
  'religion':      '#e91e63',
  'artes':         '#ff5722',
  'tecnologia':    '#607d8b',
  'fisica':        '#2196f3',
  'biologia':      '#4caf50',
  'quimica':       '#9c27b0',
  'musica':        '#ff9800',
  'orientacion':   '#795548',
  'taller':        '#009688',
  'paes':          '#673ab7',
  'intermat':      '#f44336',
};

function normalizeSubject(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function subjectMatches(scheduleSubject, courseName) {
  const normSched  = normalizeSubject(scheduleSubject);
  const normCourse = normalizeSubject(courseName);
  if (normSched === normCourse) return true;
  if (normSched.includes(normCourse) || normCourse.includes(normSched)) return true;
  const schedWords  = normSched.split(' ').filter(w => w.length >= 4);
  const courseWords = normCourse.split(' ').filter(w => w.length >= 4);
  return schedWords.some(sw => courseWords.some(cw => sw === cw || sw.startsWith(cw) || cw.startsWith(sw)));
}

function findNextClass(schedules, childEmail, courseName) {
  if (!courseName) return null;
  const childSched = schedules.filter(s => s.child_email === childEmail);
  if (!childSched.length) return null;
  const matching = childSched.filter(s => subjectMatches(s.subject, courseName));
  if (!matching.length) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let d = 0; d < 14; d++) {
    const check = new Date(today);
    check.setDate(today.getDate() + d);
    const jsDay = check.getDay(); // 0=Sun
    const ourDay = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon
    const slot = matching
      .filter(s => Number(s.day_of_week) === ourDay)
      .sort((a, b) => a.period_order - b.period_order)[0];
    if (slot) {
      const result = new Date(check);
      if (slot.start_time) {
        const [h, m] = slot.start_time.split(':').map(Number);
        result.setHours(h, m, 0, 0);
      } else {
        result.setHours(8, 0, 0, 0);
      }
      return { date: result, subject: slot.subject, dayName: DAY_NAMES[ourDay] };
    }
  }
  return null;
}

function getSubjectColor(subject) {
  const norm = normalizeSubject(subject).toLowerCase();
  for (const [key, color] of Object.entries(SUBJECT_COLORS)) {
    if (norm.includes(key)) return color;
  }
  return '#78909c';
}

function cleanPlainTextEmail(text) {
  if (!text) return text;
  return text
    .split('\n')
    .filter(line => !/^\s*<https?:\/\/[^>]+>\s*$/.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderPlainTextWithLinks(text) {
  const urlRe = /(https?:\/\/[^\s<]+)/g;
  const lines = cleanPlainTextEmail(text).split('\n');

  return lines.map((line, lineIndex) => {
    const parts = line.split(urlRe);
    return (
      <React.Fragment key={`line-${lineIndex}`}>
        {parts.map((part, partIndex) => {
          if (!part) return null;

          const isUrl = urlRe.test(part);
          urlRe.lastIndex = 0;
          if (!isUrl) {
            return <React.Fragment key={`text-${lineIndex}-${partIndex}`}>{part}</React.Fragment>;
          }

          const match = part.match(/^(https?:\/\/[^\s<]+?)([),.;!?]*)$/);
          const href = match ? match[1] : part;
          const suffix = match ? match[2] : '';

          return (
            <React.Fragment key={`link-${lineIndex}-${partIndex}`}>
              <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--domus-primary)' }}>
                {href}
              </a>
              {suffix}
            </React.Fragment>
          );
        })}
        {lineIndex < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });
}

function buildEmailIframeSrcDoc(html) {
  if (!html) return '';

  const readingStyles = `
    <style>
      :root { color-scheme: light; }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff !important;
        color: #111827 !important;
      }
      body {
        padding: 16px;
        line-height: 1.6;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      table {
        max-width: 100%;
      }
      a {
        color: #2563eb;
      }
    </style>
  `;

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${readingStyles}`);
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${readingStyles}</head>`);
  }

  return `<!DOCTYPE html><html><head>${readingStyles}</head><body>${html}</body></html>`;
}

function timeAgo(dateStr) {
  if (!dateStr) return 'nunca';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
}

export default function SchoolSyncPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const [connected, setConnected] = useState([]);
  const [children, setChildren] = useState([]);
  const [emails, setEmails] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [courseFilter, setCourseFilter] = useState('all');
  const [mainView, setMainView] = useState('default'); // 'default' | 'by-subject'
  const [mobileTab, setMobileTab] = useState('tasks'); // 'tasks' | 'emails'
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncProgressState, setSyncProgressState] = useState(null); // { pct, stepLabel }
  const [connecting, setConnecting] = useState(null);

  // Email modal
  const [emailModal, setEmailModal] = useState(null); // { email, body, htmlBody, loading }

  // Assignment modal
  const [assignmentModal, setAssignmentModal] = useState(null); // { assignment }

  // Assignment multi-select
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [addingBulk, setAddingBulk] = useState(false);
  const [showOverdue, setShowOverdue] = useState(false);

  // Meetings multi-select
  const [selectedMeetingIds, setSelectedMeetingIds] = useState(new Set());
  const [addingMeetingsBulk, setAddingMeetingsBulk] = useState(false);

  // Horarios
  const [schedules, setSchedules] = useState([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleTab, setScheduleTab] = useState(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  // Tareas/reuniones en curso, para no permitir doble envío al calendario
  const [syncingToCalendar, setSyncingToCalendar] = useState(new Set());

  // Los polls de sync/reprocess se reagendan con setTimeout; sin esto seguían
  // corriendo (y llamando setState) después de salir de la página.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Date range reprocessing
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessResult, setReprocessResult] = useState(null);
  const [reprocessProgress, setReprocessProgress] = useState(null);

  const childName = useCallback(
    (email) => children.find(c => c.email === email)?.name || email,
    [children]
  );
  const childBadge = useCallback((email) => {
    const idx = children.findIndex(c => c.email === email);
    return idx === -1 ? 'secondary' : BADGE_PALETTE[idx % BADGE_PALETTE.length];
  }, [children]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiClient.get('/school-sync/status');
      setConnected(res.data.connected || []);
    } catch {
      toast.error('Error obteniendo estado de School Sync');
    }
  }, []);

  const fetchChildren = useCallback(async () => {
    try {
      const res = await apiClient.get('/school-sync/children');
      const list = res.data.children || [];
      setChildren(list);
      setScheduleTab(prev => prev || list[0]?.email || null);
    } catch {
      toast.error('Error obteniendo la lista de hijos');
    }
  }, []);

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await apiClient.get('/school-sync/schedules');
      setSchedules(res.data);
    } catch { /* non-critical */ }
  }, []);

  const fetchData = useCallback(async (child = null) => {
    try {
      const params = child && child !== 'all' ? { child } : {};
      const [emailsRes, assignmentsRes] = await Promise.all([
        apiClient.get('/school-sync/emails', { params }),
        apiClient.get('/school-sync/assignments', { params }),
      ]);
      setEmails(emailsRes.data);
      setAssignments(assignmentsRes.data);
    } catch {
      toast.error('Error cargando datos escolares');
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const connectedEmail = params.get('connected');
    const errorParam = params.get('error');
    if (connectedEmail) {
      toast.success(`✅ ${childName(connectedEmail)} conectado correctamente`);
      navigate('/school-sync', { replace: true });
      // Refresh connected state after OAuth callback
      fetchStatus();
    } else if (errorParam) {
      const messages = {
        access_denied: 'Acceso denegado por el usuario',
        invalid_state: 'Sesión expirada, intenta nuevamente',
        token_exchange_failed: 'Error al obtener los permisos de Google',
        missing_params: 'Respuesta incompleta de Google',
      };
      toast.error(messages[errorParam] || `Error: ${errorParam}`);
      navigate('/school-sync', { replace: true });
    }
  }, [location.search, navigate, fetchStatus, childName]);

  // Auto-open email modal when arriving from calendar with ?openEmail=subject
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const openEmailSubject = params.get('openEmail');
    if (!openEmailSubject || emails.length === 0) return;

    const normalize = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const target = normalize(openEmailSubject);
    const match = emails.find(e => normalize(e.subject).includes(target) || target.includes(normalize(e.subject)));
    if (match) {
      navigate('/school-sync', { replace: true });
      handleOpenEmail(match);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emails, location.search]);

  // Auto-open assignment modal when arriving from calendar with ?openAssignment=id
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const openAssignmentId = params.get('openAssignment');
    if (!openAssignmentId || assignments.length === 0) return;

    const id = parseInt(openAssignmentId, 10);
    const match = assignments.find(a => a.id === id);
    if (match) {
      navigate('/school-sync', { replace: true });
      setAssignmentModal(match);
    }
  }, [assignments, location.search, navigate]);

  useEffect(() => {
    let poll = null;

    async function init() {
      await Promise.all([
        fetchStatus(),
        fetchChildren(),
        fetchSchedules(),
        fetchData(activeFilter === 'all' ? null : activeFilter),
      ]);
      setLoading(false);

      // Retomar polling si hay un reprocesamiento en curso (ej: el usuario navegó fuera y volvió)
      try {
        const { data } = await apiClient.get('/school-sync/reprocess/progress');
        if (!data.running || !mounted.current) return;
        setReprocessing(true);
        poll = setInterval(async () => {
          try {
            const { data: p } = await apiClient.get('/school-sync/reprocess/progress');
            setReprocessProgress(p);
            if (p.done || !p.running) {
              clearInterval(poll);
              setReprocessing(false);
              if (p.done) {
                setReprocessResult({ processed: p.processed, eventsCreated: p.eventsCreated });
                fetchData(activeFilter === 'all' ? null : activeFilter);
              }
            }
          } catch { clearInterval(poll); setReprocessing(false); }
        }, 1500);
      } catch { /* non-critical */ }
    }
    init();

    return () => { if (poll) clearInterval(poll); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // solo al montar

  // El mount ya carga los datos en init(); sin este guard este efecto corría
  // también al montar y duplicaba /emails y /assignments en cada visita.
  const skipFilterFetch = useRef(true);
  useEffect(() => {
    if (skipFilterFetch.current) {
      skipFilterFetch.current = false;
      return;
    }
    setSelectedIds(new Set());
    setSelectedMeetingIds(new Set());
    fetchData(activeFilter === 'all' ? null : activeFilter);
  }, [activeFilter, fetchData]);

  // Los filtros de tipo/materia esconden ítems; sin limpiar la selección el
  // contador de "Agregar (N)" seguía contando tarjetas que ya no se ven.
  useEffect(() => { setSelectedIds(new Set()); }, [courseFilter]);
  useEffect(() => { setSelectedMeetingIds(new Set()); }, [typeFilter]);

  const handleConnect = async (child, force = false) => {
    setConnecting(child.email);
    try {
      const params = { child_email: child.email, child_name: child.name };
      if (force) params.force = 1;
      const res = await apiClient.get('/school-sync/auth-url', { params });
      window.location.href = res.data.url;
    } catch (err) {
      setConnecting(null);
      if (err.response?.status === 409) {
        const data = err.response.data || {};
        const who = data.connected_by_name || data.connected_by_email || 'otro miembro';
        const when = data.connected_at ? new Date(data.connected_at).toLocaleDateString('es-CL') : '';
        const msg = `Ya hay una conexión activa para ${child.name}, hecha por ${who}${when ? ' el ' + when : ''}.\n\nNo es necesario reconectar. ¿Quieres hacerlo de todas formas?`;
        if (window.confirm(msg)) {
          await handleConnect(child, true);
        }
        return;
      }
      toast.error('Error generando URL de autorización');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncProgressState({ pct: 0, stepLabel: 'Iniciando…' });
    try {
      await apiClient.post('/school-sync/sync');

      // Poll /sync/progress until done (max 3 min)
      const deadline = Date.now() + 3 * 60 * 1000;
      const poll = async () => {
        if (!mounted.current) return;
        try {
          const { data } = await apiClient.get('/school-sync/sync/progress');
          setSyncProgressState({ pct: data.pct ?? 0, stepLabel: data.stepLabel || '' });
          if (data.done || !data.running || Date.now() > deadline) {
            await fetchStatus();
            await fetchData(activeFilter === 'all' ? null : activeFilter);
            if (!mounted.current) return;
            if (data.error) {
              toast.error(`Error: ${data.error}`);
            } else {
              toast.success('✅ Sincronización completada');
            }
            setSyncing(false);
            setSyncProgressState(null);
          } else {
            setTimeout(poll, 2000);
          }
        } catch {
          if (!mounted.current) return;
          setSyncing(false);
          setSyncProgressState(null);
          toast.error('Error consultando estado de sincronización');
        }
      };
      setTimeout(poll, 2000);
    } catch (err) {
      setSyncing(false);
      setSyncProgressState(null);
      // 409 = otra sincronización ya en curso (otra pestaña, o doble clic)
      toast.error(err.response?.status === 409
        ? 'Ya hay una sincronización en curso'
        : 'Error durante la sincronización');
    }
  };

  const handleReprocess = async () => {
    if (!dateFrom || !dateTo) {
      toast.error('Selecciona ambas fechas');
      return;
    }
    setReprocessing(true);
    setReprocessResult(null);
    setReprocessProgress(null);

    try {
      await apiClient.post('/school-sync/reprocess', { dateFrom, dateTo });

      // Poll progress every 1.5s until done
      const poll = async () => {
        if (!mounted.current) return;
        try {
          const { data } = await apiClient.get('/school-sync/reprocess/progress');
          setReprocessProgress(data);

          if (data.done || !data.running) {
            setReprocessing(false);
            if (data.error) {
              toast.error(`Error: ${data.error}`);
            } else {
              setReprocessResult({ processed: data.processed, eventsCreated: data.eventsCreated });
              toast.success(`✓ ${data.processed} correos procesados, ${data.eventsCreated} eventos creados`);
              await fetchData(activeFilter === 'all' ? null : activeFilter);
            }
          } else {
            setTimeout(poll, 1500);
          }
        } catch {
          if (!mounted.current) return;
          setReprocessing(false);
          toast.error('Error consultando progreso');
        }
      };

      setTimeout(poll, 1000);
    } catch (err) {
      setReprocessing(false);
      toast.error(err.response?.status === 409
        ? 'Ya hay un reprocesamiento en curso'
        : 'Error al iniciar reprocesamiento');
    }
  };

  const handleDisconnect = async (childEmail) => {
    if (!window.confirm(`¿Desconectar la cuenta de ${childName(childEmail)}?`)) return;
    try {
      await apiClient.delete('/school-sync/disconnect', { data: { child_email: childEmail } });
      toast.success('Cuenta desconectada');
      await fetchStatus();
    } catch {
      toast.error('Error desconectando cuenta');
    }
  };

  const handleDownloadAttachment = async (gmailId, att) => {
    try {
      const res = await apiClient.get(
        `/school-sync/emails/${encodeURIComponent(gmailId)}/attachments/${encodeURIComponent(att.attachmentId)}`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo descargar el adjunto');
    }
  };

  const handleOpenEmail = async (email) => {
    setEmailModal({ email, body: null, htmlBody: null, loading: true });
    try {
      const res = await apiClient.get(`/school-sync/emails/${email.gmail_id}/body`);
      const gmailAtts = Array.isArray(res.data.attachments) ? res.data.attachments : [];
      const existingAtts = Array.isArray(email.attachments) ? email.attachments : [];
      const mergedEmail = gmailAtts.length
        ? { ...email, attachments: [...existingAtts.filter(a => !a.attachmentId), ...gmailAtts] }
        : email;
      setEmailModal({ email: mergedEmail, body: res.data.body, htmlBody: res.data.htmlBody, loading: false });
    } catch {
      setEmailModal({ email, body: null, htmlBody: null, loading: false });
    }
  };

  const handleSyncToCalendar = async (assignment, suggestedDate = null) => {
    if (syncingToCalendar.has(assignment.id)) return;
    setSyncingToCalendar(prev => new Set(prev).add(assignment.id));
    try {
      const body = { assignmentId: assignment.id };
      if (suggestedDate) body.suggestedDate = suggestedDate.toISOString();
      await apiClient.post('/school-sync/sync-to-calendar', body);
      const dateLabel = suggestedDate
        ? suggestedDate.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })
        : (formatDueDate(assignment.due_date) || 'hoy');
      toast.success(`"${assignment.title}" → calendario (${dateLabel})`);
      setAssignments(prev =>
        prev.map(a => (a.id === assignment.id ? { ...a, synced_to_calendar: true } : a))
      );
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al agregar al calendario';
      toast.error(msg);
    } finally {
      setSyncingToCalendar(prev => {
        const next = new Set(prev);
        next.delete(assignment.id);
        return next;
      });
    }
  };

  const handleLoadScheduleTemplate = async (childEmail) => {
    setScheduleSaving(true);
    try {
      await apiClient.post('/school-sync/schedules/template', { child_email: childEmail });
      toast.success('Horario cargado correctamente');
      await fetchSchedules();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al guardar horario');
    } finally {
      setScheduleSaving(false);
    }
  };

  const handleClearSchedule = async (childEmail) => {
    if (!window.confirm('¿Borrar el horario de este hijo?')) return;
    try {
      await apiClient.delete(`/school-sync/schedules/${encodeURIComponent(childEmail)}`);
      toast.success('Horario eliminado');
      await fetchSchedules();
    } catch {
      toast.error('Error al eliminar horario');
    }
  };

  const handleBulkSync = async (ids) => {
    if (!ids.length) return;
    setAddingBulk(true);
    try {
      const res = await apiClient.post('/school-sync/sync-to-calendar/bulk', { assignmentIds: ids });
      const results = res.data.results || [];
      const succeeded = results.filter(r => r.success).length;
      const skipped = results.filter(r => r.skipped).length;
      const failed = results.filter(r => r.error);
      if (succeeded > 0) toast.success(`${succeeded} tarea(s) agregadas al calendario`);
      if (skipped > 0) toast.info(`${skipped} ya estaban en el calendario`);
      if (failed.length > 0) toast.error(`${failed.length} tarea(s) no se pudieron agregar`);

      // Solo marcar las que el backend confirmó; antes se marcaban todas las
      // enviadas, incluidas las que fallaron.
      const done = new Set(results.filter(r => r.success || r.skipped).map(r => r.id));
      setAssignments(prev =>
        prev.map(a => done.has(a.id) ? { ...a, synced_to_calendar: true } : a)
      );
      setSelectedIds(new Set());
    } catch {
      toast.error('Error al agregar tareas al calendario');
    } finally {
      setAddingBulk(false);
    }
  };

  const toggleSelectId = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectMeetingId = (id) => {
    setSelectedMeetingIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkSyncMeetings = async (ids) => {
    if (!ids.length) return;
    setAddingMeetingsBulk(true);
    try {
      // Un fallo a mitad de camino no debe descartar las que sí se agregaron:
      // se recorren todas y se marca lo confirmado.
      const settled = await Promise.allSettled(
        ids.map(id => apiClient.post('/school-sync/sync-email-to-calendar', { emailId: id }))
      );
      const syncedIds = ids.filter((_, i) => settled[i].status === 'fulfilled');
      const failed = settled.length - syncedIds.length;

      if (syncedIds.length > 0) {
        toast.success(`${syncedIds.length} reunión(es) agregada(s) al calendario`);
        const done = new Set(syncedIds);
        setEmails(prev => prev.map(e => done.has(e.id) ? { ...e, synced_to_calendar: true } : e));
      }
      if (failed > 0) toast.error(`${failed} reunión(es) no se pudieron agregar`);
      setSelectedMeetingIds(new Set());
    } catch {
      toast.error('Error al agregar reuniones al calendario');
    } finally {
      setAddingMeetingsBulk(false);
    }
  };

  // Client-side detection from loaded data (only last 30 days, excluding already synced)
  const detectedMeetings = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return emails.filter(e =>
      MEETING_RE.test(`${e.subject || ''} ${e.snippet || ''}`) &&
      e.date && new Date(e.date).getTime() > cutoff &&
      !e.synced_to_calendar
    );
  }, [emails]);

  // Unique courses from assignments + Classroom announcement subjects
  const uniqueCourses = useMemo(() => {
    const fromAssignments = assignments.map(a => a.course_name).filter(Boolean);
    // Classroom announcements have subjects like "CourseName: text…"
    const fromEmails = emails
      .filter(e => e.gmail_id && e.gmail_id.startsWith('classroom:ann:'))
      .map(e => (e.subject || '').split(':')[0].trim())
      .filter(Boolean);
    const names = [...new Set([...fromAssignments, ...fromEmails])];
    return names.sort((a, b) => a.localeCompare(b, 'es'));
  }, [assignments, emails]);

  // Normalize text for course matching (remove numbers, symbols, lowercase)
  const normalizeCourse = (s) => (s || '').toLowerCase().replace(/[^a-záéíóúüñ\s]/gi, '').replace(/\s+/g, ' ').trim();

  const filteredEmails = useMemo(() => {
    return emails.filter(e => {
      if (typeFilter === 'reunion') return e.ai_type === 'reunion' || MEETING_RE.test(`${e.subject || ''} ${e.snippet || ''}`);
      if (typeFilter === 'tarea') return e.ai_type === 'tarea';
      if (typeFilter === 'evaluacion') return e.ai_type === 'evaluacion';
      if (typeFilter === 'aviso') return e.ai_type === 'aviso';
      return true;
    });
  }, [emails, typeFilter]);

  const filteredAssignments = useMemo(() => {
    if (courseFilter === 'all') return assignments;
    return assignments.filter(a => a.course_name === courseFilter);
  }, [assignments, courseFilter]);

  // For by-subject view: group assignments + related emails by course
  const subjectGroups = useMemo(() => {
    // El texto de cada correo se normaliza una sola vez: antes se re-normalizaba
    // dentro del filter, o sea cursos × correos veces por render.
    const normalizedEmails = emails.map(e => ({
      email: e,
      text: normalizeCourse(`${e.subject || ''} ${e.snippet || ''} ${e.ai_summary || ''}`),
    }));

    const assignmentsByCourse = new Map();
    for (const a of assignments) {
      if (!assignmentsByCourse.has(a.course_name)) assignmentsByCourse.set(a.course_name, []);
      assignmentsByCourse.get(a.course_name).push(a);
    }

    return uniqueCourses.map(course => {
      // Emails from Classroom notifications embed the full course name in the snippet.
      // Match on the full normalized course name to avoid "Matemática" bleeding into
      // "Taller de Matemática" (which share the word "matem").
      const normalizedCourse = normalizeCourse(course);
      const relatedEmails = normalizedEmails
        .filter(n => n.text.includes(normalizedCourse))
        .map(n => n.email);
      return { course, assignments: assignmentsByCourse.get(course) || [], emails: relatedEmails };
    }).filter(g => g.assignments.length > 0 || g.emails.length > 0);
  }, [uniqueCourses, assignments, emails]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  // `connected` trae una fila por hijo registrado, con o sin cuenta Google
  // vinculada: hay que filtrar por is_connected, no por largo del arreglo.
  const linkedAccounts = connected.filter(c => c.is_connected);

  if (linkedAccounts.length === 0) {
    return (
      <div style={{ maxWidth: 560, margin: '3rem auto', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎓</div>
        <h2 style={{ marginBottom: '0.5rem' }}>School Sync</h2>
        <p style={{ color: 'var(--domus-muted)', marginBottom: '2rem' }}>
          Conecta las cuentas escolares de tus hijos para ver sus correos del colegio y tareas de
          Google Classroom directamente en DOMUS.
        </p>
        <Alert variant="info" style={{ textAlign: 'left', marginBottom: '2rem' }}>
          <strong>Permisos solicitados:</strong>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
            <li>Leer correos de Gmail (solo lectura)</li>
            <li>Ver cursos y tareas de Google Classroom</li>
          </ul>
        </Alert>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          {children.map(child => (
            <Button
              key={child.email}
              variant="primary"
              size="lg"
              disabled={!!connecting}
              onClick={() => handleConnect(child)}
              style={{ minWidth: 180 }}
            >
              {connecting === child.email ? (
                <><Spinner size="sm" animation="border" className="me-2" />Conectando...</>
              ) : (
                `Conectar ${child.name}`
              )}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  const connectedEmails = linkedAccounts.map(c => c.child_email);
  const lastSync = linkedAccounts.reduce((latest, c) => {
    if (!c.last_sync) return latest;
    return !latest || new Date(c.last_sync) > new Date(latest) ? c.last_sync : latest;
  }, null);
  
  // Separate overdue and pending — applied to the course-filtered set
  const pendingAssignments = filteredAssignments.filter(a => {
    const overdue = a.due_date && new Date(a.due_date) < new Date();
    return !overdue;
  });
  const overdueAssignments = filteredAssignments.filter(a => {
    const overdue = a.due_date && new Date(a.due_date) < new Date();
    return overdue;
  });

  const unsyncedAssignments = pendingAssignments.filter(a => !a.synced_to_calendar);
  const selectedArray = [...selectedIds];

  return (
    <div className="school-sync-page">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>🎓 School Sync</h2>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
            {children.map(child => {
              const isLinked = connectedEmails.includes(child.email);
              const info = connected.find(c => c.child_email === child.email);
              const isConnecting = connecting === child.email;
              const tokenInvalid = isLinked && info?.token_valid === false;
              return (
                <span key={child.email} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
                  {isLinked ? (
                    <>
                      <Button
                        size="sm"
                        variant={tokenInvalid ? 'danger' : 'success'}
                        disabled={!!connecting}
                        onClick={() => handleConnect(child)}
                        title={tokenInvalid
                          ? 'Token revocado — reconectar cuenta'
                          : `Conectado por ${info?.connected_by_name || info?.connected_by_email || '?'}${info?.connected_at ? ' el ' + new Date(info.connected_at).toLocaleDateString('es-CL') : ''}`}
                        style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem' }}
                      >
                        {isConnecting
                          ? <><Spinner size="sm" animation="border" className="me-1" />Conectando...</>
                          : tokenInvalid ? `⚠ Reconectar ${child.name}` : `✓ ${child.name}`}
                      </Button>
                      <span
                        style={{ cursor: 'pointer', color: '#ef4444', fontSize: '0.75rem', lineHeight: 1 }}
                        onClick={() => handleDisconnect(child.email)}
                        title="Desconectar cuenta"
                      >✕</span>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}
                      disabled={!!connecting}
                      onClick={() => handleConnect(child)}
                    >
                      {isConnecting ? <><Spinner size="sm" animation="border" className="me-1" />Conectando...</> : `+ Conectar ${child.name}`}
                    </Button>
                  )}
                  {isLinked && info?.last_sync && (
                    <span style={{ color: 'var(--domus-muted)', fontSize: '0.72rem' }}>· {timeAgo(info.last_sync)}</span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {lastSync && (
            <span style={{ color: 'var(--domus-muted)', fontSize: '0.8rem' }}>
              Último sync: {timeAgo(lastSync)}
            </span>
          )}
          <Button variant="outline-secondary" onClick={() => setShowScheduleModal(true)}>
            📅 Horarios
          </Button>
          <Button variant="primary" onClick={handleSync} disabled={syncing}>
            {syncing ? <><Spinner size="sm" animation="border" className="me-1" />Sincronizando...</> : '↻ Sincronizar ahora'}
          </Button>
        </div>
      </div>

      {/* Sync progress bar */}
      {syncing && syncProgressState && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem', fontSize: '0.8rem', color: 'var(--domus-muted)' }}>
            <span>{syncProgressState.stepLabel}</span>
            <span style={{ fontWeight: 600 }}>{syncProgressState.pct}%</span>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${syncProgressState.pct}%`,
              background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
              borderRadius: 6,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      )}

      {/* Date range reprocessing section */}
      <div style={{
        background: 'var(--domus-card-bg)',
        border: '1px solid rgba(168,85,247,0.3)',
        borderRadius: 8,
        padding: '0.75rem 1rem',
        marginBottom: '1.25rem',
        display: 'flex',
        alignItems: 'flex-end',
        gap: '0.75rem',
        flexWrap: 'wrap',
      }}>
        <Form.Group style={{ marginBottom: 0, minWidth: '150px' }}>
          <Form.Label style={{ marginBottom: '0.25rem', fontSize: '0.8rem', color: 'var(--domus-muted)' }}>Desde:</Form.Label>
          <Form.Control
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            disabled={reprocessing}
            size="sm"
          />
        </Form.Group>
        <Form.Group style={{ marginBottom: 0, minWidth: '150px' }}>
          <Form.Label style={{ marginBottom: '0.25rem', fontSize: '0.8rem', color: 'var(--domus-muted)' }}>Hasta:</Form.Label>
          <Form.Control
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            disabled={reprocessing}
            size="sm"
          />
        </Form.Group>
        <Button
          variant="outline-warning"
          size="sm"
          onClick={handleReprocess}
          disabled={reprocessing || !dateFrom || !dateTo}
          style={{ whiteSpace: 'nowrap' }}
        >
          {reprocessing ? (
            <><Spinner size="sm" animation="border" className="me-1" />Procesando...</>
          ) : (
            '🤖 Reprocesar con IA'
          )}
        </Button>

        {/* Progress bar shown while processing */}
        {reprocessing && reprocessProgress?.total > 0 && (
          <div style={{ flex: '1 1 200px', minWidth: 180 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--domus-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span>{reprocessProgress.processed} / {reprocessProgress.total} correos</span>
              <span>{Math.round((reprocessProgress.processed / reprocessProgress.total) * 100)}%</span>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div style={{
                background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                height: '100%',
                width: `${Math.round((reprocessProgress.processed / reprocessProgress.total) * 100)}%`,
                borderRadius: 4,
                transition: 'width 0.5s ease',
              }} />
            </div>
            {reprocessProgress.eventsCreated > 0 && (
              <div style={{ fontSize: '0.7rem', color: '#f59e0b', marginTop: 3 }}>
                🗓️ {reprocessProgress.eventsCreated} evento(s) creado(s)
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reprocess result alert */}
      {reprocessResult && (
        <Alert variant="success" dismissible onClose={() => setReprocessResult(null)} style={{ marginBottom: '1.25rem' }}>
          <strong>✅ Reprocesamiento completado</strong>
          <br />
          <span style={{ fontSize: '0.9rem' }}>
            {reprocessResult.processed} correo(s) procesado(s) • {reprocessResult.eventsCreated} evento(s) creado(s)
          </span>
        </Alert>
      )}

      {/* Filters */}
      <div style={{ marginBottom: '1.25rem' }}>
        {/* Toggle bar */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginBottom: filtersOpen ? '0.5rem' : 0 }}>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={() => setFiltersOpen(o => !o)}
              style={{ background: 'none', border: 'none', color: 'var(--domus-muted)', cursor: 'pointer', fontSize: '0.78rem', padding: '0.1rem 0.3rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
            >
              <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: filtersOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
              Filtros
              {(activeFilter !== 'all' || typeFilter !== 'all' || courseFilter !== 'all') && (
                <span style={{ background: 'var(--domus-primary)', color: '#fff', borderRadius: '50%', width: 14, height: 14, fontSize: '0.65rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {[activeFilter !== 'all', typeFilter !== 'all', courseFilter !== 'all'].filter(Boolean).length}
                </span>
              )}
            </button>
            {!filtersOpen && activeFilter !== 'all' && (
              <span style={{ fontSize: '0.75rem', color: 'var(--domus-muted)' }}>
                {childName(activeFilter)}
              </span>
            )}
            {!filtersOpen && courseFilter !== 'all' && (
              <span style={{ fontSize: '0.75rem', color: 'var(--domus-muted)' }}>
                · {courseFilter.replace(/\s*\d{4}\s*$/, '').replace(/^(II?I?|IV|V?I?)\s*[°º]?\s*[A-Z]\s*/i, '')}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <Button size="sm"
              variant={mainView === 'default' ? 'secondary' : 'outline-secondary'}
              onClick={() => setMainView('default')}
            >≡ Lista</Button>
            <Button size="sm"
              variant={mainView === 'by-subject' ? 'secondary' : 'outline-secondary'}
              onClick={() => setMainView('by-subject')}
            >📖 Por Materia</Button>
          </div>
        </div>

        {filtersOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {/* Row 1: hijo */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--domus-muted)', alignSelf: 'center' }}>Hijo:</span>
              {[{ key: 'all', label: 'Todos' }, ...children.map(c => ({ key: c.email, label: c.name }))].map(f => (
                <Button key={f.key} size="sm"
                  variant={activeFilter === f.key ? 'primary' : 'outline-secondary'}
                  onClick={() => setActiveFilter(f.key)}
                >{f.label}</Button>
              ))}
            </div>

            {mainView === 'default' && (
              <>
                {/* Row 2: tipo de mensaje */}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--domus-muted)', alignSelf: 'center' }}>Mensajes:</span>
                  {[
                    { key: 'all', label: 'Todos' },
                    { key: 'reunion', label: '🗓️ Reuniones' },
                    { key: 'evaluacion', label: '📋 Evaluaciones' },
                    { key: 'tarea', label: '📝 Tareas' },
                    { key: 'aviso', label: '📢 Avisos' },
                  ].map(f => (
                    <Button key={f.key} size="sm"
                      variant={typeFilter === f.key ? 'info' : 'outline-secondary'}
                      onClick={() => setTypeFilter(f.key)}
                      style={{ fontSize: '0.78rem' }}
                    >{f.label}</Button>
                  ))}
                </div>
                {/* Row 3: materia */}
                {uniqueCourses.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--domus-muted)', alignSelf: 'center' }}>Materia:</span>
                    <Button size="sm"
                      variant={courseFilter === 'all' ? 'success' : 'outline-secondary'}
                      onClick={() => setCourseFilter('all')}
                      style={{ fontSize: '0.78rem' }}
                    >Todas</Button>
                    {uniqueCourses.map(c => (
                      <Button key={c} size="sm"
                        variant={courseFilter === c ? 'success' : 'outline-secondary'}
                        onClick={() => setCourseFilter(courseFilter === c ? 'all' : c)}
                        style={{ fontSize: '0.78rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={c}
                      >{c.replace(/\s*\d{4}\s*$/, '').replace(/^(II?I?|IV|V?I?)\s*[°º]?\s*[A-Z]\s*/i, '')}</Button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Detected meetings banner */}
      {detectedMeetings.length > 0 && (
        <div style={{
          background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.4)',
          borderRadius: 8,
          padding: '0.65rem 1rem',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
          fontSize: '0.88rem',
        }}>
          <span>🗓️ <strong>{detectedMeetings.length} reunión(es) detectada(s)</strong></span>
          {detectedMeetings.length > 0 && (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant="outline-warning"
                disabled={addingMeetingsBulk}
                title="Agregar todas al calendario"
                onClick={() => handleBulkSyncMeetings(detectedMeetings.map(m => m.id))}
              >
                {addingMeetingsBulk ? <Spinner size="sm" animation="border" /> : '📅 Agregar todas'}
              </Button>
              {[...selectedMeetingIds].length > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="warning"
                    disabled={addingMeetingsBulk}
                    onClick={() => handleBulkSyncMeetings([...selectedMeetingIds])}
                  >
                    {addingMeetingsBulk ? <Spinner size="sm" animation="border" /> : `📅 Agregar (${[...selectedMeetingIds].length})`}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    onClick={() => setSelectedMeetingIds(new Set())}
                  >
                    ✕
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── By-subject view ── */}
      {mainView === 'by-subject' && (
        <div>
          {subjectGroups.length === 0 ? (
            <p style={{ color: 'var(--domus-muted)' }}>Sin datos por materia aún.</p>
          ) : subjectGroups.map(({ course, assignments: cAssignments, emails: cEmails }) => (
            <div key={course} style={{
              background: 'var(--domus-card-bg)',
              border: '1px solid var(--domus-border)',
              borderRadius: 10,
              marginBottom: '1.25rem',
              overflow: 'hidden',
            }}>
              {/* Course header */}
              <div style={{
                background: 'rgba(99,102,241,0.15)',
                borderBottom: '1px solid var(--domus-border)',
                padding: '0.6rem 1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <strong style={{ fontSize: '0.95rem' }}>
                  📖 {course.replace(/\s*\d{4}\s*$/, '')}
                </strong>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {cAssignments.length > 0 && <Badge bg="success">{cAssignments.length} tarea(s)</Badge>}
                  {cEmails.length > 0 && <Badge bg="secondary">{cEmails.length} mensaje(s)</Badge>}
                </div>
              </div>
              <div className={`school-sync-subject-grid${cEmails.length > 0 ? ' two-col' : ''}`}>
                {/* Assignments */}
                {cAssignments.length > 0 && (
                  <div className="school-sync-subject-assigns" style={{ padding: '0.75rem' }}>
                    {cAssignments.map(task => (
                      <div key={task.id} style={{
                        padding: '0.5rem 0.75rem',
                        marginBottom: '0.5rem',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: 6,
                        border: '1px solid var(--domus-border)',
                        cursor: 'pointer',
                      }} onClick={() => setAssignmentModal(task)}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.15rem' }}>{task.title}</div>
                        {task.due_date && (
                          <div style={{ fontSize: '0.75rem', color: new Date(task.due_date) < new Date() ? '#ef4444' : '#10b981' }}>
                            📅 {new Date(task.due_date).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })}
                            {new Date(task.due_date) < new Date() ? ' · vencida' : ''}
                          </div>
                        )}
                        {task.synced_to_calendar && <Badge bg="success" style={{ fontSize: '0.6rem', marginTop: 3 }}>✓ En calendario</Badge>}
                      </div>
                    ))}
                  </div>
                )}
                {/* Related emails */}
                {cEmails.length > 0 && (
                  <div style={{ padding: '0.75rem' }}>
                    {cEmails.slice(0, 4).map(email => (
                      <div key={email.id} style={{
                        padding: '0.5rem 0.75rem',
                        marginBottom: '0.5rem',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: 6,
                        border: '1px solid var(--domus-border)',
                        cursor: 'pointer',
                        fontSize: '0.82rem',
                      }} onClick={() => handleOpenEmail(email)}>
                        <div style={{ fontWeight: 600, marginBottom: '0.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {email.subject}
                        </div>
                        <div style={{ color: 'var(--domus-muted)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {email.ai_summary || email.snippet}
                        </div>
                        {email.extracted_date && (
                          <div style={{ fontSize: '0.72rem', color: '#f59e0b', marginTop: 2 }}>
                            📅 {new Date(email.extracted_date).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })}
                          </div>
                        )}
                      </div>
                    ))}
                    {cEmails.length > 4 && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--domus-muted)', textAlign: 'center' }}>
                        +{cEmails.length - 4} mensaje(s) más
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Mobile section tabs — ocultos en desktop via CSS */}
      {mainView === 'default' && (
        <div className="school-sync-mobile-tabs">
          <button
            className={`school-sync-mobile-tab${mobileTab === 'tasks' ? ' active' : ''}`}
            onClick={() => setMobileTab('tasks')}
          >
            📚 Tareas
            {pendingAssignments.length > 0 && (
              <span className="school-sync-tab-badge">{pendingAssignments.length}</span>
            )}
          </button>
          <button
            className={`school-sync-mobile-tab${mobileTab === 'emails' ? ' active' : ''}`}
            onClick={() => setMobileTab('emails')}
          >
            📧 Mensajes
            {filteredEmails.length > 0 && (
              <span className="school-sync-tab-badge">{filteredEmails.length}</span>
            )}
          </button>
        </div>
      )}

      {/* Two-column content */}
      {mainView === 'default' && <div className="school-sync-main-grid" data-mobile-tab={mobileTab}>

        {/* ── Emails column ── */}
        <div className="school-sync-emails-col">
          <h5 style={{ marginBottom: '0.5rem' }}>📧 Mensajes
            {typeFilter !== 'all' && <Badge bg="info" style={{ marginLeft: 6, fontSize: '0.7rem' }}>{filteredEmails.length}</Badge>}
          </h5>
          {filteredEmails.length === 0 ? (
            <p style={{ color: 'var(--domus-muted)' }}>No hay mensajes con ese filtro.</p>
          ) : (
            filteredEmails.map(email => {
              const text = `${email.subject || ''} ${email.snippet || ''}`;
              const isRecent = email.date && (Date.now() - new Date(email.date).getTime()) < 30 * 24 * 60 * 60 * 1000;
              const isMeeting = isRecent && MEETING_RE.test(text);
              const hasMaterials = MATERIALS_RE.test(text);
              return (
                <div
                  key={email.id}
                  className="school-sync-card"
                  onClick={() => handleOpenEmail(email)}
                  style={{
                    padding: '0.75rem 1rem',
                    marginBottom: '0.75rem',
                    borderRadius: 8,
                    border: `1px solid ${isMeeting && selectedMeetingIds.has(email.id) ? 'rgba(245,158,11,1)' : isMeeting ? 'rgba(245,158,11,0.5)' : 'var(--domus-border)'}`,
                    backgroundColor: selectedMeetingIds.has(email.id) ? 'rgba(245,158,11,0.06)' : 'var(--domus-card-bg)',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s, opacity 0.15s, background-color 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.4rem', marginBottom: '0.2rem' }}>
                    {isMeeting && (
                      <Form.Check
                        type="checkbox"
                        checked={selectedMeetingIds.has(email.id)}
                        onChange={() => toggleSelectMeetingId(email.id)}
                        style={{ marginTop: '0.15rem', flexShrink: 0 }}
                        onClick={e => e.stopPropagation()}
                      />
                    )}
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', flex: 1 }}>
                      {email.subject || '(sin asunto)'}
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                      {isMeeting && <Badge bg="warning" text="dark" style={{ fontSize: '0.62rem' }}>🗓️ Reunión</Badge>}
                      {hasMaterials && <Badge bg="info" style={{ fontSize: '0.62rem' }}>📦 Materiales</Badge>}
                      {email.ai_type === 'reunion' && !isMeeting && <Badge bg="warning" text="dark" style={{ fontSize: '0.62rem' }}>🗓️ Reunión</Badge>}
                      {email.ai_type === 'evaluacion' && <Badge bg="danger" style={{ fontSize: '0.62rem' }}>📋 Evaluación</Badge>}
                      {email.ai_type === 'tarea' && <Badge bg="success" style={{ fontSize: '0.62rem' }}>📝 Tarea</Badge>}
                      {email.ai_type === 'aviso' && <Badge bg="secondary" style={{ fontSize: '0.62rem' }}>📢 Aviso</Badge>}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--domus-muted)', marginBottom: '0.25rem' }}>
                    De: {email.from_address}
                  </div>
                  {(email.ai_summary || email.snippet) && (
                    <div style={{
                      fontSize: '0.8rem',
                      color: email.ai_summary ? 'var(--domus-text)' : 'var(--domus-muted)',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      marginBottom: email.extracted_date ? '0.2rem' : 0,
                    }}>
                      {email.ai_summary || email.snippet}
                    </div>
                  )}
                  {email.extracted_date && (
                    <div style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 500, marginBottom: '0.15rem' }}>
                      📅 {new Date(email.extracted_date).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                  )}
                  <div style={{ fontSize: '0.72rem', color: 'var(--domus-muted)', marginTop: '0.35rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>{email.date ? timeAgo(email.date) : ''}</span>
                      <Badge bg={childBadge(email.child_email)}>{childName(email.child_email)}</Badge>
                    </div>
                    <span style={{ color: 'var(--domus-primary)', fontStyle: 'italic' }}>→ leer</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Assignments column ── */}
        <div className="school-sync-tasks-col">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h5 style={{ margin: 0 }}>📚 Tareas y pruebas{showOverdue && ' (Vencidas)'}</h5>
            {showOverdue && (
              <Button
                size="sm"
                variant="outline-secondary"
                onClick={() => setShowOverdue(false)}
              >
                ← Pendientes
              </Button>
            )}
            {!showOverdue && unsyncedAssignments.length > 0 && (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  variant="outline-success"
                  disabled={addingBulk}
                  title="Agregar todas al calendario de un clic"
                  onClick={() => handleBulkSync(unsyncedAssignments.map(a => a.id))}
                >
                  {addingBulk ? <Spinner size="sm" animation="border" /> : '📅 Todas'}
                </Button>
                {selectedArray.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="success"
                      disabled={addingBulk}
                      onClick={() => handleBulkSync(selectedArray.filter(id =>
                        assignments.find(a => a.id === id && !a.synced_to_calendar)
                      ))}
                    >
                      {addingBulk ? <Spinner size="sm" animation="border" /> : `📅 Seleccionadas (${selectedArray.length})`}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      onClick={() => setSelectedIds(new Set())}
                    >
                      ✕
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          {assignments.length === 0 ? (
            <p style={{ color: 'var(--domus-muted)' }}>No hay tareas pendientes.</p>
          ) : (
            <>
              {overdueAssignments.length > 0 && !showOverdue && (
                <div style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 8,
                  padding: '0.65rem 1rem',
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                  fontSize: '0.88rem',
                }}>
                  <span>⏰ <strong>{overdueAssignments.length} tarea(s) vencida(s)</strong></span>
                  <Button
                    size="sm"
                    variant="outline-danger"
                    onClick={() => setShowOverdue(true)}
                  >
                    Ver
                  </Button>
                </div>
              )}
              
              {pendingAssignments.length === 0 && overdueAssignments.length > 0 ? (
                <p style={{ color: 'var(--domus-muted)' }}>No hay tareas pendientes próximas.</p>
              ) : (
            (showOverdue ? overdueAssignments : pendingAssignments).map(task => {
              const taskChildName = childName(task.child_email);
              const due = formatDueDate(task.due_date);
              const overdue = task.due_date && new Date(task.due_date) < new Date();
              const hasMaterials = MATERIALS_RE.test(task.description || '');
              const isSelected = selectedIds.has(task.id);
              return (
                <div
                  key={task.id}
                  className="school-sync-card"
                  onClick={() => setAssignmentModal(task)}
                  style={{
                    padding: '0.75rem 1rem',
                    marginBottom: '0.75rem',
                    borderRadius: 8,
                    border: `1px solid ${isSelected ? 'var(--domus-primary)' : 'var(--domus-border)'}`,
                    backgroundColor: isSelected ? 'rgba(79,70,229,0.06)' : 'var(--domus-card-bg)',
                    transition: 'border-color 0.15s, background-color 0.15s, opacity 0.15s',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flex: 1 }}>
                      {!task.synced_to_calendar && (
                        <Form.Check
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectId(task.id)}
                          style={{ marginTop: '0.15rem', flexShrink: 0 }}
                          onClick={e => e.stopPropagation()}
                        />
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>
                          {task.title}
                          {task.synced_to_calendar && (
                            <Badge bg="success" style={{ marginLeft: '0.4rem', fontSize: '0.62rem' }}>✓ Calendario</Badge>
                          )}
                          {hasMaterials && (
                            <Badge bg="info" style={{ marginLeft: '0.4rem', fontSize: '0.62rem' }}>📦 Materiales</Badge>
                          )}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--domus-muted)' }}>{task.course_name}</div>
                        {due && (
                          <div style={{ fontSize: '0.78rem', color: overdue ? '#ef4444' : '#f59e0b', marginTop: '0.2rem' }}>
                            Vence: {due}
                          </div>
                        )}
                        <div style={{ fontSize: '0.72rem', marginTop: '0.2rem' }}><Badge bg={childBadge(task.child_email)}>{taskChildName}</Badge></div>
                        {hasMaterials && task.description && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--domus-muted)', marginTop: '0.3rem', fontStyle: 'italic', borderTop: '1px solid var(--domus-border)', paddingTop: '0.3rem' }}>
                            {task.description.slice(0, 120)}{task.description.length > 120 ? '…' : ''}
                          </div>
                        )}
                        <div style={{ fontSize: '0.72rem', color: 'var(--domus-muted)', marginTop: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
                          <span>{due || 'Sin fecha'}</span>
                          <span style={{ color: 'var(--domus-primary)', fontStyle: 'italic' }}>→ leer</span>
                        </div>
                      </div>
                    </div>
                    {!task.synced_to_calendar && (
                      <Button
                        size="sm"
                        variant="outline-success"
                        title="Agregar al calendario"
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                        disabled={syncingToCalendar.has(task.id)}
                        // Sin stopPropagation el clic burbujea a la tarjeta y
                        // abre además el modal de la tarea.
                        onClick={(e) => { e.stopPropagation(); handleSyncToCalendar(task); }}
                      >
                        {syncingToCalendar.has(task.id)
                          ? <Spinner size="sm" animation="border" />
                          : '📅 Agregar'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })              )}
            </>          )}
        </div>
      </div>}

      {/* ── Email Reader Modal ── */}
      <Modal show={!!emailModal} onHide={() => setEmailModal(null)} size="lg" scrollable>
        <Modal.Header closeButton style={{ borderColor: 'var(--domus-border)' }}>
          <Modal.Title style={{ fontSize: '1rem', wordBreak: 'break-word', color: 'var(--domus-text)' }}>
            {emailModal?.email?.subject || '(sin asunto)'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ backgroundColor: 'var(--domus-card-bg)', color: 'var(--domus-text)' }}>
          {emailModal && (
            <>
              <div style={{
                fontSize: '0.82rem',
                color: 'var(--domus-muted)',
                marginBottom: '1rem',
                paddingBottom: '0.75rem',
                borderBottom: '1px solid var(--domus-border)',
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '0.2rem 0.75rem',
              }}>
                <strong>De:</strong><span>{emailModal.email.from_address}</span>
                <strong>Fecha:</strong><span>{emailModal.email.date ? new Date(emailModal.email.date).toLocaleString('es-CL') : '—'}</span>
                <strong>Para:</strong><Badge bg={childBadge(emailModal.email.child_email)}>{childName(emailModal.email.child_email)}</Badge>
              </div>

              {/* AI Summary block */}
              {emailModal?.email?.ai_summary && (
                <div style={{
                  background: 'rgba(168,85,247,0.08)',
                  border: '1px solid rgba(168,85,247,0.25)',
                  borderRadius: 8,
                  padding: '0.65rem 0.9rem',
                  marginBottom: '1rem',
                  fontSize: '0.85rem',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--domus-text)' }}>
                    🤖 Resumen IA
                  </div>
                  <div style={{ color: 'var(--domus-text)' }}>{emailModal.email.ai_summary}</div>
                  {emailModal.email.extracted_date && (
                    <div style={{ marginTop: '0.4rem', color: '#f59e0b', fontWeight: 500, fontSize: '0.82rem' }}>
                      📅 Evento: {new Date(emailModal.email.extracted_date).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' })}
                    </div>
                  )}
                  {emailModal.email.ai_type && (
                    <div style={{ marginTop: '0.3rem', fontSize: '0.75rem', color: 'var(--domus-muted)' }}>
                      Tipo: <strong>{{ evaluacion: '📋 Evaluación', tarea: '📝 Tarea', reunion: '🗓️ Reunión', aviso: '📢 Aviso' }[emailModal.email.ai_type] || emailModal.email.ai_type}</strong>
                    </div>
                  )}
                </div>
              )}

              {emailModal.loading ? (
                <div style={{ textAlign: 'center', padding: '3rem' }}>
                  <Spinner animation="border" variant="primary" />
                  <p style={{ color: 'var(--domus-muted)', marginTop: '0.75rem', marginBottom: 0 }}>Cargando correo...</p>
                </div>
              ) : (
                <>
                  {/* Attachments: images and links from Classroom, plus Gmail attachments */}
                  {(() => {
                    const atts = Array.isArray(emailModal.email.attachments) ? emailModal.email.attachments : [];
                    const images = atts.filter(a => a.type === 'image');
                    const gmailAtts = atts.filter(a => a.type === 'gmail');
                    const links  = atts.filter(a => a.type !== 'image' && a.type !== 'gmail');
                    if (atts.length === 0) return null;
                    const gmailId = emailModal.email.gmail_id;
                    const fileIcon = (mimeType) => {
                      if (!mimeType) return '📎';
                      if (mimeType.includes('pdf')) return '📄';
                      if (mimeType.includes('image')) return '🖼';
                      if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
                      if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
                      if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽';
                      if (mimeType.includes('zip') || mimeType.includes('compressed')) return '🗜';
                      return '📎';
                    };
                    return (
                      <div style={{ marginBottom: '1rem' }}>
                        {images.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: (links.length || gmailAtts.length) ? '0.75rem' : 0 }}>
                            {images.map((img, i) => (
                              <a key={i} href={`https://drive.google.com/file/d/${img.id}/view`} target="_blank" rel="noreferrer">
                                <img
                                  src={img.thumbnailUrl}
                                  alt={img.title || `Imagen ${i + 1}`}
                                  style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 6, border: '1px solid var(--domus-border)', display: 'block', cursor: 'pointer' }}
                                  onError={e => { e.currentTarget.style.display = 'none'; }}
                                />
                              </a>
                            ))}
                          </div>
                        )}
                        {gmailAtts.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: links.length ? '0.5rem' : 0 }}>
                            {gmailAtts.map((a, i) => (
                              <button key={i}
                                onClick={() => handleDownloadAttachment(gmailId, a)}
                                style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--domus-border)', borderRadius: 4, color: 'var(--domus-primary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                {fileIcon(a.mimeType)} {a.filename}
                                {a.size > 0 && <span style={{ color: 'var(--domus-muted)', fontSize: '0.72rem' }}>({Math.round(a.size / 1024)} KB)</span>}
                              </button>
                            ))}
                          </div>
                        )}
                        {links.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {links.map((m, i) => (
                              <a key={i} href={m.url} target="_blank" rel="noreferrer"
                                style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--domus-border)', borderRadius: 4, color: 'var(--domus-primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                {m.type === 'youtube' ? '▶' : m.type === 'form' ? '📋' : '🔗'} {m.title || m.url}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {emailModal.htmlBody ? (
                    <iframe
                      srcDoc={buildEmailIframeSrcDoc(emailModal.htmlBody)}
                      sandbox="allow-popups allow-popups-to-escape-sandbox"
                      title="Contenido del correo"
                      style={{ width: '100%', height: 520, border: 'none', borderRadius: 4, backgroundColor: '#ffffff' }}
                    />
                  ) : emailModal.body ? (
                    <div style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: '0.9rem',
                      lineHeight: 1.65,
                      color: 'var(--domus-text)',
                      fontFamily: 'inherit',
                      margin: 0,
                    }}>
                      {renderPlainTextWithLinks(emailModal.body)}
                    </div>
                  ) : (
                    <div>
                      <p style={{ color: 'var(--domus-muted)', fontStyle: 'italic' }}>
                        No se pudo cargar el contenido completo. Fragmento disponible:
                      </p>
                      <p style={{ margin: 0 }}>{emailModal.email.snippet}</p>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer style={{ borderColor: 'var(--domus-border)', backgroundColor: 'var(--domus-card-bg)' }}>
          <Button variant="outline-secondary" onClick={() => setEmailModal(null)}>Cerrar</Button>
        </Modal.Footer>
      </Modal>

      {/* ── Assignment Reader Modal ── */}
      <Modal show={!!assignmentModal} onHide={() => setAssignmentModal(null)} size="lg" scrollable>
        <Modal.Header closeButton style={{ borderColor: 'var(--domus-border)' }}>
          <Modal.Title style={{ fontSize: '1rem', wordBreak: 'break-word', color: 'var(--domus-text)' }}>
            {assignmentModal?.title || '(sin título)'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ backgroundColor: 'var(--domus-card-bg)', color: 'var(--domus-text)' }}>
          {assignmentModal && (
            <>
              <div style={{
                fontSize: '0.82rem',
                color: 'var(--domus-muted)',
                marginBottom: '1rem',
                paddingBottom: '0.75rem',
                borderBottom: '1px solid var(--domus-border)',
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '0.2rem 0.75rem',
              }}>
                <strong>Asignatura:</strong><span>{assignmentModal.course_name || '—'}</span>
                <strong>Vence:</strong><span>{assignmentModal.due_date ? new Date(assignmentModal.due_date).toLocaleString('es-CL') : 'Sin fecha'}</span>
                <strong>Para:</strong><span><Badge bg={childBadge(assignmentModal.child_email)}>{childName(assignmentModal.child_email)}</Badge></span>
              </div>
              {assignmentModal.description ? (
                <div style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: '0.9rem',
                  lineHeight: 1.65,
                  color: 'var(--domus-text)',
                  fontFamily: 'inherit',
                }}>
                  {assignmentModal.description}
                </div>
              ) : (
                <p style={{ color: 'var(--domus-muted)', fontStyle: 'italic' }}>
                  Sin descripción disponible
                </p>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer style={{ borderColor: 'var(--domus-border)', backgroundColor: 'var(--domus-card-bg)', flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
          {assignmentModal && !assignmentModal.synced_to_calendar && (() => {
            const nextClass = !assignmentModal.due_date
              ? findNextClass(schedules, assignmentModal.child_email, assignmentModal.course_name)
              : null;
            return (
              <>
                {nextClass && (
                  <div style={{
                    background: 'rgba(16,185,129,0.1)',
                    border: '1px solid rgba(16,185,129,0.4)',
                    borderRadius: 8,
                    padding: '0.6rem 0.9rem',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}>
                    <span>
                      📆 <strong>Próxima clase de {nextClass.subject}:</strong>{' '}
                      {nextClass.dayName}, {nextClass.date.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' })}{' '}
                      {nextClass.date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <Button
                      size="sm"
                      variant="success"
                      onClick={() => {
                        handleSyncToCalendar(assignmentModal, nextClass.date);
                        setAssignmentModal(null);
                      }}
                    >
                      ✓ Agregar para esta fecha
                    </Button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  {nextClass && (
                    <Button
                      variant="outline-success"
                      size="sm"
                      onClick={() => {
                        handleSyncToCalendar(assignmentModal);
                        setAssignmentModal(null);
                      }}
                    >
                      📅 Agregar sin fecha
                    </Button>
                  )}
                  {!nextClass && (
                    <Button
                      variant="success"
                      onClick={() => {
                        handleSyncToCalendar(assignmentModal);
                        setAssignmentModal(null);
                      }}
                    >
                      📅 Agregar al calendario
                    </Button>
                  )}
                  <Button variant="outline-secondary" onClick={() => setAssignmentModal(null)}>Cerrar</Button>
                </div>
              </>
            );
          })()}
          {(!assignmentModal || assignmentModal.synced_to_calendar) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="outline-secondary" onClick={() => setAssignmentModal(null)}>Cerrar</Button>
            </div>
          )}
        </Modal.Footer>
      </Modal>
      {/* ── Schedule Modal ── */}
      <Modal show={showScheduleModal} onHide={() => setShowScheduleModal(false)} size="xl" scrollable>
        <Modal.Header closeButton style={{ borderColor: 'var(--domus-border)' }}>
          <Modal.Title style={{ color: 'var(--domus-text)' }}>📅 Horarios de Clases</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ backgroundColor: 'var(--domus-card-bg)', color: 'var(--domus-text)' }}>
          {/* Child selector */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
            {children.map(c => {
              const hasSchedule = schedules.some(s => s.child_email === c.email);
              return (
                <Button
                  key={c.email}
                  size="sm"
                  variant={scheduleTab === c.email ? childBadge(c.email) : 'outline-secondary'}
                  onClick={() => setScheduleTab(c.email)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  {c.name}
                  {hasSchedule && <Badge bg="light" text="dark" style={{ fontSize: '0.65rem' }}>✓</Badge>}
                </Button>
              );
            })}
          </div>

          {/* Schedule content for selected child */}
          {(() => {
            const childSchedule = schedules.filter(s => s.child_email === scheduleTab);
            const childInfo = children.find(c => c.email === scheduleTab);
            const maxPeriod = childSchedule.reduce((m, s) => Math.max(m, Number(s.period_order)), 0);

            if (childSchedule.length === 0) {
              return (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📋</div>
                  <p style={{ color: 'var(--domus-muted)', marginBottom: '1rem' }}>
                    No hay horario cargado para <strong>{childInfo?.name}</strong>.
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => handleLoadScheduleTemplate(scheduleTab)}
                    disabled={scheduleSaving || !childInfo?.has_template}
                  >
                    {scheduleSaving
                      ? <><Spinner size="sm" animation="border" className="me-2" />Cargando...</>
                      : `Cargar horario de ${childInfo?.name} desde imagen`}
                  </Button>
                  {!childInfo?.has_template && (
                    <p style={{ color: 'var(--domus-muted)', fontSize: '0.82rem', marginTop: '0.75rem' }}>
                      No hay horario predefinido para este hijo.
                    </p>
                  )}
                </div>
              );
            }

            return (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '0.5rem', textAlign: 'center', border: '1px solid var(--domus-border)', width: 70, color: 'var(--domus-muted)' }}>
                          Período
                        </th>
                        {DAY_NAMES.map((day, i) => (
                          <th key={i} style={{
                            padding: '0.5rem',
                            textAlign: 'center',
                            border: '1px solid var(--domus-border)',
                            backgroundColor: 'var(--domus-card-bg)',
                            fontWeight: 600,
                          }}>
                            {day}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: maxPeriod }, (_, i) => {
                        const period = i + 1;
                        const slots = [0,1,2,3,4].map(dayIdx =>
                          childSchedule.find(s =>
                            Number(s.day_of_week) === dayIdx && Number(s.period_order) === period
                          )
                        );
                        const sampleTime = slots.find(s => s?.start_time)?.start_time?.substring(0, 5) || '';
                        return (
                          <tr key={period}>
                            <td style={{
                              padding: '0.4rem',
                              textAlign: 'center',
                              border: '1px solid var(--domus-border)',
                              color: 'var(--domus-muted)',
                              fontSize: '0.75rem',
                              lineHeight: 1.3,
                            }}>
                              <strong>{period}</strong>
                              {sampleTime && <><br />{sampleTime}</>}
                            </td>
                            {slots.map((slot, dayIdx) => (
                              <td key={dayIdx} style={{
                                padding: '0.35rem 0.5rem',
                                border: '1px solid var(--domus-border)',
                                textAlign: 'center',
                                backgroundColor: slot ? getSubjectColor(slot.subject) : 'transparent',
                                color: slot ? '#fff' : 'transparent',
                                fontWeight: slot ? 500 : 400,
                                fontSize: '0.78rem',
                                minWidth: 100,
                              }}>
                                {slot?.subject || '—'}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <Button
                    variant="outline-primary"
                    size="sm"
                    onClick={() => handleLoadScheduleTemplate(scheduleTab)}
                    disabled={scheduleSaving || !childInfo?.has_template}
                  >
                    {scheduleSaving
                      ? <><Spinner size="sm" animation="border" className="me-1" />Guardando...</>
                      : '↺ Recargar horario desde imagen'}
                  </Button>
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => handleClearSchedule(scheduleTab)}
                  >
                    Borrar horario
                  </Button>
                </div>
              </>
            );
          })()}
        </Modal.Body>
        <Modal.Footer style={{ borderColor: 'var(--domus-border)', backgroundColor: 'var(--domus-card-bg)' }}>
          <Button variant="outline-secondary" onClick={() => setShowScheduleModal(false)}>Cerrar</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

