import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Button, Modal, Form } from 'react-bootstrap';
import { toast } from 'react-toastify';
import apiClient from '../utils/apiClient';

const CREDIT_TYPES = [
  { value: 'avance',      label: 'Avance en Efectivo', color: '#f59e0b', bg: '#fef3c7' },
  { value: 'hipotecario', label: 'Hipotecario',         color: '#4f46e5', bg: '#ede9fe' },
  { value: 'consumo',     label: 'Crédito Consumo',     color: '#8b5cf6', bg: '#f5f3ff' },
  { value: 'educacion',   label: 'Crédito Educación',   color: '#10b981', bg: '#d1fae5' },
  { value: 'auto',        label: 'Crédito Auto',        color: '#06b6d4', bg: '#cffafe' },
  { value: 'otro',        label: 'Otro',                color: '#64748b', bg: '#f1f5f9' },
];

const typeInfo = (value) => CREDIT_TYPES.find(t => t.value === value) || CREDIT_TYPES[5];

const formatCLP = (n) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(n ?? 0);

const EMPTY_FORM = {
  name: '', institution: '', type: 'consumo',
  original_amount: '', current_balance: '', monthly_payment: '',
  interest_rate: '', total_installments: '', paid_installments: '0',
  start_date: '', end_date: '', notes: '',
};

