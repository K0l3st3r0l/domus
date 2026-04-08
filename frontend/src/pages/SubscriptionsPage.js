import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Button, Modal, Form, Badge } from 'react-bootstrap';
import { toast } from 'react-toastify';
import apiClient from '../utils/apiClient';

const CATEGORIES = [
  'Entretenimiento', 'Música', 'Vídeo y streaming', 'Productividad',
  'Almacenamiento', 'Noticias', 'Educación', 'Juegos', 'Salud', 'Seguridad', 'Otros',
];

const CYCLE_LABELS = { monthly: 'Mensual', yearly: 'Anual', weekly: 'Semanal' };
const CYCLE_SUFFIX = { monthly: '/mes', yearly: '/año', weekly: '/sem' };

const STATUS_CONFIG = {
  active:    { label: 'Activa',    bg: 'success' },
  paused:    { label: 'Pausada',   bg: 'warning' },
  cancelled: { label: 'Cancelada', bg: 'secondary' },
};

const EMPTY_FORM = {
  name: '', category: 'Entretenimiento', amount: '', currency: 'CLP',
  billing_cycle: 'monthly', next_billing_date: '', status: 'active',
  alert_days: 3, url: '', notes: '',
};

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function AlertBadge({ sub }) {
  const days = daysUntil(sub.next_billing_date);
  if (sub.status !== 'active') return null;
  if (days < 0) return <Badge bg="danger" className="ms-2">Vencida</Badge>;
  if (days === 0) return <Badge bg="danger" className="ms-2">Hoy</Badge>;
  if (days <= sub.alert_days) return <Badge bg="warning" text="dark" className="ms-2">{days}d</Badge>;
  return null;
}

