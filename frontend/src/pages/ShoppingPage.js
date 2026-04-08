import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Button, Modal, Form, Badge } from 'react-bootstrap';
import { toast } from 'react-toastify';
import apiClient from '../utils/apiClient';

const CATEGORIES = ['Frutas y verduras','Carnes y pescados','Lácteos','Panadería','Conservas','Bebidas','Limpieza','Higiene','Congelados','General'];

export default function ShoppingPage() {
  const [lists, setLists] = useState([]);
  const [activeList, setActiveList] = useState(null);
  const [items, setItems] = useState([]);
  const [showNewList, setShowNewList] = useState(false);
  const [showNewItem, setShowNewItem] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newItem, setNewItem] = useState({ name: '', quantity: 1, unit: '', category: 'General' });

  const fetchLists = useCallback(async () => {
    try {
      const res = await apiClient.get('/shopping');
      setLists(res.data);
      if (res.data.length > 0 && !activeList) setActiveList(res.data[0]);
    } catch { toast.error('Error cargando listas'); }
  }, [activeList]);

  const fetchItems = useCallback(async () => {
    if (!activeList) return;
    try {
      const res = await apiClient.get(`/shopping/${activeList.id}/items`);
      setItems(res.data);
    } catch { toast.error('Error cargando items'); }
  }, [activeList]);

  useEffect(() => { fetchLists(); }, []);
  useEffect(() => { fetchItems(); }, [fetchItems]);

  const createList = async () => {
    if (!newListName) return;
    try {
      const res = await apiClient.post('/shopping', { name: newListName });
      setNewListName('');
      setShowNewList(false);
      fetchLists();
      setActiveList(res.data);
      toast.success('Lista creada');
    } catch { toast.error('Error creando lista'); }
  };

  const addItem = async () => {
    if (!newItem.name) { toast.warn('Escribe el nombre del producto'); return; }
    try {
      await apiClient.post(`/shopping/${activeList.id}/items`, newItem);
      setNewItem({ name: '', quantity: 1, unit: '', category: 'General' });
      setShowNewItem(false);
      fetchItems();
      fetchLists();
    } catch { toast.error('Error añadiendo item'); }
  };

  const toggleItem = async (item) => {
    try {
      await apiClient.patch(`/shopping/${activeList.id}/items/${item.id}/toggle`);
      fetchItems();
      fetchLists();
    } catch { toast.error('Error'); }
  };

  const deleteItem = async (item) => {
    try {
      await apiClient.delete(`/shopping/${activeList.id}/items/${item.id}`);
      fetchItems();
      fetchLists();
    } catch { toast.error('Error eliminando'); }
  };

  const deleteList = async (list) => {
    if (!window.confirm(`¿Eliminar la lista "${list.name}"?`)) return;
    try {
      await apiClient.delete(`/shopping/${list.id}`);
      setActiveList(null);
      fetchLists();
      toast.success('Lista eliminada');
    } catch { toast.error('Error eliminando lista'); }
  };

  // Agrupar items por categoría
  const grouped = items.reduce((acc, item) => {
    const cat = item.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const checkedCount = items.filter(i => i.checked).length;

  return (
    <div>
      <div className="domus-topbar">
        <h1 className="domus-page-title">🛒 Lista de la compra</h1>
        <Button className="btn-domus" onClick={() => setShowNewList(true)}>+ Nueva lista</Button>
      </div>

      <Row className="g-3">
        {/* Lista de listas */}
        <Col md={4}>
          <div className="domus-card">
            <h6 style={{ fontWeight: 600, marginBottom: '1rem', color: '#64748b' }}>MIS LISTAS</h6>
            {lists.length === 0 && <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Sin listas aún.</p>}
            {lists.map(list => (
              <div key={list.id}
                onClick={() => setActiveList(list)}
                style={{ padding: '0.75rem', borderRadius: 8, marginBottom: '0.5rem', cursor: 'pointer',
                  background: activeList?.id === list.id ? '#ede9fe' : '#f8fafc',
                  border: activeList?.id === list.id ? '1.5px solid #4f46e5' : '1.5px solid transparent' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{list.name}</span>
                  <Badge bg="secondary" style={{ fontSize: '0.7rem' }}>{list.total_items} items</Badge>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                  {list.checked_items} de {list.total_items} comprados
                </div>
                {parseInt(list.total_items) > 0 && (
                  <div style={{ background: '#e2e8f0', borderRadius: 4, height: 3, marginTop: '0.4rem' }}>
                    <div style={{ width: `${(list.checked_items / list.total_items) * 100}%`, background: '#4f46e5', height: '100%', borderRadius: 4 }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Col>

        {/* Items de la lista activa */}
        <Col md={8}>
          {!activeList ? (
            <div className="domus-card text-center" style={{ color: '#94a3b8', padding: '3rem' }}>
              Selecciona o crea una lista
            </div>
          ) : (
            <div className="domus-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <h5 style={{ fontWeight: 600, margin: 0 }}>{activeList.name}</h5>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{checkedCount}/{items.length} completados</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button variant="outline-danger" size="sm" onClick={() => deleteList(activeList)}>Eliminar lista</Button>
                  <Button className="btn-domus" size="sm" onClick={() => setShowNewItem(true)}>+ Añadir</Button>
                </div>
              </div>

              {items.length === 0 && <p style={{ color: '#94a3b8', textAlign: 'center', padding: '2rem 0' }}>Lista vacía. ¡Añade productos!</p>}

              {Object.entries(grouped).map(([cat, catItems]) => (
                <div key={cat} style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>{cat}</div>
                  {catItems.map(item => (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0',
                      borderBottom: '1px solid #f1f5f9', opacity: item.checked ? 0.5 : 1 }}>
                      <input type="checkbox" checked={item.checked} onChange={() => toggleItem(item)}
                        style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#4f46e5' }} />
                      <span style={{ flex: 1, textDecoration: item.checked ? 'line-through' : 'none', fontSize: '0.9rem' }}>
                        {item.name}
                        {item.quantity > 1 && <span style={{ color: '#94a3b8', marginLeft: '0.4rem', fontSize: '0.8rem' }}>× {item.quantity}{item.unit ? ` ${item.unit}` : ''}</span>}
                      </span>
                      <button onClick={() => deleteItem(item)} style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: '1rem', padding: '0 0.25rem' }}>✕</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Col>
      </Row>

      {/* Modal nueva lista */}
      <Modal show={showNewList} onHide={() => setShowNewList(false)} centered size="sm">
        <Modal.Header closeButton><Modal.Title>Nueva lista</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Control autoFocus placeholder="Ej: Compra del sábado" value={newListName}
            onChange={e => setNewListName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createList()} />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowNewList(false)}>Cancelar</Button>
          <Button className="btn-domus" onClick={createList}>Crear</Button>
        </Modal.Footer>
      </Modal>

      {/* Modal nuevo item */}
      <Modal show={showNewItem} onHide={() => setShowNewItem(false)} centered>
        <Modal.Header closeButton><Modal.Title>Añadir producto</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Producto *</Form.Label>
            <Form.Control autoFocus value={newItem.name} onChange={e => setNewItem(i => ({ ...i, name: e.target.value }))} placeholder="Ej: Leche" />
          </Form.Group>
          <Row>
            <Col>
              <Form.Group className="mb-3">
                <Form.Label>Cantidad</Form.Label>
                <Form.Control type="number" min="0.1" step="0.1" value={newItem.quantity} onChange={e => setNewItem(i => ({ ...i, quantity: e.target.value }))} />
              </Form.Group>
            </Col>
            <Col>
              <Form.Group className="mb-3">
                <Form.Label>Unidad</Form.Label>
                <Form.Control value={newItem.unit} onChange={e => setNewItem(i => ({ ...i, unit: e.target.value }))} placeholder="kg, L, uds..." />
              </Form.Group>
            </Col>
          </Row>
          <Form.Group>
            <Form.Label>Categoría</Form.Label>
            <Form.Select value={newItem.category} onChange={e => setNewItem(i => ({ ...i, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </Form.Select>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowNewItem(false)}>Cancelar</Button>
          <Button className="btn-domus" onClick={addItem}>Añadir</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
