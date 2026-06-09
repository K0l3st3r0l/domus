import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Row, Col, Button } from 'react-bootstrap';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'react-toastify';
import apiClient from '../utils/apiClient';
import FinancesPage from './FinancesPage';
import SubscriptionsPage from './SubscriptionsPage';
import CreditsPage from './CreditsPage';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const PIE_COLORS = ['#4f46e5','#10b981','#f59e0b','#ef4444','#06b6d4','#8b5cf6','#f97316','#ec4899','#14b8a6','#84cc16'];

const formatCLP = (n) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(n ?? 0);

const TABS = [
  { key: 'gastos',        label: 'Gastos' },
  { key: 'suscripciones', label: 'Suscripciones' },
  { key: 'creditos',      label: 'Créditos' },
  { key: 'dashboard',     label: 'Dashboard IA' },
];

function ScoreRing({ score }) {
  const color = score >= 7 ? '#10b981' : score >= 4 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        border: `5px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.4rem', fontWeight: 800, color,
      }}>
        {score}
      </div>
      <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 4 }}>/ 10</div>
    </div>
  );
}

function AIDashboard() {
  const today = new Date();
  const [month, setMonth]           = useState(today.getMonth() + 1);
  const [year, setYear]             = useState(today.getFullYear());
  const [summary, setSummary]       = useState(null);
  const [analysis, setAnalysis]     = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [analyzing, setAnalyzing]   = useState(false);

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    setAnalysis(null);
    try {
      const res = await apiClient.get(`/finances/dashboard-summary?month=${month}&year=${year}`);
      setSummary(res.data);
    } catch {
      toast.error('Error cargando resumen financiero');
    } finally {
      setLoadingSummary(false);
    }
  }, [month, year]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await apiClient.post('/finances/ai-analyze', { month, year });
      setAnalysis(res.data);
    } catch {
      toast.error('Error en análisis IA');
    } finally {
      setAnalyzing(false);
    }
  };

  const card = {
    background: 'var(--domus-card-bg)',
    border: '1px solid var(--domus-border)',
    borderRadius: 12,
    padding: '1.25rem',
  };

  const totalCommitments = summary
    ? summary.subscriptions.monthlyEquivalent + summary.credits.monthlyCommitment
    : 0;

  return (
    <div>
      {/* Header */}
      <div className="domus-topbar">
        <div>
          <h1 className="domus-page-title">Dashboard IA</h1>
          <div style={{ fontSize: '0.8rem', color: 'var(--domus-muted)', marginTop: 2 }}>
            Análisis financiero consolidado · DeepSeek V4 Pro
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className="form-select form-select-sm"
            style={{ width: 130 }}
          >
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="form-select form-select-sm"
            style={{ width: 90 }}
          >
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <Button
            className="btn-domus"
            size="sm"
            onClick={handleAnalyze}
            disabled={analyzing || loadingSummary || !summary}
          >
            {analyzing ? 'Analizando...' : '🤖 Analizar con IA'}
          </Button>
        </div>
      </div>

      {loadingSummary ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--domus-muted)' }}>
          Cargando datos...
        </div>
      ) : summary ? (
        <>
          {/* Summary cards */}
          <Row className="g-3 mb-4">
            <Col xs={6} sm={4} lg>
              <div style={{ ...card, borderTop: '3px solid #10b981' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--domus-muted)', marginBottom: 4 }}>Ingresos</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#10b981' }}>{formatCLP(summary.finances.income)}</div>
              </div>
            </Col>
            <Col xs={6} sm={4} lg>
              <div style={{ ...card, borderTop: '3px solid #ef4444' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--domus-muted)', marginBottom: 4 }}>Gastos</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#ef4444' }}>{formatCLP(summary.finances.expenses)}</div>
              </div>
            </Col>
            <Col xs={6} sm={4} lg>
              <div style={{ ...card, borderTop: '3px solid #8b5cf6' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--domus-muted)', marginBottom: 4 }}>Suscripciones</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#8b5cf6' }}>{formatCLP(summary.subscriptions.monthlyEquivalent)}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--domus-muted)' }}>{summary.subscriptions.active} activas</div>
              </div>
            </Col>
            <Col xs={6} sm={4} lg>
              <div style={{ ...card, borderTop: '3px solid #f59e0b' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--domus-muted)', marginBottom: 4 }}>Cuotas créditos</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#f59e0b' }}>{formatCLP(summary.credits.monthlyCommitment)}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--domus-muted)' }}>Saldo: {formatCLP(summary.credits.totalBalance)}</div>
              </div>
            </Col>
            <Col xs={12} sm={4} lg>
              <div style={{ ...card, borderTop: `3px solid ${summary.realBalance >= 0 ? '#4f46e5' : '#ef4444'}` }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--domus-muted)', marginBottom: 4 }}>Balance real</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: summary.realBalance >= 0 ? '#4f46e5' : '#ef4444' }}>
                  {formatCLP(summary.realBalance)}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--domus-muted)' }}>tras compromisos fijos</div>
              </div>
            </Col>
          </Row>

          {/* Charts row */}
          <Row className="g-3 mb-4">
            {summary.finances.expenseByCategory.length > 0 && (
              <Col lg={5}>
                <div style={card}>
                  <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.85rem' }}>Gastos por categoría</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={summary.finances.expenseByCategory.map(c => ({ name: c.category, value: c.total }))}
                        cx="50%" cy="50%"
                        outerRadius={75}
                        dataKey="value"
                        label={({ name, percent }) => percent > 0.05 ? `${name} ${Math.round(percent * 100)}%` : ''}
                        labelLine={false}
                        fontSize={10}
                      >
                        {summary.finances.expenseByCategory.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={v => formatCLP(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Col>
            )}
            <Col lg={summary.finances.expenseByCategory.length > 0 ? 7 : 12}>
              <div style={card}>
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: '0.85rem' }}>Distribución del ingreso</div>
                {[
                  { label: 'Gastos variables', amount: summary.finances.expenses, color: '#ef4444' },
                  { label: 'Suscripciones',    amount: summary.subscriptions.monthlyEquivalent, color: '#8b5cf6' },
                  { label: 'Cuotas créditos',  amount: summary.credits.monthlyCommitment, color: '#f59e0b' },
                ].map(item => {
                  const base = summary.finances.income || 1;
                  const pct = Math.min(100, Math.round(item.amount / base * 100));
                  return (
                    <div key={item.label} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                        <span>{item.label}</span>
                        <span style={{ color: item.color }}>
                          {formatCLP(item.amount)}{summary.finances.income > 0 ? ` (${pct}%)` : ''}
                        </span>
                      </div>
                      <div style={{ height: 8, background: 'var(--domus-border)', borderRadius: 4 }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: item.color, borderRadius: 4, transition: 'width 0.4s' }} />
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--domus-border)', fontSize: '0.8rem', color: 'var(--domus-muted)' }}>
                  Total compromisos fijos: <strong style={{ color: 'var(--domus-text)' }}>{formatCLP(totalCommitments)}</strong>
                  {summary.finances.income > 0 && (
                    <span> ({Math.round(totalCommitments / summary.finances.income * 100)}% del ingreso)</span>
                  )}
                </div>
              </div>
            </Col>
          </Row>
        </>
      ) : null}

      {/* AI Analysis placeholder / result */}
      {!analysis && !analyzing && (
        <div style={{ ...card, textAlign: 'center', padding: '2.5rem', color: 'var(--domus-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🤖</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Análisis IA disponible</div>
          <div style={{ fontSize: '0.85rem' }}>
            Presiona "Analizar con IA" para obtener hallazgos, recomendaciones y alertas personalizadas
          </div>
        </div>
      )}

      {analyzing && (
        <div style={{ ...card, textAlign: 'center', padding: '2.5rem', color: 'var(--domus-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>⏳</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Analizando tus finanzas...</div>
          <div style={{ fontSize: '0.85rem' }}>DeepSeek V4 Pro está procesando. Puede tomar unos segundos.</div>
        </div>
      )}

      {analysis && (
        <div style={card}>
          {/* Header with score */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>
                Análisis IA — {MONTHS[month - 1]} {year}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--domus-muted)', marginTop: 2 }}>
                Generado {new Date(analysis.generatedAt).toLocaleString('es-CL')}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <ScoreRing score={analysis.puntuacion} />
              <Button variant="outline-secondary" size="sm" onClick={handleAnalyze} disabled={analyzing}>
                Regenerar
              </Button>
            </div>
          </div>

          {/* Resumen */}
          <div style={{
            background: 'rgba(79,70,229,0.08)',
            border: '1px solid rgba(79,70,229,0.2)',
            borderRadius: 8,
            padding: '0.875rem 1rem',
            marginBottom: 20,
            fontSize: '0.9rem',
            lineHeight: 1.6,
          }}>
            {analysis.resumen}
          </div>

          <Row className="g-3">
            <Col md={4}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: '0.85rem', color: '#4f46e5' }}>
                Hallazgos
              </div>
              <ul style={{ paddingLeft: 18, margin: 0, fontSize: '0.85rem' }}>
                {(analysis.hallazgos || []).map((h, i) => (
                  <li key={i} style={{ marginBottom: 8, lineHeight: 1.5 }}>{h}</li>
                ))}
              </ul>
            </Col>

            <Col md={4}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: '0.85rem', color: '#10b981' }}>
                Recomendaciones
              </div>
              <ul style={{ paddingLeft: 18, margin: 0, fontSize: '0.85rem' }}>
                {(analysis.recomendaciones || []).map((r, i) => (
                  <li key={i} style={{ marginBottom: 8, lineHeight: 1.5 }}>{r}</li>
                ))}
              </ul>
            </Col>

            <Col md={4}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: '0.85rem', color: '#ef4444' }}>
                Alertas
              </div>
              {(analysis.alertas || []).length === 0 ? (
                <div style={{ fontSize: '0.85rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: 6 }}>
                  ✅ Sin alertas. Vas bien.
                </div>
              ) : (
                <ul style={{ paddingLeft: 18, margin: 0, fontSize: '0.85rem' }}>
                  {(analysis.alertas || []).map((a, i) => (
                    <li key={i} style={{ marginBottom: 8, lineHeight: 1.5, color: '#f87171' }}>{a}</li>
                  ))}
                </ul>
              )}
            </Col>
          </Row>
        </div>
      )}
    </div>
  );
}

export default function FinanceHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'gastos';

  const setTab = (key) => setSearchParams({ tab: key }, { replace: true });

  return (
    <div>
      {/* Tab nav */}
      <div style={{
        display: 'flex',
        gap: 2,
        borderBottom: '2px solid var(--domus-border)',
        marginBottom: 0,
      }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '0.625rem 1.25rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === t.key ? '2px solid #4f46e5' : '2px solid transparent',
              marginBottom: -2,
              color: activeTab === t.key ? '#4f46e5' : 'var(--domus-muted)',
              fontWeight: activeTab === t.key ? 600 : 400,
              cursor: 'pointer',
              fontSize: '0.875rem',
              transition: 'color 0.15s, border-color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ paddingTop: '0.25rem' }}>
        {activeTab === 'gastos'        && <FinancesPage />}
        {activeTab === 'suscripciones' && <SubscriptionsPage />}
        {activeTab === 'creditos'      && <CreditsPage />}
        {activeTab === 'dashboard'     && <AIDashboard />}
      </div>
    </div>
  );
}
