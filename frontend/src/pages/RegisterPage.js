import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import apiClient from '../utils/apiClient';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [form, setForm] = useState({ name: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      toast.error('Las contraseñas no coinciden');
      return;
    }
    if (!token) {
      toast.error('Enlace de invitación inválido');
      return;
    }
    setLoading(true);
    try {
      await apiClient.post('/auth/register', { token, name: form.name, password: form.password });
      toast.success('¡Cuenta creada! Ya puedes iniciar sesión.');
      navigate('/login');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al crear la cuenta');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="domus-login-page">
      <div className="domus-login-card">
        <div className="domus-login-logo">Domus<span>.</span></div>
        <p style={{ textAlign: 'center', color: '#64748b', marginBottom: '2rem', fontSize: '0.9rem' }}>
          Crea tu cuenta familiar
        </p>
        {!token && (
          <div className="alert alert-danger" style={{ borderRadius: '10px' }}>
            Enlace de invitación inválido. Solicita uno nuevo al administrador.
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label" style={{ fontWeight: 500 }}>Tu nombre</label>
            <input
              type="text"
              className="form-control"
              style={{ borderRadius: '8px' }}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
              placeholder="Ej: María"
            />
          </div>
          <div className="mb-3">
            <label className="form-label" style={{ fontWeight: 500 }}>Contraseña</label>
            <input
              type="password"
              className="form-control"
              style={{ borderRadius: '8px' }}
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required
              minLength={6}
              placeholder="Mínimo 6 caracteres"
            />
          </div>
          <div className="mb-4">
            <label className="form-label" style={{ fontWeight: 500 }}>Confirmar contraseña</label>
            <input
              type="password"
              className="form-control"
              style={{ borderRadius: '8px' }}
              value={form.confirm}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
              required
              placeholder="Repite la contraseña"
            />
          </div>
          <button type="submit" className="btn btn-domus w-100" disabled={loading || !token} style={{ padding: '0.65rem' }}>
            {loading ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>
        </form>
      </div>
    </div>
  );
}