export default function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingSub, setEditingSub] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [filterStatus, setFilterStatus] = useState('active');

  const fetchData = useCallback(async () => {
    try {
      const [subsRes, sumRes] = await Promise.all([
        apiClient.get('/subscriptions' + (filterStatus ? `?status=${filterStatus}` : '')),
        apiClient.get('/subscriptions/summary'),
      ]);
      setSubscriptions(subsRes.data);
      setSummary(sumRes.data);
    } catch {
      toast.error('Error cargando suscripciones');
    }
  }, [filterStatus]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNew = () => {
    setEditingSub(null);
    setForm({ ...EMPTY_FORM, next_billing_date: new Date().toISOString().split('T')[0] });
    setShowModal(true);
  };

  const openEdit = (sub) => {
    setEditingSub(sub);
    setForm({
      name: sub.name,
      category: sub.category,
      amount: sub.amount,
      currency: sub.currency,
      billing_cycle: sub.billing_cycle,
      next_billing_date: sub.next_billing_date?.split('T')[0] || '',
      status: sub.status,
      alert_days: sub.alert_days,
      url: sub.url || '',
      notes: sub.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.amount || !form.next_billing_date) {
      toast.warn('Nombre, importe y fecha de renovación requeridos');
      return;
    }
    try {
      if (editingSub) {
        await apiClient.put(`/subscriptions/${editingSub.id}`, form);
        toast.success('Suscripción actualizada');
      } else {
        await apiClient.post('/subscriptions', form);
        toast.success('Suscripción añadida');
      }
      setShowModal(false);
      fetchData();
    } catch {
      toast.error('Error guardando suscripción');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`¿Eliminar la suscripción "${editingSub.name}"?`)) return;
    try {
      await apiClient.delete(`/subscriptions/${editingSub.id}`);
      toast.success('Suscripción eliminada');
      setShowModal(false);
      fetchData();
    } catch {
      toast.error('Error eliminando');
    }
  };

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  // Suscripciones con alerta activa (para el panel de alertas)
  const alerts = subscriptions.filter(s => {
    if (s.status !== 'active') return false;
    const d = daysUntil(s.next_billing_date);
    return d <= s.alert_days;
  });

  return (
    <div>
      <div className="domus-topbar">
        <h1 className="domus-page-title">📋 Suscripciones</h1>
        <Button className="btn-domus" onClick={openNew}>+ Nueva</Button>
      </div>

      {/* Resumen */}
      {summary && (
        <Row className="g-3 mb-4">
          <Col md={4}>
            <div className="domus-card text-center">
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>ACTIVAS</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#4f46e5' }}>
                {summary.active_count}
              </div>
            </div>
          </Col>
          <Col md={4}>
            <div className="domus-card text-center">
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>COSTE MENSUAL</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#ef4444' }}>
                ${Math.round(summary.monthly_cost).toLocaleString('es-CL')}
              </div>
            </div>
          </Col>
          <Col md={4}>
            <div className="domus-card text-center">
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>COSTE ANUAL</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#ef4444' }}>
                ${Math.round(summary.yearly_cost).toLocaleString('es-CL')}
              </div>
            </div>
          </Col>
        </Row>
      )}

      {/* Panel de alertas */}
      {alerts.length > 0 && (
        <div className="domus-card mb-4" style={{ borderLeft: '4px solid #f59e0b' }}>
          <h6 style={{ fontWeight: 600, marginBottom: '0.75rem', color: '#92400e' }}>
            ⚠️ Próximas renovaciones
          </h6>
          {alerts.map(sub => {
            const days = daysUntil(sub.next_billing_date);
            return (
              <div key={sub.id}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                onClick={() => openEdit(sub)}>
                <span style={{ fontWeight: 500 }}>{sub.name}</span>
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  {days <= 0 ? 'Hoy' : `en ${days} día${days !== 1 ? 's' : ''}`}
                  {' — '}${Math.round(sub.amount).toLocaleString('es-CL')} {CYCLE_SUFFIX[sub.billing_cycle]}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Filtro de estado */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[['', 'Todas'], ['active', 'Activas'], ['paused', 'Pausadas'], ['cancelled', 'Canceladas']].map(([val, label]) => (
          <button key={val} type="button"
            onClick={() => setFilterStatus(val)}
            style={{ padding: '0.35rem 0.9rem', borderRadius: 20, border: '1.5px solid',
              cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem',
              borderColor: filterStatus === val ? '#4f46e5' : '#e2e8f0',
              background: filterStatus === val ? '#4f46e5' : 'transparent',
              color: filterStatus === val ? '#fff' : '#64748b' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Lista de suscripciones */}
      <Row className="g-3">
        {subscriptions.length === 0 && (
          <Col>
            <div className="domus-card" style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>
              No hay suscripciones. ¡Añade la primera!
            </div>
          </Col>
        )}
        {subscriptions.map(sub => {
          const days = daysUntil(sub.next_billing_date);
          const isAlert = sub.status === 'active' && days <= sub.alert_days;
          return (
            <Col key={sub.id} md={6} lg={4}>
              <div className="domus-card" onClick={() => openEdit(sub)}
                style={{ cursor: 'pointer', borderLeft: isAlert ? '3px solid #f59e0b' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '1rem' }}>
                    {sub.name}
                    <AlertBadge sub={sub} />
                  </div>
                  <Badge bg={STATUS_CONFIG[sub.status]?.bg || 'secondary'} style={{ flexShrink: 0 }}>
                    {STATUS_CONFIG[sub.status]?.label || sub.status}
                  </Badge>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.75rem' }}>
                  {sub.category} · {CYCLE_LABELS[sub.billing_cycle]}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '1.15rem', color: '#ef4444' }}>
                    ${Math.round(sub.amount).toLocaleString('es-CL')} <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#94a3b8' }}>{sub.currency} {CYCLE_SUFFIX[sub.billing_cycle]}</span>
                  </span>
                  <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                    Renueva: {new Date(sub.next_billing_date).toLocaleDateString('es-ES')}
                  </span>
                </div>
              </div>
            </Col>
          );
        })}
      </Row>

      {/* Modal crear / editar */}
      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{editingSub ? 'Editar suscripción' : 'Nueva suscripción'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Row>
            <Col xs={8}>
              <Form.Group className="mb-3">
                <Form.Label>Nombre *</Form.Label>
                <Form.Control value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Netflix, Spotify…" />
              </Form.Group>
            </Col>
            <Col xs={4}>
              <Form.Group className="mb-3">
                <Form.Label>Estado</Form.Label>
                <Form.Select value={form.status} onChange={e => setField('status', e.target.value)}>
                  <option value="active">Activa</option>
                  <option value="paused">Pausada</option>
                  <option value="cancelled">Cancelada</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          <Form.Group className="mb-3">
            <Form.Label>Categoría</Form.Label>
            <Form.Select value={form.category} onChange={e => setField('category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </Form.Select>
          </Form.Group>

          <Row>
            <Col>
              <Form.Group className="mb-3">
                <Form.Label>Importe *</Form.Label>
                <Form.Control type="number" min="0.01" step="0.01" value={form.amount}
                  onChange={e => setField('amount', e.target.value)} placeholder="9.99" />
              </Form.Group>
            </Col>
            <Col xs={4}>
              <Form.Group className="mb-3">
                <Form.Label>Divisa</Form.Label>
                <Form.Select value={form.currency} onChange={e => setField('currency', e.target.value)}>
                  <option>CLP</option>
                  <option>USD</option>
                  <option>EUR</option>
                  <option>GBP</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={4}>
              <Form.Group className="mb-3">
                <Form.Label>Ciclo</Form.Label>
                <Form.Select value={form.billing_cycle} onChange={e => setField('billing_cycle', e.target.value)}>
                  <option value="monthly">Mensual</option>
                  <option value="yearly">Anual</option>
                  <option value="weekly">Semanal</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          <Row>
            <Col>
              <Form.Group className="mb-3">
                <Form.Label>Próxima renovación *</Form.Label>
                <Form.Control type="date" value={form.next_billing_date}
                  onChange={e => setField('next_billing_date', e.target.value)} />
              </Form.Group>
            </Col>
            <Col xs={4}>
              <Form.Group className="mb-3">
                <Form.Label>Alerta (días antes)</Form.Label>
                <Form.Control type="number" min="0" max="30" value={form.alert_days}
                  onChange={e => setField('alert_days', parseInt(e.target.value) || 0)} />
              </Form.Group>
            </Col>
          </Row>

          <Form.Group className="mb-3">
            <Form.Label>URL del servicio</Form.Label>
            <Form.Control value={form.url} onChange={e => setField('url', e.target.value)}
              placeholder="https://…" />
          </Form.Group>

          <Form.Group>
            <Form.Label>Notas</Form.Label>
            <Form.Control as="textarea" rows={2} value={form.notes}
              onChange={e => setField('notes', e.target.value)} placeholder="Notas opcionales" />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          {editingSub && <Button variant="outline-danger" onClick={handleDelete}>Eliminar</Button>}
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
          <Button className="btn-domus" onClick={handleSave}>Guardar</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
