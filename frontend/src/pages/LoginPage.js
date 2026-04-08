import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="domus-login-page">
      <div className="domus-login-card">
        <div className="domus-login-logo">Domus<span>.</span></div>
        <p style={{ textAlign: 'center', color: '#64748b', marginBottom: '2rem', fontSize: '0.9rem' }}>
          Gestión del hogar familiar
        </p>
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label fw-500" style={{ fontWeight: 500 }}>Email</label>
            <input
              type="email"
              className="form-control"
              style={{ borderRadius: '8px', padding: '0.6rem 0.875rem' }}
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              required
              autoFocus
              placeholder="tu@email.com"
            />
          </div>
          <div className="mb-4">
            <label className="form-label" style={{ fontWeight: 500 }}>Contraseña</label>
            <input
              type="password"
              className="form-control"
              style={{ borderRadius: '8px', padding: '0.6rem 0.875rem' }}
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            className="btn btn-domus w-100"
            disabled={loading}
            style={{ padding: '0.65rem', fontSize: '1rem' }}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem', color: '#94a3b8' }}>
          ¿Primera vez? Usa el enlace de invitación que te enviaron.
        </p>
      </div>
    </div>
  );
}
