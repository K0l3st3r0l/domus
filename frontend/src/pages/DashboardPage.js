import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Row, Col } from 'react-bootstrap';
import apiClient from '../utils/apiClient';
import { useAuth } from '../context/AuthContext';

export default function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [events, setEvents] = useState([]);
  const [menuToday, setMenuToday] = useState([]);
  const [shoppingLists, setShoppingLists] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

    Promise.all([
      apiClient.get(`/finances/summary?month=${now.getMonth() + 1}&year=${now.getFullYear()}`),
      apiClient.get(`/calendar?start=${now.toISOString()}&end=${monthEnd}`),
      apiClient.get('/shopping'),
    ]).then(([fin, cal, shop]) => {
      setSummary(fin.data);
      setEvents(cal.data.slice(0, 5));
      setShoppingLists(shop.data.slice(0, 3));
    }).finally(() => setLoading(false));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';

  if (loading) return <div className="text-center py-5" style={{ color: '#64748b' }}>Cargando...</div>;

  return (
    <div>
      <div className="domus-topbar">
        <div>
          <h1 className="domus-page-title">{greeting}, {user?.name?.split(' ')[0]} {user?.avatar}</h1>
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.9rem' }}>
            {new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Stats */}
      <Row className="g-3 mb-4">
        <Col md={3}>
          <div className="domus-stat-card">
            <div className="domus-stat-icon" style={{ background: '#d1fae5' }}>💰</div>
            <div>
              <div className="domus-stat-value text-income">{summary ? `${summary.income.toFixed(0)} CLP` : '—'}</div>
              <div className="domus-stat-label">Ingresos del mes</div>
            </div>
          </div>
        </Col>
        <Col md={3}>
          <div className="domus-stat-card">
            <div className="domus-stat-icon" style={{ background: '#fee2e2' }}>📉</div>
            <div>
              <div className="domus-stat-value text-expense">{summary ? `${summary.expenses.toFixed(0)} CLP` : '—'}</div>
              <div className="domus-stat-label">Gastos del mes</div>
            </div>
          </div>
        </Col>
        <Col md={3}>
          <div className="domus-stat-card">
            <div className="domus-stat-icon" style={{ background: '#ede9fe' }}>⚖️</div>
            <div>
              <div className="domus-stat-value" style={{ color: summary?.balance >= 0 ? '#10b981' : '#ef4444' }}>
                {summary ? `${summary.balance.toFixed(0)} CLP` : '—'}
              </div>
              <div className="domus-stat-label">Balance</div>
            </div>
          </div>
        </Col>
        <Col md={3}>
          <div className="domus-stat-card">
            <div className="domus-stat-icon" style={{ background: '#fef3c7' }}>📅</div>
            <div>
              <div className="domus-stat-value">{events.length}</div>
              <div className="domus-stat-label">Eventos próximos</div>
            </div>
          </div>
        </Col>
      </Row>

      <Row className="g-3">
        {/* Próximos eventos */}
        <Col md={6}>
          <div className="domus-card h-100">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 style={{ fontWeight: 600, margin: 0 }}>📅 Próximos eventos</h5>
              <Link to="/calendar" style={{ fontSize: '0.85rem', color: '#4f46e5' }}>Ver todos</Link>
            </div>
            {events.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No hay eventos próximos.</p>
            ) : (
              events.map(ev => (
                <div key={ev.id} style={{ padding: '0.6rem 0', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: ev.color, flexShrink: 0, display: 'inline-block' }} />
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{ev.title}</div>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                      {new Date(ev.start_time).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Col>

        {/* Listas de compra */}
        <Col md={6}>
          <div className="domus-card h-100">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 style={{ fontWeight: 600, margin: 0 }}>🛒 Listas de compra</h5>
              <Link to="/shopping" style={{ fontSize: '0.85rem', color: '#4f46e5' }}>Ver todas</Link>
            </div>
            {shoppingLists.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No hay listas activas.</p>
            ) : (
              shoppingLists.map(list => (
                <div key={list.id} style={{ padding: '0.6rem 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{list.name}</span>
                    <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      {list.checked_items}/{list.total_items} items
                    </span>
                  </div>
                  <div style={{ marginTop: '0.3rem', background: '#f1f5f9', borderRadius: 4, height: 4 }}>
                    <div style={{
                      width: list.total_items > 0 ? `${(list.checked_items / list.total_items) * 100}%` : '0%',
                      background: '#4f46e5', height: '100%', borderRadius: 4, transition: 'width 0.3s'
                    }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </Col>
      </Row>

      {/* Quick links */}
      <Row className="g-3 mt-2">
        {[
          { to: '/calendar', icon: '📅', label: 'Añadir evento', bg: '#ede9fe' },
          { to: '/menu', icon: '🍽️', label: 'Planificar menú', bg: '#fef3c7' },
          { to: '/shopping', icon: '🛒', label: 'Nueva lista', bg: '#dcfce7' },
          { to: '/finances', icon: '💶', label: 'Añadir gasto', bg: '#fee2e2' },
        ].map(item => (
          <Col key={item.to} md={3}>
            <Link to={item.to} style={{ textDecoration: 'none' }}>
              <div className="domus-card text-center" style={{ cursor: 'pointer', transition: 'transform 0.15s' }}
                   onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                   onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{item.icon}</div>
                <div style={{ fontWeight: 500, fontSize: '0.9rem', color: '#1e293b' }}>{item.label}</div>
              </div>
            </Link>
          </Col>
        ))}
      </Row>
    </div>
  );
}
