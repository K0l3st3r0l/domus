import React, { useState, useEffect } from 'react';
import { Container, Card, Form, Button, Alert, Spinner } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient';

export default function SetupPage() {
  const [status, setStatus] = useState('loading'); // loading | open | done
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    apiClient.get('/auth/setup/status')
      .then(res => setStatus(res.data.setupRequired ? 'open' : 'done'))
      .catch(() => setStatus('done'));
  }, []);

  const handleChange = e => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiClient.post('/auth/setup', {
        name: form.name,
        email: form.email,
        password: form.password,
      });
      setSuccess(res.data.message);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear el usuario');
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100">
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  if (status === 'done') {
    return (
      <Container className="d-flex justify-content-center align-items-center vh-100">
        <Card className="p-4 shadow" style={{ maxWidth: 420, width: '100%' }}>
          <div className="text-center mb-3">
            <span style={{ fontSize: 48 }}>🔒</span>
            <h4 className="mt-2">Setup deshabilitado</h4>
            <p className="text-muted">Ya existe un administrador. Esta página está bloqueada.</p>
            <Button variant="primary" onClick={() => navigate('/login')}>Ir al login</Button>
          </div>
        </Card>
      </Container>
    );
  }

  return (
    <Container className="d-flex justify-content-center align-items-center vh-100">
      <Card className="p-4 shadow" style={{ maxWidth: 440, width: '100%' }}>
        <div className="text-center mb-4">
          <span style={{ fontSize: 48 }}>🏠</span>
          <h3 className="mt-2">Domus — Configuración inicial</h3>
          <p className="text-muted">Crea el usuario administrador de la familia</p>
        </div>

        {error && <Alert variant="danger">{error}</Alert>}
        {success && <Alert variant="success">{success} Redirigiendo al login...</Alert>}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label>Nombre</Form.Label>
            <Form.Control
              name="name"
              placeholder="Tu nombre"
              value={form.name}
              onChange={handleChange}
              required
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Email</Form.Label>
            <Form.Control
              type="email"
              name="email"
              placeholder="admin@ejemplo.com"
              value={form.email}
              onChange={handleChange}
              required
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Contraseña</Form.Label>
            <Form.Control
              type="password"
              name="password"
              placeholder="Mínimo 8 caracteres"
              value={form.password}
              onChange={handleChange}
              required
            />
          </Form.Group>
          <Form.Group className="mb-4">
            <Form.Label>Confirmar contraseña</Form.Label>
            <Form.Control
              type="password"
              name="confirm"
              placeholder="Repite la contraseña"
              value={form.confirm}
              onChange={handleChange}
              required
            />
          </Form.Group>
          <Button type="submit" variant="primary" className="w-100" disabled={submitting}>
            {submitting ? <Spinner size="sm" animation="border" /> : 'Crear administrador'}
          </Button>
        </Form>
      </Card>
    </Container>
  );
}
