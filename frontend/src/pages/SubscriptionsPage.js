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
  alert_days: 3, url: '', notes: '', match_keywords: '',
};

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T12:00:00');
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

// Determina si la suscripción fue pagada en el ciclo de billing actual
function isPaidThisCycle(sub) {
  // auto-match por transacción detectada en el backend
  if (sub.auto_matched_tx) return true;

  if (!sub.last_paid_at) return false;
  const paid = new Date(sub.last_paid_at);
  paid.setHours(0, 0, 0, 0);
  const next = new Date(sub.next_billing_date);
  next.setHours(0, 0, 0, 0);

  const cycleStart = new Date(next);
  if (sub.billing_cycle === 'monthly') cycleStart.setMonth(cycleStart.getMonth() - 1);
  else if (sub.billing_cycle === 'yearly') cycleStart.setFullYear(cycleStart.getFullYear() - 1);
  else if (sub.billing_cycle === 'weekly') cycleStart.setDate(cycleStart.getDate() - 7);

  return paid >= cycleStart;
}

// Monto real pagado (manual o auto-detectado)
function paidAmount(sub) {
  if (sub.last_paid_amount) return sub.last_paid_amount;
  if (sub.auto_matched_tx) return sub.auto_matched_tx.amount;
  return null;
}

// Fecha de pago (manual o auto-detectada)
function paidDate(sub) {
  if (sub.last_paid_at) return sub.last_paid_at;
  if (sub.auto_matched_tx) return sub.auto_matched_tx.date;
  return null;
}

