import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Button, Badge, Spinner, Alert, Modal, Form } from 'react-bootstrap';
import { toast } from 'react-toastify';
import { useNavigate, useLocation } from 'react-router-dom';
import apiClient from '../utils/apiClient';

const KNOWN_CHILDREN = [
  { email: 'anais_rehbein.ojeda@cicpm.cl', name: 'Anais' },
  { email: 'gabriel_parra.ojeda@cicpm.cl', name: 'Gabriel' },
];

const CHILD_BADGE_COLORS = {
  'anais_rehbein.ojeda@cicpm.cl': 'primary',
  'gabriel_parra.ojeda@cicpm.cl': 'success',
};

const MEETING_RE = /reuni[oó]n|citaci[oó]n|convocatoria|acto oficial|ceremonia|entrevista/i;
const MATERIALS_RE = /traer|materiales?|[uú]tiles?|llevar|implementos?|cuaderno|libros?\s|carpeta|l[aá]piz/i;

const DAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi'];
const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

// Horarios actualizados con datos reales del colegio
const SCHEDULE_TEMPLATES = {
  'anais_rehbein.ojeda@cicpm.cl': [
    // Lunes (0)
    { day_of_week: 0, period_order: 1, subject: 'Matemática',       start_time: '07:45', end_time: '08:30' },
    { day_of_week: 0, period_order: 2, subject: 'Matemática',       start_time: '08:30', end_time: '09:15' },
    { day_of_week: 0, period_order: 3, subject: 'Historia',         start_time: '09:35', end_time: '10:20' },
    { day_of_week: 0, period_order: 4, subject: 'Taller Lenguaje',  start_time: '10:20', end_time: '11:05' },
    { day_of_week: 0, period_order: 5, subject: 'Religión',         start_time: '11:15', end_time: '12:00' },
    { day_of_week: 0, period_order: 6, subject: 'Religión',         start_time: '12:00', end_time: '12:45' },
    { day_of_week: 0, period_order: 7, subject: 'Música',           start_time: '13:40', end_time: '14:25' },
    { day_of_week: 0, period_order: 8, subject: 'Música',           start_time: '14:25', end_time: '15:10' },
    // Martes (1) - Horario diferido
    { day_of_week: 1, period_order: 1, subject: 'Matemática',       start_time: '07:45', end_time: '08:30' },
    { day_of_week: 1, period_order: 2, subject: 'Matemática',       start_time: '08:30', end_time: '09:10' },
    { day_of_week: 1, period_order: 3, subject: 'Ed. Física',       start_time: '09:30', end_time: '10:10' },
    { day_of_week: 1, period_order: 4, subject: 'Ed. Física',       start_time: '10:10', end_time: '10:50' },
    { day_of_week: 1, period_order: 5, subject: 'Artes',            start_time: '11:00', end_time: '11:40' },
    { day_of_week: 1, period_order: 6, subject: 'Artes',            start_time: '11:40', end_time: '12:20' },
    { day_of_week: 1, period_order: 7, subject: 'Lenguaje',         start_time: '13:10', end_time: '13:50' },
    { day_of_week: 1, period_order: 8, subject: 'Lenguaje',         start_time: '13:50', end_time: '14:30' },
    // Miércoles (2)
    { day_of_week: 2, period_order: 1, subject: 'Ciencias',         start_time: '07:45', end_time: '08:30' },
    { day_of_week: 2, period_order: 2, subject: 'Taller Mat.',      start_time: '08:30', end_time: '09:15' },
    { day_of_week: 2, period_order: 3, subject: 'Lenguaje',         start_time: '09:35', end_time: '10:20' },
    { day_of_week: 2, period_order: 4, subject: 'Lenguaje',         start_time: '10:20', end_time: '11:05' },
    { day_of_week: 2, period_order: 5, subject: 'Taller Lenguaje',  start_time: '11:15', end_time: '12:00' },
    { day_of_week: 2, period_order: 6, subject: 'Ory/Cc',           start_time: '12:00', end_time: '12:45' },
    { day_of_week: 2, period_order: 7, subject: 'Matemática',       start_time: '13:40', end_time: '14:25' },
    { day_of_week: 2, period_order: 8, subject: 'Matemática',       start_time: '14:25', end_time: '15:10' },
    // Jueves (3)
    { day_of_week: 3, period_order: 1, subject: 'Ed. Física',       start_time: '07:45', end_time: '08:30' },
    { day_of_week: 3, period_order: 2, subject: 'Ed. Física',       start_time: '08:30', end_time: '09:15' },
    { day_of_week: 3, period_order: 3, subject: 'Taller Mat.',      start_time: '09:35', end_time: '10:20' },
    { day_of_week: 3, period_order: 4, subject: 'Tecnología',       start_time: '10:20', end_time: '11:05' },
    { day_of_week: 3, period_order: 5, subject: 'Lenguaje',         start_time: '11:15', end_time: '12:00' },
    { day_of_week: 3, period_order: 6, subject: 'Lenguaje',         start_time: '12:00', end_time: '12:45' },
    { day_of_week: 3, period_order: 7, subject: 'Inglés',           start_time: '13:40', end_time: '14:25' },
    { day_of_week: 3, period_order: 8, subject: 'Inglés',           start_time: '14:25', end_time: '15:10' },
    // Viernes (4)
    { day_of_week: 4, period_order: 1, subject: 'Inglés',           start_time: '07:45', end_time: '08:30' },
    { day_of_week: 4, period_order: 2, subject: 'Inglés',           start_time: '08:30', end_time: '09:15' },
    { day_of_week: 4, period_order: 3, subject: 'Historia',         start_time: '09:35', end_time: '10:20' },
    { day_of_week: 4, period_order: 4, subject: 'Historia',         start_time: '10:20', end_time: '11:05' },
    { day_of_week: 4, period_order: 5, subject: 'Ciencias',         start_time: '11:15', end_time: '12:00' },
    { day_of_week: 4, period_order: 6, subject: 'Ciencias',         start_time: '12:00', end_time: '12:45' },
  ],
  'gabriel_parra.ojeda@cicpm.cl': [
    // Lunes (0)
    { day_of_week: 0, period_order: 1, subject: 'Inglés',           start_time: '07:45', end_time: '08:30' },
    { day_of_week: 0, period_order: 2, subject: 'Lenguaje',         start_time: '08:30', end_time: '09:15' },
    { day_of_week: 0, period_order: 3, subject: 'Lenguaje',         start_time: '09:15', end_time: '10:00' },
    { day_of_week: 0, period_order: 4, subject: 'Biología',         start_time: '10:20', end_time: '11:05' },
    { day_of_week: 0, period_order: 5, subject: 'Biología',         start_time: '11:05', end_time: '11:50' },
    { day_of_week: 0, period_order: 6, subject: 'PAES Mat.',        start_time: '12:00', end_time: '12:45' },
    { day_of_week: 0, period_order: 7, subject: 'PAES Mat.',        start_time: '12:45', end_time: '13:30' },
    { day_of_week: 0, period_order: 8, subject: 'PAES Lenguaje',    start_time: '13:30', end_time: '14:15' },
    { day_of_week: 0, period_order: 9, subject: 'Matemática',       start_time: '15:15', end_time: '16:00' },
    // Martes (1) - Horario diferido
    { day_of_week: 1, period_order: 1, subject: 'Ory/Cc',           start_time: '07:45', end_time: '08:30' },
    { day_of_week: 1, period_order: 2, subject: 'Historia',         start_time: '08:30', end_time: '09:10' },
    { day_of_week: 1, period_order: 3, subject: 'Historia',         start_time: '09:10', end_time: '09:50' },
    { day_of_week: 1, period_order: 4, subject: 'Física',           start_time: '10:10', end_time: '10:50' },
    { day_of_week: 1, period_order: 5, subject: 'Física',           start_time: '10:50', end_time: '11:30' },
    { day_of_week: 1, period_order: 6, subject: 'Lenguaje',         start_time: '11:40', end_time: '12:20' },
    { day_of_week: 1, period_order: 7, subject: 'Matemática',       start_time: '12:20', end_time: '13:00' },
    { day_of_week: 1, period_order: 8, subject: 'Matemática',       start_time: '13:00', end_time: '13:40' },
    { day_of_week: 1, period_order: 9, subject: 'Química',          start_time: '14:30', end_time: '15:10' },
    // Miércoles (2)
    { day_of_week: 2, period_order: 1, subject: 'Física',           start_time: '07:45', end_time: '08:30' },
    { day_of_week: 2, period_order: 2, subject: 'Lenguaje',         start_time: '08:30', end_time: '09:15' },
    { day_of_week: 2, period_order: 3, subject: 'Lenguaje',         start_time: '09:15', end_time: '10:00' },
    { day_of_week: 2, period_order: 4, subject: 'Ed. Física',       start_time: '10:20', end_time: '11:05' },
    { day_of_week: 2, period_order: 5, subject: 'Ed. Física',       start_time: '11:05', end_time: '11:50' },
    { day_of_week: 2, period_order: 6, subject: 'Historia',         start_time: '12:00', end_time: '12:45' },
    { day_of_week: 2, period_order: 7, subject: 'Historia',         start_time: '12:45', end_time: '13:30' },
    { day_of_week: 2, period_order: 8, subject: 'Inglés',           start_time: '13:30', end_time: '14:15' },
    { day_of_week: 2, period_order: 9, subject: 'Religión',         start_time: '15:15', end_time: '16:00' },
    // Jueves (3)
    { day_of_week: 3, period_order: 1, subject: 'Matemática',       start_time: '07:45', end_time: '08:30' },
    { day_of_week: 3, period_order: 2, subject: 'Tecnología',       start_time: '08:30', end_time: '09:15' },
    { day_of_week: 3, period_order: 3, subject: 'Tecnología',       start_time: '09:15', end_time: '10:00' },
    { day_of_week: 3, period_order: 4, subject: 'Inglés',           start_time: '10:20', end_time: '11:05' },
    { day_of_week: 3, period_order: 5, subject: 'Inglés',           start_time: '11:05', end_time: '11:50' },
    { day_of_week: 3, period_order: 6, subject: 'Artes/Música',     start_time: '12:00', end_time: '12:45' },
    { day_of_week: 3, period_order: 7, subject: 'Artes/Música',     start_time: '12:45', end_time: '13:30' },
    { day_of_week: 3, period_order: 8, subject: 'Ory/Cc',           start_time: '13:30', end_time: '14:15' },
    { day_of_week: 3, period_order: 9, subject: 'Biología',         start_time: '15:15', end_time: '16:00' },
    // Viernes (4)
    { day_of_week: 4, period_order: 1, subject: 'Matemática',       start_time: '07:45', end_time: '08:30' },
    { day_of_week: 4, period_order: 2, subject: 'Matemática',       start_time: '08:30', end_time: '09:15' },
    { day_of_week: 4, period_order: 3, subject: 'Religión',         start_time: '09:15', end_time: '10:00' },
    { day_of_week: 4, period_order: 4, subject: 'Química',          start_time: '10:20', end_time: '11:05' },
    { day_of_week: 4, period_order: 5, subject: 'Química',          start_time: '11:05', end_time: '11:50' },
    { day_of_week: 4, period_order: 6, subject: 'Lenguaje',         start_time: '12:00', end_time: '12:45' },
    { day_of_week: 4, period_order: 7, subject: 'Lenguaje',         start_time: '12:45', end_time: '13:30' },
  ],
};

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
  const [emails, setEmails] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
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
  const [scheduleTab, setScheduleTab] = useState('anais_rehbein.ojeda@cicpm.cl');
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiClient.get('/school-sync/status');
      setConnected(res.data.connected || []);
    } catch {
      toast.error('Error obteniendo estado de School Sync');
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
      const child = KNOWN_CHILDREN.find(c => c.email === connectedEmail);
      toast.success(`✅ ${child?.name || connectedEmail} conectado correctamente`);
      navigate('/school-sync', { replace: true });
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
  }, [location.search, navigate]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await fetchStatus();
      fetchSchedules(); // non-blocking, non-critical
      setLoading(false);
    }
    init();
  }, [fetchStatus]);

  useEffect(() => {
    if (connected.length > 0) {
      fetchData(activeFilter === 'all' ? null : activeFilter);
    }
    setSelectedIds(new Set());
  }, [connected.length, activeFilter, fetchData]);

  const handleConnect = async (child) => {
    setConnecting(child.email);
    try {
      const res = await apiClient.get('/school-sync/auth-url', {
        params: { child_email: child.email, child_name: child.name },
      });
      window.location.href = res.data.url;
    } catch {
      toast.error('Error generando URL de autorización');
      setConnecting(null);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiClient.post('/school-sync/sync');
      toast.success('Sincronización completada');
      await fetchStatus();
      await fetchData(activeFilter === 'all' ? null : activeFilter);
    } catch {
      toast.error('Error durante la sincronización');
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async (childEmail) => {
    const child = KNOWN_CHILDREN.find(c => c.email === childEmail);
    if (!window.confirm(`¿Desconectar la cuenta de ${child?.name || childEmail}?`)) return;
    try {
      await apiClient.delete('/school-sync/disconnect', { data: { child_email: childEmail } });
      toast.success('Cuenta desconectada');
      await fetchStatus();
    } catch {
      toast.error('Error desconectando cuenta');
    }
  };

  const handleOpenEmail = async (email) => {
    setEmailModal({ email, body: null, htmlBody: null, loading: true });
    try {
      const res = await apiClient.get(`/school-sync/emails/${email.gmail_id}/body`);
      setEmailModal({ email, body: res.data.body, htmlBody: res.data.htmlBody, loading: false });
    } catch {
      setEmailModal({ email, body: null, htmlBody: null, loading: false });
    }
  };

  const handleSyncToCalendar = async (assignment, suggestedDate = null) => {
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
    }
  };

  const handleLoadScheduleTemplate = async (childEmail) => {
    const template = SCHEDULE_TEMPLATES[childEmail];
    if (!template) return;
    setScheduleSaving(true);
    try {
      await apiClient.post('/school-sync/schedules', { child_email: childEmail, schedule: template });
      toast.success('Horario cargado correctamente');
      await fetchSchedules();
    } catch {
      toast.error('Error al guardar horario');
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
      const succeeded = res.data.results.filter(r => r.success).length;
      const skipped = res.data.results.filter(r => r.skipped).length;
      if (succeeded > 0) toast.success(`${succeeded} tarea(s) agregadas al calendario`);
      if (skipped > 0) toast.info(`${skipped} ya estaban en el calendario`);
      setAssignments(prev =>
        prev.map(a => ids.includes(a.id) ? { ...a, synced_to_calendar: true } : a)
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
      let succeeded = 0;
      for (const id of ids) {
        await apiClient.post('/school-sync/sync-email-to-calendar', { emailId: id });
        succeeded++;
      }
      if (succeeded > 0) toast.success(`${succeeded} reunión(es) agregada(s) al calendario`);
      setSelectedMeetingIds(new Set());
    } catch {
      toast.error('Error al agregar reuniones al calendario');
    } finally {
      setAddingMeetingsBulk(false);
    }
  };

  // Client-side detection from loaded data (only last 30 days)
  const detectedMeetings = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return emails.filter(e =>
      MEETING_RE.test(`${e.subject || ''} ${e.snippet || ''}`) &&
      e.date && new Date(e.date).getTime() > cutoff
    );
  }, [emails]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  if (connected.length === 0) {
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
          {KNOWN_CHILDREN.map(child => (
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

  const connectedEmails = connected.map(c => c.email);
  const lastSync = connected.reduce((latest, c) => {
    if (!c.last_sync) return latest;
    return !latest || new Date(c.last_sync) > new Date(latest) ? c.last_sync : latest;
  }, null);
  
  // Separate overdue and pending assignments
  const pendingAssignments = assignments.filter(a => {
    const overdue = a.due_date && new Date(a.due_date) < new Date();
    return !overdue;
  });
  const overdueAssignments = assignments.filter(a => {
    const overdue = a.due_date && new Date(a.due_date) < new Date();
    return overdue;
  });
  
  const unsyncedAssignments = pendingAssignments.filter(a => !a.synced_to_calendar);
  const selectedArray = [...selectedIds];

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>🎓 School Sync</h2>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
            {KNOWN_CHILDREN.map(child => {
              const isLinked = connectedEmails.includes(child.email);
              const info = connected.find(c => c.email === child.email);
              return (
                <span key={child.email} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
                  <Badge bg={isLinked ? 'success' : 'secondary'}>{child.name}</Badge>
                  {isLinked ? (
                    <span
                      style={{ cursor: 'pointer', color: '#ef4444', fontSize: '0.75rem' }}
                      onClick={() => handleDisconnect(child.email)}
                      title="Desconectar"
                    >✕</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      style={{ padding: '0 0.4rem', fontSize: '0.72rem' }}
                      disabled={!!connecting}
                      onClick={() => handleConnect(child)}
                    >
                      {connecting === child.email ? <Spinner size="sm" animation="border" /> : '+ Conectar'}
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

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {[{ key: 'all', label: 'Todos' }, ...KNOWN_CHILDREN.map(c => ({ key: c.email, label: c.name }))].map(f => (
          <Button
            key={f.key}
            size="sm"
            variant={activeFilter === f.key ? 'primary' : 'outline-secondary'}
            onClick={() => setActiveFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
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

      {/* Two-column content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>

        {/* ── Emails column ── */}
        <div>
          <h5 style={{ marginBottom: '1rem' }}>📧 Correos del colegio</h5>
          {emails.length === 0 ? (
            <p style={{ color: 'var(--domus-muted)' }}>No hay correos recientes.</p>
          ) : (
            emails.map(email => {
              const text = `${email.subject || ''} ${email.snippet || ''}`;
              const isRecent = email.date && (Date.now() - new Date(email.date).getTime()) < 30 * 24 * 60 * 60 * 1000;
              const isMeeting = isRecent && MEETING_RE.test(text);
              const hasMaterials = MATERIALS_RE.test(text);
              return (
                <div
                  key={email.id}
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
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
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
                    </div>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--domus-muted)', marginBottom: '0.25rem' }}>
                    De: {email.from_address}
                  </div>
                  {email.snippet && (
                    <div style={{
                      fontSize: '0.8rem',
                      color: 'var(--domus-muted)',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}>
                      {email.snippet}
                    </div>
                  )}
                  <div style={{ fontSize: '0.72rem', color: 'var(--domus-muted)', marginTop: '0.35rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>{email.date ? timeAgo(email.date) : ''}</span>
                      <Badge bg={CHILD_BADGE_COLORS[email.child_email] || 'secondary'}>{KNOWN_CHILDREN.find(c => c.email === email.child_email)?.name || email.child_email}</Badge>
                    </div>
                    <span style={{ color: 'var(--domus-primary)', fontStyle: 'italic' }}>→ leer</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Assignments column ── */}
        <div>
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
              const childName = KNOWN_CHILDREN.find(c => c.email === task.child_email)?.name || task.child_email;
              const due = formatDueDate(task.due_date);
              const overdue = task.due_date && new Date(task.due_date) < new Date();
              const hasMaterials = MATERIALS_RE.test(task.description || '');
              const isSelected = selectedIds.has(task.id);
              return (
                <div
                  key={task.id}
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
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
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
                        <div style={{ fontSize: '0.72rem', marginTop: '0.2rem' }}><Badge bg={CHILD_BADGE_COLORS[task.child_email] || 'secondary'}>{childName}</Badge></div>
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
                        onClick={() => handleSyncToCalendar(task)}
                      >
                        📅 Agregar
                      </Button>
                    )}
                  </div>
                </div>
              );
            })              )}
            </>          )}
        </div>
      </div>

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
                <strong>Para:</strong><Badge bg={CHILD_BADGE_COLORS[emailModal.email.child_email] || 'secondary'}>{KNOWN_CHILDREN.find(c => c.email === emailModal.email.child_email)?.name || emailModal.email.child_email}</Badge>
              </div>
              {emailModal.loading ? (
                <div style={{ textAlign: 'center', padding: '3rem' }}>
                  <Spinner animation="border" variant="primary" />
                  <p style={{ color: 'var(--domus-muted)', marginTop: '0.75rem', marginBottom: 0 }}>Cargando correo...</p>
                </div>
              ) : emailModal.htmlBody ? (
                <iframe
                  srcDoc={emailModal.htmlBody}
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  title="Contenido del correo"
                  style={{ width: '100%', height: 520, border: 'none', borderRadius: 4 }}
                />
              ) : emailModal.body ? (
                <pre style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: '0.9rem',
                  lineHeight: 1.65,
                  color: 'var(--domus-text)',
                  fontFamily: 'inherit',
                  margin: 0,
                }}>
                  {cleanPlainTextEmail(emailModal.body)}
                </pre>
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
                <strong>Para:</strong><span><Badge bg={CHILD_BADGE_COLORS[assignmentModal.child_email] || 'secondary'}>{KNOWN_CHILDREN.find(c => c.email === assignmentModal.child_email)?.name || assignmentModal.child_email}</Badge></span>
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
            {KNOWN_CHILDREN.map(c => {
              const hasSchedule = schedules.some(s => s.child_email === c.email);
              return (
                <Button
                  key={c.email}
                  size="sm"
                  variant={scheduleTab === c.email ? CHILD_BADGE_COLORS[c.email] === 'primary' ? 'primary' : 'success' : 'outline-secondary'}
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
            const childInfo = KNOWN_CHILDREN.find(c => c.email === scheduleTab);
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
                    disabled={scheduleSaving}
                  >
                    {scheduleSaving
                      ? <><Spinner size="sm" animation="border" className="me-2" />Cargando...</>
                      : `Cargar horario de ${childInfo?.name} desde imagen`}
                  </Button>
                  {!SCHEDULE_TEMPLATES[scheduleTab] && (
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
                    disabled={scheduleSaving}
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

