import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

const NAV_ITEMS = [
  { to: '/', icon: '🏠', label: 'Inicio', end: true },
  { to: '/calendar', icon: '📅', label: 'Calendario' },
  { to: '/menu', icon: '🍽️', label: 'Menú semanal' },
  { to: '/shopping', icon: '🛒', label: 'Lista de compra' },
  { to: '/finances', icon: '💰', label: 'Finanzas' },
  { to: '/subscriptions', icon: '📋', label: 'Suscripciones' },
  { to: '/credits', icon: '🏦', label: 'Créditos' },
  { to: '/family', icon: '👨‍👩‍👧‍👦', label: 'Familia' },
];

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="domus-layout">
      {/* Sidebar */}
      <nav className="domus-sidebar">
        <div className="logo">Domus<span>.</span></div>
        <div style={{ padding: '1rem 0', flex: 1 }}>
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `domus-nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>
        {/* User section */}
        <div className="sidebar-footer">
          <NavLink to="/profile" className={({ isActive }) => `domus-nav-item${isActive ? ' active' : ''}`}>
            <span className="nav-icon">{user?.avatar || '👤'}</span>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span style={{ fontSize: '0.85rem' }}>{user?.name}</span>
              {isAdmin && <span style={{ fontSize: '0.7rem', color: '#fbbf24' }}>Administrador</span>}
            </div>
          </NavLink>
          <button onClick={toggleTheme} className="domus-nav-item">
            <span className="nav-icon">{theme === 'light' ? '🌙' : '☀️'}</span>
            {theme === 'light' ? 'Modo oscuro' : 'Modo claro'}
          </button>
          <button onClick={handleLogout} className="domus-nav-item" style={{ color: '#f87171' }}>
            <span className="nav-icon">🚪</span>
            Cerrar sesión
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="domus-main">
        <Outlet />
      </main>
    </div>
  );
}