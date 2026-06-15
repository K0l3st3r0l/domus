import React, { useEffect, useState, useCallback } from 'react';
import { Button, Badge, Spinner, ProgressBar, Form } from 'react-bootstrap';
import { toast } from 'react-toastify';
import apiClient from '../utils/apiClient';

const TYPE_OPTIONS = [
  { value: 'evaluacion', label: '📋 Evaluación', desc: 'Prueba, control, disertación — hay que estudiar', bg: 'danger' },
  { value: 'tarea',      label: '📝 Tarea',       desc: 'Entrega, investigación, traer materiales',      bg: 'success' },
  { value: 'reunion',    label: '🗓️ Reunión',     desc: 'Asistencia presencial de apoderados',           bg: 'warning' },
  { value: 'aviso',      label: '📢 Aviso',        desc: 'Información, felicitaciones, comunicados',      bg: 'secondary' },
  { value: 'otro',       label: '⚪ Otro',          desc: 'No encaja en ninguna categoría',               bg: 'dark' },
];

const TYPE_MAP = Object.fromEntries(TYPE_OPTIONS.map(t => [t.value, t]));

const CHILD_COLORS = {
  Anais: 'primary',
  Gabriel: 'success',
};

export default function TrainingPage() {
  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState({ total: 0, reviewed: 0 });
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [selectedType, setSelectedType] = useState(null);
  const [observation, setObservation] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/school-sync/training/queue');
      setQueue(res.data.queue);
      setStats(res.data.stats);
      setIndex(0);
    } catch {
      toast.error('Error cargando cola de entrenamiento');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const current = queue[index];

  function resetActions() {
    setCorrecting(false);
    setSelectedType(null);
    setObservation('');
  }

  async function save(feedback, correctedType) {
    setSaving(true);
    try {
      await apiClient.patch(`/school-sync/emails/${current.gmail_id}/feedback`, {
        feedback,
        correctedType: correctedType || null,
        observation: observation.trim() || null,
      });
      setStats(s => ({ ...s, reviewed: Number(s.reviewed) + 1 }));
      setQueue(q => q.filter((_, i) => i !== index));
      setIndex(i => Math.min(i, queue.length - 2));
      resetActions();
    } catch {
      toast.error('Error guardando. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  function skip() {
    resetActions();
    setIndex(i => (i + 1) % queue.length);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spinner animation="border" />
      </div>
    );
  }

  const total = Number(stats.total);
  const reviewed = Number(stats.reviewed);
  const progress = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '1.5rem 1rem' }}>

      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{ margin: 0, fontWeight: 700 }}>Entrenamiento IA</h4>
        <div style={{ color: 'var(--domus-muted)', fontSize: '0.85rem', marginBottom: '0.6rem' }}>
          {reviewed} de {total} correos revisados — {queue.length} pendientes
        </div>
        <ProgressBar now={progress} label={`${progress}%`} style={{ height: 8, borderRadius: 4 }} />
      </div>

      {queue.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '3rem 1rem',
          background: 'var(--domus-card)', borderRadius: 12,
          color: 'var(--domus-muted)'
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎉</div>
          <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.3rem' }}>
            Sin pendientes por revisar
          </div>
          <div style={{ fontSize: '0.85rem' }}>
            La IA usará los {reviewed} ejemplos que revisaste para clasificar mejor los próximos correos.
          </div>
        </div>
      ) : (
        <>
          {/* Contador */}
          <div style={{ textAlign: 'right', color: 'var(--domus-muted)', fontSize: '0.82rem', marginBottom: '0.6rem' }}>
            {index + 1} de {queue.length} pendientes
          </div>

          {/* Card del email actual */}
          <div style={{
            background: 'var(--domus-card)',
            borderRadius: 12,
            padding: '1.2rem',
            marginBottom: '1rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}>
            {/* Meta */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
              <Badge bg={CHILD_COLORS[current.child_name] || 'secondary'}>{current.child_name}</Badge>
              <span style={{ fontSize: '0.8rem', color: 'var(--domus-muted)' }}>
                {current.date ? new Date(current.date).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--domus-muted)', marginLeft: 'auto' }}>
                {current.from_address?.replace(/<.*>/, '').trim()}
              </span>
            </div>

            {/* Asunto */}
            <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.8rem', lineHeight: 1.3 }}>
              {current.subject || '(sin asunto)'}
            </div>

            {/* Resumen IA */}
            {current.ai_summary && (
              <div style={{
                background: 'rgba(139,92,246,0.12)',
                border: '1px solid rgba(139,92,246,0.25)',
                borderRadius: 8,
                padding: '0.75rem',
                marginBottom: '0.7rem',
              }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#a78bfa', marginBottom: '0.3rem' }}>
                  🤖 Resumen IA
                </div>
                <div style={{ fontSize: '0.88rem', color: 'var(--domus-text)' }}>{current.ai_summary}</div>
                {current.extracted_date && (
                  <div style={{ marginTop: '0.4rem', color: '#f59e0b', fontSize: '0.8rem', fontWeight: 500 }}>
                    📅 {new Date(current.extracted_date).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' })}
                  </div>
                )}
              </div>
            )}

            {/* Tipo detectado */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--domus-muted)' }}>
              Tipo detectado:
              {current.ai_type && TYPE_MAP[current.ai_type] ? (
                <Badge bg={TYPE_MAP[current.ai_type].bg} text={current.ai_type === 'reunion' ? 'dark' : undefined}>
                  {TYPE_MAP[current.ai_type].label}
                </Badge>
              ) : (
                <Badge bg="dark">{current.ai_type || 'sin clasificar'}</Badge>
              )}
            </div>
          </div>

          {/* Acciones */}
          <div style={{
            background: 'var(--domus-card)',
            borderRadius: 12,
            padding: '1.2rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}>
            <div style={{ fontWeight: 600, marginBottom: '0.8rem', fontSize: '0.9rem' }}>
              ¿La clasificación es correcta?
            </div>

            {!correcting ? (
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
                <Button
                  variant="success"
                  style={{ flex: 1, minWidth: 160 }}
                  disabled={saving}
                  onClick={() => save('approved', null)}
                >
                  {saving ? <Spinner size="sm" /> : `✅ Confirmar "${TYPE_MAP[current.ai_type]?.label || current.ai_type}"`}
                </Button>
                <Button
                  variant="outline-warning"
                  style={{ flex: 1, minWidth: 120 }}
                  disabled={saving}
                  onClick={() => { setCorrecting(true); setSelectedType(current.ai_type); }}
                >
                  ✏️ Corregir tipo
                </Button>
              </div>
            ) : (
              <div style={{ marginBottom: '0.8rem' }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--domus-muted)', marginBottom: '0.5rem' }}>
                  Selecciona el tipo correcto:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.8rem' }}>
                  {TYPE_OPTIONS.map(t => (
                    <button
                      key={t.value}
                      onClick={() => setSelectedType(t.value)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.6rem',
                        padding: '0.6rem 0.8rem',
                        borderRadius: 8,
                        border: selectedType === t.value ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.1)',
                        background: selectedType === t.value ? 'rgba(99,102,241,0.15)' : 'transparent',
                        color: 'var(--domus-text)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        width: '100%',
                      }}
                    >
                      <span style={{ fontSize: '1rem' }}>{t.label}</span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--domus-muted)' }}>{t.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Observación */}
            <Form.Group style={{ marginBottom: '0.8rem' }}>
              <Form.Label style={{ fontSize: '0.82rem', color: 'var(--domus-muted)', marginBottom: '0.3rem' }}>
                Observación para la IA (opcional)
              </Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="Ej: Este tipo de correo con 'junto con saludar' es siempre un aviso, no una reunión"
                value={observation}
                onChange={e => setObservation(e.target.value)}
                style={{ fontSize: '0.85rem', resize: 'vertical' }}
              />
            </Form.Group>

            {/* Botones finales */}
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={skip}
                disabled={saving || queue.length <= 1}
              >
                Saltar →
              </Button>
              {correcting && (
                <Button
                  variant="primary"
                  disabled={saving || !selectedType}
                  style={{ marginLeft: 'auto' }}
                  onClick={() => save('corrected', selectedType)}
                >
                  {saving ? <Spinner size="sm" /> : 'Guardar corrección →'}
                </Button>
              )}
              {!correcting && observation.trim() && (
                <Button
                  variant="outline-info"
                  size="sm"
                  disabled={saving}
                  style={{ marginLeft: 'auto' }}
                  onClick={() => save('approved', null)}
                >
                  {saving ? <Spinner size="sm" /> : '✅ Confirmar + guardar observación'}
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