function AlertBadge({ sub }) {
  if (isPaidThisCycle(sub)) return <Badge bg="success" className="ms-2">Pagada</Badge>;
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
  const [filterPaid, setFilterPaid] = useState('all'); // all | paid | pending
  const [showPayModal, setShowPayModal] = useState(false);
  const [payForm, setPayForm] = useState({ amount_clp: '', paid_date: '' });
  const [payingSub, setPayingSub] = useState(null);

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
      match_keywords: sub.match_keywords || '',
    });
    setShowModal(true);
  };

  const openPayModal = (sub, e) => {
    e.stopPropagation();
    setPayingSub(sub);
    setPayForm({
      amount_clp: sub.last_paid_amount || Math.round(sub.amount),
      paid_date: new Date().toISOString().split('T')[0],
    });
    setShowPayModal(true);
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

  const handleRegisterPayment = async () => {
    if (!payForm.amount_clp) {
      toast.warn('Ingresa el monto pagado en CLP');
      return;
    }
    try {
      await apiClient.post(`/subscriptions/${payingSub.id}/pay`, {
        amount_clp: parseFloat(payForm.amount_clp),
        paid_date: payForm.paid_date,
      });
      toast.success(`Pago de ${payingSub.name} registrado`);
      setShowPayModal(false);
      fetchData();
    } catch {
      toast.error('Error registrando pago');
    }
  };

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const alerts = subscriptions.filter(s => {
    if (s.status !== 'active') return false;
    if (isPaidThisCycle(s)) return false;
    const d = daysUntil(s.next_billing_date);
    return d <= s.alert_days;
  });

  const visibleSubs = subscriptions.filter(s => {
    if (filterPaid === 'paid') return isPaidThisCycle(s);
    if (filterPaid === 'pending') return !isPaidThisCycle(s);
    return true;
  });

  // Contadores para el resumen de pagos del mes
  const paidCount = subscriptions.filter(s => s.status === 'active' && isPaidThisCycle(s)).length;
  const pendingCount = subscriptions.filter(s => s.status === 'active' && !isPaidThisCycle(s)).length;

  return (
    <div>
      <div className="domus-topbar">
        <h1 className="domus-page-title">📋 Suscripciones</h1>
        <Button className="btn-domus" onClick={openNew}>+ Nueva</Button>
      </div>

      {/* Resumen */}
      {summary && (
        <Row className="g-3 mb-4">
          <Col md={3}>
            <div className="domus-card text-center">
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>ACTIVAS</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#4f46e5' }}>
                {summary.active_count}
              </div>
            </div>
          </Col>
          <Col md={3}>
            <div className="domus-card text-center">
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>COSTE MENSUAL</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#ef4444' }}>
                ${Math.round(summary.monthly_cost).toLocaleString('es-CL')}
              </div>
            </div>
          </Col>
          <Col md={3}>
            <div className="domus-card text-center">
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>PAGADAS ESTE MES</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#10b981' }}>
                {paidCount}
              </div>
            </div>
          </Col>
          <Col md={3}>
            <div className="domus-card text-center">
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>PENDIENTES</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: pendingCount > 0 ? '#f59e0b' : '#64748b' }}>
                {pendingCount}
              </div>
            </div>
          </Col>
        </Row>
      )}

      {/* Panel de alertas */}
      {alerts.length > 0 && (
        <div className="domus-card mb-4" style={{ borderLeft: '4px solid #f59e0b' }}>
          <h6 style={{ fontWeight: 600, marginBottom: '0.75rem', color: '#92400e' }}>
            ⚠️ Próximas renovaciones sin pagar
          </h6>
          {alerts.map(sub => {
            const days = daysUntil(sub.next_billing_date);
            return (
              <div key={sub.id}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                onClick={() => openEdit(sub)}>
                <span style={{ fontWeight: 500 }}>{sub.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                    {days <= 0 ? 'Hoy' : `en ${days} día${days !== 1 ? 's' : ''}`}
                    {' — '}${Math.round(sub.amount).toLocaleString('es-CL')} {CYCLE_SUFFIX[sub.billing_cycle]}
                  </span>
                  <button type="button" onClick={e => openPayModal(sub, e)}
                    style={{ padding: '0.2rem 0.65rem', borderRadius: 12, border: '1.5px solid #10b981',
                      background: 'transparent', color: '#10b981', fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600 }}>
                    Pagar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
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
        <div style={{ width: 1, height: 24, background: '#e2e8f0', margin: '0 0.25rem' }} />
        {[['all', 'Todas'], ['paid', '✓ Pagadas'], ['pending', '⏳ Pendientes']].map(([val, label]) => (
          <button key={val} type="button"
            onClick={() => setFilterPaid(val)}
            style={{ padding: '0.35rem 0.9rem', borderRadius: 20, border: '1.5px solid',
              cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem',
              borderColor: filterPaid === val ? '#10b981' : '#e2e8f0',
              background: filterPaid === val ? '#10b981' : 'transparent',
              color: filterPaid === val ? '#fff' : '#64748b' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Lista de suscripciones */}
      <Row className="g-3">
        {visibleSubs.length === 0 && (
          <Col>
            <div className="domus-card" style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>
              No hay suscripciones. ¡Añade la primera!
            </div>
          </Col>
        )}
        {visibleSubs.map(sub => {
          const paid = isPaidThisCycle(sub);
          const days = daysUntil(sub.next_billing_date);
          const isAlert = !paid && sub.status === 'active' && days <= sub.alert_days;

          let borderColor = undefined;
          if (paid) borderColor = '#10b981';
          else if (isAlert) borderColor = '#f59e0b';

          return (
            <Col key={sub.id} md={6} lg={4}>
              <div className="domus-card" onClick={() => openEdit(sub)}
                style={{ cursor: 'pointer', borderLeft: borderColor ? `3px solid ${borderColor}` : undefined,
                  opacity: sub.status === 'cancelled' ? 0.6 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '1rem' }}>
                    {sub.name}
                    <AlertBadge sub={sub} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexShrink: 0 }}>
                    {!paid && sub.status === 'active' && (
                      <button type="button" onClick={e => openPayModal(sub, e)}
                        style={{ padding: '0.15rem 0.55rem', borderRadius: 10, border: '1.5px solid #10b981',
                          background: 'transparent', color: '#10b981', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}>
                        Pagar
                      </button>
                    )}
                    <Badge bg={STATUS_CONFIG[sub.status]?.bg || 'secondary'}>
                      {STATUS_CONFIG[sub.status]?.label || sub.status}
                    </Badge>
                  </div>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.75rem' }}>
                  {sub.category} · {CYCLE_LABELS[sub.billing_cycle]}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: '1.15rem', color: paid ? '#10b981' : '#ef4444' }}>
                      ${Math.round(paid && paidAmount(sub) ? paidAmount(sub) : sub.amount).toLocaleString('es-CL')}
                      {' '}<span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#94a3b8' }}>
                        CLP {CYCLE_SUFFIX[sub.billing_cycle]}
                      </span>
                    </span>
                    {paid && paidAmount(sub) && Math.round(paidAmount(sub)) !== Math.round(sub.amount) && (
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                        Est. ${Math.round(sub.amount).toLocaleString('es-CL')}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {paid && paidDate(sub) ? (
                      <span style={{ fontSize: '0.78rem', color: '#10b981' }}>
                        Pagada {new Date(paidDate(sub) + 'T12:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}
                        {sub.auto_matched_tx && !sub.last_paid_at && (
                          <span style={{ color: '#94a3b8' }}> · auto</span>
                        )}
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                        Renueva: {new Date(sub.next_billing_date + 'T12:00:00').toLocaleDateString('es-ES')}
                      </span>
                    )}
                  </div>
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
            <Form.Label>Palabras clave para auto-detectar pagos</Form.Label>
            <Form.Control value={form.match_keywords} onChange={e => setField('match_keywords', e.target.value)}
              placeholder="ANTHROPIC, CLAUDE (separadas por coma)" />
            <Form.Text className="text-muted">
              Si la descripción de una transacción contiene estas palabras, la app puede vincularla automáticamente.
            </Form.Text>
          </Form.Group>

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
          {editingSub && (
            <>
              <Button variant="outline-success" onClick={e => { setShowModal(false); openPayModal(editingSub, e); }}>
                Registrar pago
              </Button>
              <Button variant="outline-danger" onClick={handleDelete}>Eliminar</Button>
            </>
          )}
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
          <Button className="btn-domus" onClick={handleSave}>Guardar</Button>
        </Modal.Footer>
      </Modal>

      {/* Modal registrar pago */}
      <Modal show={showPayModal} onHide={() => setShowPayModal(false)} centered size="sm">
        <Modal.Header closeButton>
          <Modal.Title>Registrar pago — {payingSub?.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Monto real pagado (CLP) *</Form.Label>
            <Form.Control type="number" min="1" step="1"
              value={payForm.amount_clp}
              onChange={e => setPayForm(f => ({ ...f, amount_clp: e.target.value }))}
              placeholder="22220" />
          </Form.Group>
          <Form.Group>
            <Form.Label>Fecha de pago</Form.Label>
            <Form.Control type="date"
              value={payForm.paid_date}
              onChange={e => setPayForm(f => ({ ...f, paid_date: e.target.value }))} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowPayModal(false)}>Cancelar</Button>
          <Button style={{ background: '#10b981', border: 'none' }} onClick={handleRegisterPayment}>
            Confirmar pago
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
