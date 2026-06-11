import React, { useEffect, useState } from 'react';
import { Row, Col, Button, Modal, Form } from 'react-bootstrap';
import { toast } from 'react-toastify';
import apiClient from '../utils/apiClient';
import { useAuth } from '../context/AuthContext';

const AVATARS = ['👤','👩','👨','👧','👦','👴','👵','🧑','👶','🐶','🐱','🦊','🦁','🐻','🌟','👑','🎭','🦸'];

export default function FamilyPage() {
  const { isAdmin, user } = useAuth();
  const [members, setMembers] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState({ email: '', role: 'member' });
  const [inviteLink, setInviteLink] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  const fetchMembers = async () => {
    try {
      const res = await apiClient.get('/users');
      setMembers(res.data);
    } catch { toast.error('Error cargando miembros'); }
  };

  useEffect(() => { fetchMembers(); }, []);

  const handleInvite = async () => {
    if (!invite.email) { toast.warn('Email requerido'); return; }
    try {
      const res = await apiClient.post('/auth/invite', invite);
      setInviteLink(res.data.inviteUrl);
      toast.success('Invitación creada');
    } catch { toast.error('Error creando invitación'); }
  };

  const toggleMember = async (member) => {
    try {
      await apiClient.patch(`/users/${member.id}/toggle`);
      fetchMembers();
      toast.success(`${member.name} ${member.active ? 'desactivado' : 'activado'}`);
    } catch { toast.error('Error'); }
  };

  const openResetPassword = (member) => {
    setResetTarget(member);
    setNewPassword('');
    setShowReset(true);
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      toast.warn('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    try {
      await apiClient.post(`/users/${resetTarget.id}/reset-password`, { newPassword });
      toast.success(`Contraseña de ${resetTarget.name} actualizada`);
      setShowReset(false);
      setNewPassword('');
      setResetTarget(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al cambiar la contraseña');
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(inviteLink);
    toast.success('Enlace copiado al portapapeles');
  };

  return (
    <div>
      <div className="domus-topbar">
        <h1 className="domus-page-title">👨‍👩‍👧‍👦 Familia</h1>
        {isAdmin && <Button className="btn-domus" onClick={() => { setShowInvite(true); setInviteLink(''); }}>+ Invitar miembro</Button>}
      </div>

      <Row className="g-3">
        {members.map(member => (
          <Col key={member.id} md={4} sm={6}>
            <div className="domus-card text-center" style={{ opacity: member.active ? 1 : 0.5 }}>
              <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>{member.avatar || '👤'}</div>
              <h5 style={{ fontWeight: 600, margin: '0 0 0.25rem' }}>{member.name}</h5>
              <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '0.5rem' }}>{member.email}</div>
              <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 500,
                background: member.role === 'admin' ? '#ede9fe' : '#f1f5f9',
                color: member.role === 'admin' ? '#4f46e5' : '#64748b' }}>
                {member.role === 'admin' ? '⚙️ Admin' : '👤 Miembro'}
              </span>
              {isAdmin && (
                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {member.id !== user?.id && (
                    <Button size="sm" variant="outline-primary" onClick={() => openResetPassword(member)}>
                      🔑 Contraseña
                    </Button>
                  )}
                  <Button size="sm" variant={member.active ? 'outline-danger' : 'outline-success'} onClick={() => toggleMember(member)}>
                    {member.active ? 'Desactivar' : 'Activar'}
                  </Button>
                </div>
              )}
            </div>
          </Col>
        ))}
      </Row>

      <Modal show={showInvite} onHide={() => setShowInvite(false)} centered>
        <Modal.Header closeButton><Modal.Title>Invitar miembro familiar</Modal.Title></Modal.Header>
        <Modal.Body>
          {!inviteLink ? (
            <>
              <Form.Group className="mb-3">
                <Form.Label>Email del miembro</Form.Label>
                <Form.Control type="email" value={invite.email} onChange={e => setInvite(i => ({ ...i, email: e.target.value }))} placeholder="familiar@email.com" autoFocus />
              </Form.Group>
              <Form.Group>
                <Form.Label>Rol</Form.Label>
                <Form.Select value={invite.role} onChange={e => setInvite(i => ({ ...i, role: e.target.value }))}>
                  <option value="member">Miembro</option>
                  <option value="admin">Administrador</option>
                </Form.Select>
              </Form.Group>
            </>
          ) : (
            <div>
              <p style={{ color: '#10b981', fontWeight: 500 }}>✅ Invitación creada.</p>
              <p style={{ fontSize: '0.875rem', color: '#64748b' }}>Comparte este enlace con tu familiar (válido 7 días):</p>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.75rem', wordBreak: 'break-all', fontSize: '0.82rem', fontFamily: 'monospace' }}>
                {inviteLink}
              </div>
              <Button className="btn-domus w-100 mt-3" onClick={copyLink}>📋 Copiar enlace</Button>
            </div>
          )}
        </Modal.Body>
        {!inviteLink && (
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowInvite(false)}>Cancelar</Button>
            <Button className="btn-domus" onClick={handleInvite}>Generar invitación</Button>
          </Modal.Footer>
        )}
      </Modal>

      <Modal show={showReset} onHide={() => setShowReset(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>🔑 Cambiar contraseña</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {resetTarget && (
            <>
              <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '1rem' }}>
                Estás cambiando la contraseña de <strong>{resetTarget.name}</strong> ({resetTarget.email}).
                Comparte la nueva contraseña con el miembro por un canal seguro.
              </p>
              <Form.Group className="mb-3">
                <Form.Label>Nueva contraseña</Form.Label>
                <Form.Control
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleResetPassword(); }}
                />
              </Form.Group>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowReset(false)}>Cancelar</Button>
          <Button className="btn-domus" onClick={handleResetPassword}>Guardar contraseña</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
