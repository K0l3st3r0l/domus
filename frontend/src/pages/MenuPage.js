import React, { useEffect, useState, useCallback } from 'react';
import { Button, Modal, Form } from 'react-bootstrap';
import { toast } from 'react-toastify';
import moment from 'moment';
import 'moment/locale/es';
import apiClient from '../utils/apiClient';

moment.locale('es');

const DAYS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const MEALS = [
  { key: 'desayuno', label: '🌅 Desayuno' },
  { key: 'almuerzo', label: '☀️ Almuerzo' },
  { key: 'merienda', label: '🍎 Merienda' },
  { key: 'cena', label: '🌙 Cena' },
];

function getWeekStart(offset = 0) {
  return moment().startOf('isoWeek').add(offset, 'weeks');
}

export default function MenuPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [menuData, setMenuData] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ dish_name: '', notes: '' });

  const weekStart = getWeekStart(weekOffset);
  const weekStartStr = weekStart.format('YYYY-MM-DD');

  const fetchMenu = useCallback(async () => {
    try {
      const res = await apiClient.get(`/menu?week_start=${weekStartStr}`);
      const map = {};
      res.data.forEach(item => {
        const key = `${item.day_of_week}-${item.meal_type}`;
        map[key] = item;
      });
      setMenuData(map);
    } catch { toast.error('Error cargando el menú'); }
  }, [weekStartStr]);

  useEffect(() => { fetchMenu(); }, [fetchMenu]);

  const openEdit = (dayIdx, meal) => {
    const key = `${dayIdx}-${meal.key}`;
    const existing = menuData[key];
    setEditing({ dayIdx, meal, key, existingId: existing?.id });
    setForm({ dish_name: existing?.dish_name || '', notes: existing?.notes || '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.dish_name) { toast.warn('Escribe el nombre del plato'); return; }
    try {
      await apiClient.post('/menu', {
        week_start: weekStartStr,
        day_of_week: editing.dayIdx,
        meal_type: editing.meal.key,
        dish_name: form.dish_name,
        notes: form.notes,
      });
      toast.success('Plato guardado');
      setShowModal(false);
      fetchMenu();
    } catch { toast.error('Error guardando'); }
  };

  const handleDelete = async () => {
    if (!editing.existingId) return;
    try {
      await apiClient.delete(`/menu/${editing.existingId}`);
      toast.success('Plato eliminado');
      setShowModal(false);
      fetchMenu();
    } catch { toast.error('Error eliminando'); }
  };

  const handleGenerateShopping = async () => {
    try {
      await apiClient.post(`/menu/${weekStartStr}/generate-shopping`);
      toast.success('Lista de compra generada desde el menú');
    } catch { toast.error('Error generando lista'); }
  };

  return (
    <div>
      <div className="domus-topbar">
        <div>
          <h1 className="domus-page-title">🍽️ Menú semanal</h1>
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.875rem' }}>
            Semana del {weekStart.format('D [de] MMMM')} al {weekStart.clone().add(6, 'days').format('D [de] MMMM YYYY')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant="outline-secondary" size="sm" onClick={() => setWeekOffset(o => o - 1)}>‹ Anterior</Button>
          <Button variant="outline-secondary" size="sm" onClick={() => setWeekOffset(0)}>Hoy</Button>
          <Button variant="outline-secondary" size="sm" onClick={() => setWeekOffset(o => o + 1)}>Siguiente ›</Button>
          <Button className="btn-domus" size="sm" onClick={handleGenerateShopping}>🛒 Generar lista</Button>
        </div>
      </div>

      <div className="domus-card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ padding: '0.75rem', width: 110, color: '#64748b', fontWeight: 600, fontSize: '0.8rem' }}>Comida</th>
              {DAYS.map((day, i) => {
                const date = weekStart.clone().add(i, 'days');
                const isToday = date.isSame(moment(), 'day');
                return (
                  <th key={day} style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, fontSize: '0.85rem',
                    color: isToday ? '#4f46e5' : '#1e293b', background: isToday ? '#ede9fe' : 'transparent', borderRadius: 6 }}>
                    <div>{day}</div>
                    <div style={{ fontWeight: 400, fontSize: '0.75rem', color: '#94a3b8' }}>{date.format('D MMM')}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {MEALS.map(meal => (
              <tr key={meal.key}>
                <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500, fontSize: '0.82rem', color: '#475569', borderTop: '1px solid #f1f5f9' }}>
                  {meal.label}
                </td>
                {DAYS.map((_, dayIdx) => {
                  const item = menuData[`${dayIdx}-${meal.key}`];
                  return (
                    <td key={dayIdx} onClick={() => openEdit(dayIdx, meal)}
                      style={{ padding: '0.4rem', borderTop: '1px solid #f1f5f9', textAlign: 'center', cursor: 'pointer',
                        verticalAlign: 'middle', minWidth: 100 }}>
                      {item ? (
                        <div style={{ background: '#ede9fe', borderRadius: 6, padding: '0.3rem 0.5rem',
                          fontSize: '0.8rem', color: '#3730a3', fontWeight: 500 }}>
                          {item.dish_name}
                        </div>
                      ) : (
                        <div style={{ border: '1.5px dashed #cbd5e1', borderRadius: 6, padding: '0.3rem',
                          color: '#cbd5e1', fontSize: '0.75rem' }}>+ Añadir</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {editing?.meal?.label} — {editing !== null ? DAYS[editing.dayIdx] : ''}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Plato *</Form.Label>
            <Form.Control value={form.dish_name} onChange={e => setForm(f => ({ ...f, dish_name: e.target.value }))} placeholder="Ej: Pasta carbonara" autoFocus />
          </Form.Group>
          <Form.Group>
            <Form.Label>Notas</Form.Label>
            <Form.Control as="textarea" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Ingredientes, variantes..." />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          {editing?.existingId && <Button variant="outline-danger" onClick={handleDelete}>Eliminar</Button>}
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
          <Button className="btn-domus" onClick={handleSave}>Guardar</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