export default function CreditsPage() {
  const [credits, setCredits] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showInactive, setShowInactive] = useState(false);
  const [payModal, setPayModal] = useState(null);

  const fetchCredits = useCallback(async () => {
    try {
      const res = await apiClient.get('/credits');
      setCredits(res.data);
    } catch { toast.error('Error cargando créditos'); }
  }, []);

  useEffect(() => { fetchCredits(); }, [fetchCredits]);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (credit) => {
    setEditing(credit);
    setForm({
      name: credit.name,
      institution: credit.institution,
      type: credit.type,
      original_amount: credit.original_amount,
      current_balance: credit.current_balance,
      monthly_payment: credit.monthly_payment,
      interest_rate: credit.interest_rate ?? '',
      total_installments: credit.total_installments ?? '',
      paid_installments: credit.paid_installments ?? 0,
      start_date: credit.start_date?.split('T')[0] ?? '',
      end_date: credit.end_date?.split('T')[0] ?? '',
      notes: credit.notes ?? '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.institution || !form.original_amount || !form.monthly_payment) {
      toast.warn('Nombre, institución, monto original y cuota son requeridos');
      return;
    }
    try {
      const payload = {
        ...form,
        current_balance: form.current_balance !== '' ? form.current_balance : form.original_amount,
        interest_rate: form.interest_rate !== '' ? form.interest_rate : null,
        total_installments: form.total_installments !== '' ? form.total_installments : null,
        paid_installments: form.paid_installments !== '' ? form.paid_installments : 0,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        notes: form.notes || null,
      };
      if (editing) {
        await apiClient.put(`/credits/${editing.id}`, { ...payload, active: editing.active });
        toast.success('Crédito actualizado');
      } else {
        await apiClient.post('/credits', payload);
        toast.success('Crédito agregado');
      }
      setShowModal(false);
      fetchCredits();
    } catch { toast.error('Error guardando'); }
  };

  const handleDelete = async () => {
    if (!window.confirm('¿Eliminar este crédito permanentemente?')) return;
    try {
      await apiClient.delete(`/credits/${editing.id}`);
      toast.success('Crédito eliminado');
      setShowModal(false);
      fetchCredits();
    } catch { toast.error('Error eliminando'); }
  };

  const handlePay = (credit, e) => {
    e.stopPropagation();
    setPayModal({ credit, amount: String(credit.monthly_payment) });
  };

  const confirmPay = async () => {
    const { credit, amount } = payModal;
    try {
      await apiClient.patch(`/credits/${credit.id}/pay`, { amount: parseFloat(amount) });
      toast.success('Cuota registrada');
      setPayModal(null);
      fetchCredits();
    } catch { toast.error('Error registrando cuota'); }
  };

  const setF = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const active = credits.filter(c => c.active);
  const inactive = credits.filter(c => !c.active);
  const totalMonthly = active.reduce((s, c) => s + parseFloat(c.monthly_payment), 0);
  const totalBalance = active.reduce((s, c) => s + parseFloat(c.current_balance), 0);

  const displayed = showInactive ? credits : active;

  return (
    <div>
      <div className="domus-topbar">
        <h1 className="domus-page-title">🏦 Créditos activos</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {inactive.length > 0 && (
            <Form.Check
              type="switch"
              id="show-inactive"
              label={`Ver finalizados (${inactive.length})`}
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              style={{ fontSize: '0.85rem', color: '#64748b' }}
            />
          )}
          <Button className="btn-domus" onClick={openNew}>+ Agregar</Button>
        </div>
      </div>

      {/* Resumen */}
      {active.length > 0 && (
        <Row className="g-3 mb-4">
          <Col md={4}>
            <div className="domus-card text-center">
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>COMPROMISO MENSUAL</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#ef4444' }}>{formatCLP(totalMonthly)}</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>suma de cuotas activas</div>
            </div>
          </Col>
          <Col md={4}>
            <div className="domus-card text-center">
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>SALDO TOTAL PENDIENTE</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#f59e0b' }}>{formatCLP(totalBalance)}</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>deuda total vigente</div>
            </div>
          </Col>
          <Col md={4}>
            <div className="domus-card text-center">
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>CRÉDITOS ACTIVOS</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#4f46e5' }}>{active.length}</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                {inactive.length > 0 ? `${inactive.length} finalizados` : 'todos vigentes'}
              </div>
            </div>
          </Col>
        </Row>
      )}

      {/* Tarjetas de créditos */}
      {displayed.length === 0 ? (
        <div className="domus-card" style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🏦</div>
          <p>No hay créditos registrados. Agrega tu primer crédito.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {displayed.map(credit => <CreditCard key={credit.id} credit={credit} onEdit={openEdit} onPay={handlePay} />)}
        </div>
      )}

      {/* Modal crear/editar */}
      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>{editing ? 'Editar crédito' : 'Nuevo crédito'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Row className="g-3">
            <Col md={8}>
              <Form.Group>
                <Form.Label>Nombre *</Form.Label>
                <Form.Control value={form.name} onChange={e => setF('name', e.target.value)}
                  placeholder="Ej: Súper Avance CMR, Crédito Hipotecario" />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Tipo *</Form.Label>
                <Form.Select value={form.type} onChange={e => setF('type', e.target.value)}>
                  {CREDIT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Institución *</Form.Label>
                <Form.Control value={form.institution} onChange={e => setF('institution', e.target.value)}
                  placeholder="Ej: BCI, Falabella CMR, BancoEstado" />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Tasa de interés anual (%)</Form.Label>
                <Form.Control type="number" min="0" step="0.01" value={form.interest_rate}
                  onChange={e => setF('interest_rate', e.target.value)} placeholder="Ej: 12.71" />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Monto original *</Form.Label>
                <Form.Control type="number" min="0" value={form.original_amount}
                  onChange={e => setF('original_amount', e.target.value)} placeholder="CLP" />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Saldo actual pendiente</Form.Label>
                <Form.Control type="number" min="0" value={form.current_balance}
                  onChange={e => setF('current_balance', e.target.value)}
                  placeholder={form.original_amount || 'CLP'} />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Cuota mensual *</Form.Label>
                <Form.Control type="number" min="0" value={form.monthly_payment}
                  onChange={e => setF('monthly_payment', e.target.value)} placeholder="CLP" />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Total de cuotas</Form.Label>
                <Form.Control type="number" min="1" value={form.total_installments}
                  onChange={e => setF('total_installments', e.target.value)} placeholder="Ej: 24" />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Cuotas pagadas</Form.Label>
                <Form.Control type="number" min="0" value={form.paid_installments}
                  onChange={e => setF('paid_installments', e.target.value)} />
              </Form.Group>
            </Col>
            <Col md={4}>
              {/* spacer */}
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Fecha inicio</Form.Label>
                <Form.Control type="date" value={form.start_date} onChange={e => setF('start_date', e.target.value)} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Fecha término estimada</Form.Label>
                <Form.Control type="date" value={form.end_date} onChange={e => setF('end_date', e.target.value)} />
              </Form.Group>
            </Col>
            <Col md={12}>
              <Form.Group>
                <Form.Label>Notas</Form.Label>
                <Form.Control as="textarea" rows={2} value={form.notes}
                  onChange={e => setF('notes', e.target.value)} placeholder="Información adicional..." />
              </Form.Group>
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          {editing && <Button variant="outline-danger" onClick={handleDelete}>Eliminar</Button>}
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
          <Button className="btn-domus" onClick={handleSave}>Guardar</Button>
        </Modal.Footer>
      </Modal>

      {/* Modal — registrar cuota con monto variable */}
      <Modal show={!!payModal} onHide={() => setPayModal(null)} centered size="sm">
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1rem' }}>
            ✓ Registrar cuota {payModal && parseInt(payModal.credit.paid_installments) + 1}
            {payModal?.credit.total_installments ? ` / ${payModal.credit.total_installments}` : ''}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group>
            <Form.Label style={{ fontSize: '0.88rem' }}>
              Monto pagado (CLP)
              {payModal?.credit.type === 'hipotecario' && (
                <small style={{ color: '#94a3b8', marginLeft: '0.4rem' }}>— ajusta según la UF del mes</small>
              )}
            </Form.Label>
            <Form.Control
              type="number"
              min="1"
              step="100"
              value={payModal?.amount ?? ''}
              onChange={e => setPayModal(p => p ? { ...p, amount: e.target.value } : null)}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setPayModal(null)}>Cancelar</Button>
          <Button
            className="btn-domus"
            onClick={confirmPay}
            disabled={!payModal?.amount || parseFloat(payModal.amount) <= 0}
          >
            Confirmar pago
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

function CreditCard({ credit, onEdit, onPay }) {
  const info = typeInfo(credit.type);
  const total = parseInt(credit.total_installments) || 0;
  const paid = parseInt(credit.paid_installments) || 0;
  const remaining = total > 0 ? total - paid : null;
  const progress = total > 0 ? Math.min(100, (paid / total) * 100) : null;

  // Calcular meses restantes para la fecha estimada de fin
  const endLabel = (() => {
    if (credit.end_date) {
      return new Date(credit.end_date).toLocaleDateString('es-CL', { month: 'short', year: 'numeric' });
    }
    if (remaining !== null) {
      const d = new Date();
      d.setMonth(d.getMonth() + remaining);
      return d.toLocaleDateString('es-CL', { month: 'short', year: 'numeric' });
    }
    return null;
  })();

  return (
    <div className="domus-card" style={{ opacity: credit.active ? 1 : 0.55, cursor: 'pointer' }}
      onClick={() => onEdit(credit)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.2rem' }}>
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>{credit.name}</span>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: 12,
              color: info.color, background: info.bg }}>
              {info.label}
            </span>
            {!credit.active && (
              <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 12, background: '#f1f5f9', color: '#94a3b8' }}>
                Finalizado
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.82rem', color: '#64748b' }}>{credit.institution}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#ef4444' }}>
            {formatCLP(credit.monthly_payment)}<span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 400 }}>/mes</span>
          </div>
          {credit.interest_rate && (
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {parseFloat(credit.interest_rate).toFixed(2)}% anual
            </div>
          )}
        </div>
      </div>

      {/* Barra de progreso */}
      {total > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
            <span>{paid} de {total} cuotas pagadas</span>
            <span>{progress.toFixed(0)}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: '#e2e8f0', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: progress >= 75 ? '#10b981' : progress >= 40 ? '#4f46e5' : '#f59e0b',
              borderRadius: 4, transition: 'width 0.3s' }} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Saldo pendiente</div>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{formatCLP(credit.current_balance)}</div>
          </div>
          {remaining !== null && (
            <div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cuotas restantes</div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{remaining}</div>
            </div>
          )}
          {endLabel && (
            <div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Término est.</div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{endLabel}</div>
            </div>
          )}
        </div>
        {credit.active && (
          <Button size="sm" variant="outline-primary" onClick={(e) => onPay(credit, e)}
            style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
            ✓ Registrar cuota
          </Button>
        )}
      </div>

      {credit.notes && (
        <div style={{ marginTop: '0.6rem', fontSize: '0.78rem', color: '#94a3b8', fontStyle: 'italic' }}>
          {credit.notes}
        </div>
      )}
    </div>
  );
}
