import React, { useState, useEffect } from 'react';
import { Row, Col, Button, Form } from 'react-bootstrap';
import { toast } from 'react-toastify';
import apiClient from '../utils/apiClient';
import { useAuth } from '../context/AuthContext';

const AVATARS = ['👤','👩','👨','👧','👦','👴','👵','🧑','👶','🌟','👑','🎭','🦸','🐶','🐱','🦊','🦁','🐻'];

const NAV_ITEMS = [
  { to: '/calendar', icon: '📅', label: 'Calendario' },
  { to: '/menu', icon: '🍽️', label: 'Menú semanal' },
  { to: '/shopping', icon: '🛒', label: 'Lista de compra' },
  { to: '/finances', icon: '💰', label: 'Finanzas' },
  { to: '/subscriptions', icon: '📋', label: 'Suscripciones' },
  { to: '/credits', icon: '🏦', label: 'Créditos' },
  { to: '/school-sync', icon: '🎓', label: 'School Sync' },
  { to: '/school-schedule', icon: '📚', label: 'Horario' },
  { to: '/family', icon: '👨‍👩‍👧‍👦', label: 'Familia' },
];

export default function ProfilePage() {
  const { user, isAdmin } = useAuth();
  const [profile, setProfile] = useState({ name: user?.name || '', avatar: user?.avatar || '👤' });
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [showPwdForm, setShowPwdForm] = useState(false);
  const [disabledNav, setDisabledNav] = useState([]);
  const [savingPerms, setSavingPerms] = useState(false);

  useEffect(() => {
    const loadPermissions = async () => {
      try {
        const res = await apiClient.get('/users/nav-permissions');
        setDisabledNav(res.data.disabled);
      } catch (err) {
        console.error('Error cargando permisos:', err);
      }
    };
    if (isAdmin) loadPermissions();
  }, [isAdmin]);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      await apiClient.put('/users/me', profile);
      toast.success('Perfil actualizado');
    } catch { toast.error('Error actualizando perfil'); }
    finally { setSavingProfile(false); }
  };

  const handleChangePassword = async () => {
    if (passwords.new !== passwords.confirm) { toast.error('Las contraseñas no coinciden'); return; }
    if (passwords.new.length < 6) { toast.warn('Mínimo 6 caracteres'); return; }
    setSavingPwd(true);
    try {
      await apiClient.post('/auth/change-password', { currentPassword: passwords.current, newPassword: passwords.new });
      toast.success('Contraseña actualizada');
      setPasswords({ current: '', new: '', confirm: '' });
      setShowPwdForm(false);
    } catch (err) { toast.error(err.response?.data?.error || 'Error cambiando contraseña'); }
    finally { setSavingPwd(false); }
  };

  const toggleNavItem = (route) => {
    setDisabledNav(prev =>
      prev.includes(route) ? prev.filter(r => r !== route) : [...prev, route]
    );
  };

  const handleSavePermissions = async () => {
    setSavingPerms(true);
    try {
      await apiClient.put('/users/nav-permissions', { disabled: disabledNav });
      toast.success('Permisos de la familia actualizados');
    } catch { toast.error('Error actualizando permisos'); }
    finally { setSavingPerms(false); }
  };

  return (
    <div>
      <div className="domus-topbar">
        <h1 className="domus-page-title">👤 Mi perfil</h1>
      </div>

      <Row className="g-4">
        {/* Datos personales */}
        <Col md={8}>
          <div className="domus-card">
            <h5 style={{ fontWeight: 600, marginBottom: '1.25rem', color: 'var(--domus-text)' }}>Datos personales</h5>
            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
              {/* Avatar + picker */}
              <div style={{ flexShrink: 0, textAlign: 'center' }}>
                <div style={{ fontSize: '3.5rem', lineHeight: 1, marginBottom: '0.5rem' }}>{profile.avatar}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--domus-muted)', marginBottom: '0.6rem' }}>Avatar</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', width: '172px', justifyContent: 'center' }}>
                  {AVATARS.map(a => (
                    <button key={a} onClick={() => setProfile(p => ({ ...p, avatar: a }))}
                      style={{
                        fontSize: '1.1rem', width: 32, height: 32, borderRadius: 6, cursor: 'pointer',
                        border: `2px solid ${profile.avatar === a ? 'var(--domus-primary)' : 'var(--domus-border)'}`,
                        background: profile.avatar === a ? 'rgba(79,70,229,0.12)' : 'var(--domus-input-bg)',
                        transition: 'border-color 0.15s',
                      }}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* Campos */}
              <div style={{ flex: 1 }}>
                <Form.Group className="mb-3">
                  <Form.Label style={{ fontWeight: 500, fontSize: '0.875rem' }}>Nombre</Form.Label>
                  <Form.Control value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label style={{ fontWeight: 500, fontSize: '0.875rem' }}>Email</Form.Label>
                  <Form.Control value={user?.email || ''} disabled />
                </Form.Group>
                <Form.Group className="mb-4">
                  <Form.Label style={{ fontWeight: 500, fontSize: '0.875rem' }}>Rol</Form.Label>
                  <Form.Control value={user?.role === 'admin' ? 'Administrador' : 'Miembro'} disabled />
                </Form.Group>
                <Button className="btn-domus w-100" onClick={handleSaveProfile} disabled={savingProfile}>
                  {savingProfile ? 'Guardando...' : 'Guardar cambios'}
                </Button>
              </div>
            </div>
          </div>
        </Col>

        {/* Seguridad */}
        <Col md={4}>
          <div className="domus-card" style={{ height: '100%' }}>
            <div
              onClick={() => setShowPwdForm(p => !p)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
            >
              <h5 style={{ fontWeight: 600, margin: 0, color: 'var(--domus-text)' }}>🔒 Contraseña</h5>
              <span style={{
                fontSize: '0.8rem', fontWeight: 500, padding: '0.25rem 0.75rem',
                borderRadius: '20px', border: '1px solid var(--domus-primary)',
                color: 'var(--domus-primary)', transition: 'all 0.15s',
              }}>
                {showPwdForm ? 'Cancelar' : 'Cambiar'}
              </span>
            </div>

            {!showPwdForm && (
              <p style={{ color: 'var(--domus-muted)', fontSize: '0.8rem', marginTop: '0.75rem', marginBottom: 0 }}>
                Tu contraseña está protegida. Haz clic en "Cambiar" para actualizarla.
              </p>
            )}

            {showPwdForm && (
              <div style={{ marginTop: '1.25rem' }}>
                <Form.Group className="mb-3">
                  <Form.Label style={{ fontWeight: 500, fontSize: '0.875rem' }}>Contraseña actual</Form.Label>
                  <Form.Control type="password" value={passwords.current}
                    onChange={e => setPasswords(p => ({ ...p, current: e.target.value }))} />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label style={{ fontWeight: 500, fontSize: '0.875rem' }}>Nueva contraseña</Form.Label>
                  <Form.Control type="password" value={passwords.new}
                    onChange={e => setPasswords(p => ({ ...p, new: e.target.value }))}
                    placeholder="Mínimo 6 caracteres" />
                </Form.Group>
                <Form.Group className="mb-4">
                  <Form.Label style={{ fontWeight: 500, fontSize: '0.875rem' }}>Confirmar contraseña</Form.Label>
                  <Form.Control type="password" value={passwords.confirm}
                    onChange={e => setPasswords(p => ({ ...p, confirm: e.target.value }))} />
                </Form.Group>
                <Button className="btn-domus w-100" onClick={handleChangePassword} disabled={savingPwd}>
                  {savingPwd ? 'Actualizando...' : 'Confirmar cambio'}
                </Button>
              </div>
            )}
          </div>
        </Col>
      </Row>

      {/* Permisos de la familia (solo admin) */}
      {isAdmin && (
        <Row className="g-4" style={{ marginTop: '0.5rem' }}>
          <Col md={12}>
            <div className="domus-card">
              <h5 style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--domus-text)' }}>👨‍👩‍👧‍👦 Permisos de la familia</h5>
              <p style={{ color: 'var(--domus-muted)', marginBottom: '1.25rem', fontSize: '0.875rem' }}>
                Selecciona qué secciones puede ver tu familia en el menú
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.65rem', marginBottom: '1.25rem' }}>
                {NAV_ITEMS.map(item => {
                  const enabled = !disabledNav.includes(item.to);
                  return (
                    <div
                      key={item.to}
                      onClick={() => toggleNavItem(item.to)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.8rem 1rem', borderRadius: '8px',
                        backgroundColor: 'var(--domus-card-bg)',
                        border: `1px solid ${enabled ? 'var(--domus-primary)' : 'var(--domus-border)'}`,
                        borderLeft: `4px solid ${enabled ? 'var(--domus-primary)' : 'var(--domus-border)'}`,
                        cursor: 'pointer', transition: 'border-color 0.15s ease',
                        opacity: enabled ? 1 : 0.5,
                      }}
                    >
                      <input
                        type="checkbox" id={`nav-${item.to}`} checked={enabled}
                        onChange={() => toggleNavItem(item.to)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: '#4f46e5', flexShrink: 0 }}
                      />
                      <label htmlFor={`nav-${item.to}`} style={{
                        flex: 1, cursor: 'pointer', margin: 0, display: 'flex', alignItems: 'center',
                        gap: '0.5rem', color: 'var(--domus-text)', fontWeight: 500, fontSize: '0.875rem',
                      }}>
                        <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>{item.icon}</span>
                        {item.label}
                      </label>
                    </div>
                  );
                })}
              </div>
              <Button className="btn-domus" onClick={handleSavePermissions} disabled={savingPerms}>
                {savingPerms ? 'Guardando...' : 'Guardar permisos'}
              </Button>
            </div>
          </Col>
        </Row>
      )}
    </div>
  );
}
