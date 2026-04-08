import React, { useEffect, useState, useCallback } from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import 'moment/locale/es';
import { Modal, Button, Form, Row, Col } from 'react-bootstrap';
import { toast } from 'react-toastify';
import apiClient from '../utils/apiClient';

moment.locale('es');
const localizer = momentLocalizer(moment);

const COLORS = ['#4f46e5','#10b981','#f59e0b','#ef4444','#06b6d4','#8b5cf6','#f97316'];

const MESSAGES = {
  allDay: 'Todo el día', previous: '‹', next: '›', today: 'Hoy',
  month: 'Mes', week: 'Semana', day: 'Día', agenda: 'Agenda',
  date: 'Fecha', time: 'Hora', event: 'Evento', noEventsInRange: 'Sin eventos en este rango.'
};

export default function CalendarPage() {
  const [events, setEvents] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
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

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

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

  const eventStyleGetter = (event) => ({
    style: { backgroundColor: event.color || '#4f46e5', borderRadius: '6px', border: 'none', fontSize: '0.82rem' }
  });

  return (
    <div>
      <div className="domus-topbar">
        <h1 className="domus-page-title">📅 Calendario familiar</h1>
        <Button className="btn-domus" onClick={() => openNew(null)}>+ Nuevo evento</Button>
      </div>

      <div className="domus-card" style={{ height: '70vh' }}>
        <Calendar
          localizer={localizer}
          events={events}
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
    </div>
  );
}
