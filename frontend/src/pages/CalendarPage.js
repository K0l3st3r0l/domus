import React, { useEffect, useState, useCallback } from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import 'moment/locale/es';
import { Modal, Button, Form, Row, Col } from 'react-bootstrap';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient';

moment.locale('es');
const localizer = momentLocalizer(moment);

const COLORS = ['#4f46e5','#10b981','#f59e0b','#ef4444','#06b6d4','#8b5cf6','#f97316'];

const CHILD_INFO = {
  'anais_rehbein.ojeda@cicpm.cl': { name: 'Anais', color: '#6366f1' },
  'gabriel_parra.ojeda@cicpm.cl': { name: 'Gabriel', color: '#10b981' },
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

function inferScheduledEvent(event, schedules) {
  if (!event.allDay || !event.child_email || !Array.isArray(schedules) || schedules.length === 0) {
    return event;
  }

  const eventDate = new Date(event.start);
  const jsDay = eventDate.getDay();
  const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1;
  const candidateText = [event.course_name, event.title, event.description].filter(Boolean).join(' ');
  const matchingSlot = schedules
    .filter(slot => slot.child_email === event.child_email && Number(slot.day_of_week) === dayOfWeek)
    .find(slot => subjectMatches(slot.subject, candidateText));

  if (!matchingSlot?.start_time) return event;

  const [startHour, startMinute] = matchingSlot.start_time.substring(0, 5).split(':').map(Number);
  const inferredStart = new Date(eventDate);
  inferredStart.setHours(startHour, startMinute, 0, 0);

  const inferredEnd = new Date(inferredStart);
  if (matchingSlot.end_time) {
    const [endHour, endMinute] = matchingSlot.end_time.substring(0, 5).split(':').map(Number);
    inferredEnd.setHours(endHour, endMinute, 0, 0);
  } else {
    inferredEnd.setMinutes(inferredEnd.getMinutes() + 45);
  }

  return {
    ...event,
    start: inferredStart,
    end: inferredEnd,
    allDay: false,
    inferredFromSchedule: true,
  };
}



const MESSAGES = {
  allDay: 'Todo el día', previous: '‹', next: '›', today: 'Hoy',
  month: 'Mes', week: 'Semana', day: 'Día', agenda: 'Agenda',
  date: 'Fecha', time: 'Hora', event: 'Evento', noEventsInRange: 'Sin eventos en este rango.'
};

export default function CalendarPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [detailEvent, setDetailEvent] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', start_time: '', end_time: '', all_day: false, color: '#4f46e5', alert_minutes: '' });

  const fetchEvents = useCallback(async () => {
    try {
      const res = await apiClient.get('/calendar');
      setEvents(res.data.map(e => ({
        ...e,
        start: new Date(e.start_time),
        end: e.end_time ? new Date(e.end_time) : new Date(e.start_time),
        allDay: e.all_day,
      })));
    } catch { toast.error('Error cargando eventos'); }
  }, []);

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await apiClient.get('/school-sync/schedules');
      setSchedules(res.data || []);
    } catch {
      setSchedules([]);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
    fetchSchedules();
  }, [fetchEvents, fetchSchedules]);

  const calendarEvents = events.map(event => inferScheduledEvent(event, schedules));

  const openNew = (slotInfo) => {
    const start = slotInfo?.start || new Date();
    setEditingEvent(null);
    setForm({
      title: '', description: '',
      start_time: moment(start).format('YYYY-MM-DDTHH:mm'),
      end_time: moment(start).add(1, 'hour').format('YYYY-MM-DDTHH:mm'),
      all_day: false, color: '#4f46e5', alert_minutes: ''
    });
    setShowModal(true);
  };

  const openEdit = (event) => {
    if (event.school_assignment_id || event.color === '#f59e0b') {
      setDetailEvent(event);
      setShowDetailModal(true);
    } else {
      setEditingEvent(event);
      setForm({
        title: event.title,
        description: event.description || '',
        start_time: moment(event.start).format('YYYY-MM-DDTHH:mm'),
        end_time: moment(event.end).format('YYYY-MM-DDTHH:mm'),
        all_day: event.all_day || false,
        color: event.color || '#4f46e5',
        alert_minutes: event.alert_minutes || '',
      });
      setShowModal(true);
    }
  };

  const handleSave = async () => {
    if (!form.title) { toast.warn('El título es obligatorio'); return; }
    try {
      if (editingEvent) {
        await apiClient.put(`/calendar/${editingEvent.id}`, form);
        toast.success('Evento actualizado');
      } else {
        await apiClient.post('/calendar', form);
        toast.success('Evento creado');
      }
      setShowModal(false);
      fetchEvents();
    } catch { toast.error('Error guardando el evento'); }
  };

  const handleDelete = async () => {
    if (!window.confirm('¿Eliminar este evento?')) return;
    try {
      await apiClient.delete(`/calendar/${editingEvent.id}`);
      toast.success('Evento eliminado');
      setShowModal(false);
      fetchEvents();
    } catch { toast.error('Error eliminando el evento'); }
  };

  const eventStyleGetter = (event) => {
    const child = CHILD_INFO[event.child_email];
    const bg = child ? child.color : (event.color || '#4f46e5');
    return {
      style: { backgroundColor: bg, borderRadius: '6px', border: 'none', fontSize: '0.82rem' }
    };
  };

  return (
    <div>
      <div className="domus-topbar">
        <h1 className="domus-page-title">📅 Calendario familiar</h1>
        <Button className="btn-domus" onClick={() => openNew(null)}>+ Nuevo evento</Button>
      </div>

      <div className="domus-card" style={{ height: '70vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.8rem', flexShrink: 0 }}>
          {Object.entries(CHILD_INFO).map(([email, info]) => (
            <span key={email} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: info.color, flexShrink: 0, display: 'inline-block' }} />
              {info.name}
            </span>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
        <Calendar
          localizer={localizer}
          events={calendarEvents}
          startAccessor="start"
          endAccessor="end"
          style={{ height: '100%' }}
          messages={MESSAGES}
          eventPropGetter={eventStyleGetter}
          onSelectSlot={openNew}
          onSelectEvent={openEdit}
          selectable
        />
        </div>
      </div>

      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{editingEvent ? 'Editar evento' : 'Nuevo evento'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Título *</Form.Label>
              <Form.Control value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ej: Reunión colegio" />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Descripción</Form.Label>
              <Form.Control as="textarea" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </Form.Group>
            <Row>
              <Col>
                <Form.Group className="mb-3">
                  <Form.Label>Inicio</Form.Label>
                  <Form.Control type="datetime-local" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
                </Form.Group>
              </Col>
              <Col>
                <Form.Group className="mb-3">
                  <Form.Label>Fin</Form.Label>
                  <Form.Control type="datetime-local" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col>
                <Form.Group className="mb-3">
                  <Form.Label>Color</Form.Label>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {COLORS.map(c => (
                      <div key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                        style={{ width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer',
                          border: form.color === c ? '3px solid #1e293b' : '2px solid transparent' }} />
                    ))}
                  </div>
                </Form.Group>
              </Col>
              <Col>
                <Form.Group className="mb-3">
                  <Form.Label>Alerta (min antes)</Form.Label>
                  <Form.Select value={form.alert_minutes} onChange={e => setForm(f => ({ ...f, alert_minutes: e.target.value }))}>
                    <option value="">Sin alerta</option>
                    <option value="15">15 minutos</option>
                    <option value="30">30 minutos</option>
                    <option value="60">1 hora</option>
                    <option value="1440">1 día</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <Form.Check type="checkbox" label="Todo el día" checked={form.all_day} onChange={e => setForm(f => ({ ...f, all_day: e.target.checked }))} />
          </Form>
        </Modal.Body>
        <Modal.Footer>
          {editingEvent && <Button variant="outline-danger" onClick={handleDelete}>Eliminar</Button>}
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
          <Button className="btn-domus" onClick={handleSave}>Guardar</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showDetailModal} onHide={() => setShowDetailModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Detalles de la actividad</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {detailEvent && (
            <div>
              <div className="mb-3">
                <h5 style={{ color: '#4f46e5', marginBottom: '0.5rem' }}>{detailEvent.title}</h5>
                {detailEvent.child_email && CHILD_INFO[detailEvent.child_email] && (
                  <div className="mb-2">
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                      padding: '0.2rem 0.6rem', borderRadius: 12,
                      backgroundColor: CHILD_INFO[detailEvent.child_email].color,
                      color: '#fff', fontSize: '0.8rem', fontWeight: 600,
                    }}>
                      {CHILD_INFO[detailEvent.child_email].name}
                    </span>
                  </div>
                )}
              </div>
              {detailEvent.course_name && (
                <div className="mb-3">
                  <strong>Materia:</strong> {detailEvent.course_name}
                </div>
              )}
              {detailEvent.description && (
                <div className="mb-3">
                  <strong>Descripción:</strong>
                  <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '0.5rem' }}>
                    {detailEvent.description}
                  </p>
                </div>
              )}
              <div className="mb-3">
                <strong>Fecha:</strong> {moment(detailEvent.start).format('dddd, D [de] MMMM [de] YYYY')}
              </div>
              {!detailEvent.all_day && (
                <div className="mb-3">
                  <strong>Hora:</strong> {moment(detailEvent.start).format('HH:mm')} - {moment(detailEvent.end).format('HH:mm')}
                </div>
              )}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDetailModal(false)}>Cerrar</Button>
          <Button className="btn-domus" onClick={() => {
            setShowDetailModal(false);
            if (detailEvent.school_assignment_id) {
              navigate(`/school-sync?openAssignment=${detailEvent.school_assignment_id}`);
            } else {
              const rawTitle = (detailEvent.title || '').replace(/^🗓️\s*/, '');
              navigate(`/school-sync?openEmail=${encodeURIComponent(rawTitle)}`);
            }
          }}>
            Ver en School Sync
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
