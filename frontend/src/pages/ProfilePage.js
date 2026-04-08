import React, { useState } from 'react';
import { Row, Col, Button, Form } from 'react-bootstrap';
import { toast } from 'react-toastify';
import apiClient from '../utils/apiClient';
import { useAuth } from '../context/AuthContext';

const AVATARS = ['👤','👩','👨','👧','👦','👴','👵','🧑','👶','🌟','👑','🎭','🦸','🐶','🐱','🦊','🦁','🐻'];

export default function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState({ name: user?.name || '', avatar: user?.avatar || '👤' });
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

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
    } catch (err) { toast.error(err.response?.data?.error || 'Error cambiando contraseña'); }
    finally { setSavingPwd(false); }
  };

  return (
    <div>
      <div className="domus-topbar">
        <h1 className="domus-page-title">👤 Mi perfil</h1>
      </div>

      <Row className="g-4">
        <Col md={6}>
          <div className="domus-card">
            <h5 style={{ fontWeight: 600, marginBottom: '1.5rem' }}>Datos personales</h5>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '4rem' }}>{profile.avatar}</div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.3rem' }}>Elige un avatar</div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', marginBottom: '1.5rem' }}>
              {AVATARS.map(a => (
                <button key={a} onClick={() => setProfile(p => ({ ...p, avatar: a }))}
                  style={{ fontSize: '1.5rem', width: 42, height: 42, borderRadius: 8, cursor: 'pointer', border: '2px solid',
                    borderColor: profile.avatar === a ? '#4f46e5' : '#e2e8f0',
                    background: profile.avatar === a ? '#ede9fe' : '#fff' }}>
                  {a}
                </button>
              ))}
            </div>
            <Form.Group className="mb-3">
              <Form.Label>Nombre</Form.Label>
              <Form.Control value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control value={user?.email || ''} disabled />
            </Form.Group>
            <Form.Group className="mb-4">
              <Form.Label>Rol</Form.Label>
              <Form.Control value={user?.role === 'admin' ? 'Administrador' : 'Miembro'} disabled />
            </Form.Group>
            <Button className="btn-domus w-100" onClick={handleSaveProfile} disabled={savingProfile}>
              {savingProfile ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        </Col>

        <Col md={6}>
          <div className="domus-card">
            <h5 style={{ fontWeight: 600, marginBottom: '1.5rem' }}>Cambiar contraseña</h5>
            <Form.Group className="mb-3">
              <Form.Label>Contraseña actual</Form.Label>
              <Form.Control type="password" value={passwords.current} onChange={e => setPasswords(p => ({ ...p, current: e.target.value }))} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Nueva contraseña</Form.Label>
              <Form.Control type="password" value={passwords.new} onChange={e => setPasswords(p => ({ ...p, new: e.target.value }))} placeholder="Mínimo 6 caracteres" />
            </Form.Group>
            <Form.Group className="mb-4">
              <Form.Label>Confirmar nueva contraseña</Form.Label>
              <Form.Control type="password" value={passwords.confirm} onChange={e => setPasswords(p => ({ ...p, confirm: e.target.value }))} />
            </Form.Group>
            <Button className="btn-domus w-100" onClick={handleChangePassword} disabled={savingPwd}>
              {savingPwd ? 'Actualizando...' : 'Cambiar contraseña'}
            </Button>
          </div>
        </Col>
      </Row>
    </div>
  );
}
