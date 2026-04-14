import React, { useEffect, useState, useCallback } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import apiClient from '../utils/apiClient';

const KNOWN_CHILDREN = [
  { email: 'anais_rehbein.ojeda@cicpm.cl', name: 'Anais', color: '#3b82f6' },
  { email: 'gabriel_parra.ojeda@cicpm.cl', name: 'Gabriel', color: '#22c55e' },
];

const DAY_NAMES       = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const DAY_NAMES_SHORT = ['Lu',    'Ma',     'Mi',        'Ju',     'Vi'];

const SUBJECT_COLORS = {
  matematica:    '#e74c3c',
  lenguaje:      '#2980b9',
  historia:      '#8e44ad',
  ciencias:      '#27ae60',
  ingles:        '#d68910',
  'ed fisica':   '#16a085',
  'educacion fi':'#16a085',
  religion:      '#c0392b',
  artes:         '#e67e22',
  tecnologia:    '#5d6d7e',
  fisica:        '#1a5276',
  biologia:      '#1e8449',
  quimica:       '#6c3483',
  musica:        '#a04000',
  orientacion:   '#6d4c41',
  taller:        '#00796b',
  paes:          '#4527a0',
  intermat:      '#b71c1c',
};

function normalizeSubject(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSubjectColor(subject) {
  const norm = normalizeSubject(subject);
  for (const [key, color] of Object.entries(SUBJECT_COLORS)) {
    if (norm.includes(key)) return color;
  }
  return '#546e7a';
}

function toMinutes(timeStr) {
  if (!timeStr) return -1;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

export default function SchoolSchedulePage() {
  const [schedules, setSchedules]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [activeChild, setActiveChild] = useState(KNOWN_CHILDREN[0].email);
  const [now, setNow]               = useState(new Date());

  // Tick every minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/school-sync/schedules');
      setSchedules(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const jsDay          = now.getDay();                       // 0=Dom
  const todayIdx       = jsDay === 0 ? -1 : jsDay - 1;      // 0=Lun, -1 if weekend
  const nowMins        = now.getHours() * 60 + now.getMinutes();

  const childSchedule  = schedules.filter(s => s.child_email === activeChild);
  const maxPeriod      = childSchedule.reduce((m, s) => Math.max(m, Number(s.period_order)), 0);
  const childInfo      = KNOWN_CHILDREN.find(c => c.email === activeChild);

  function isCurrentSlot(slot) {
    if (!slot) return false;
    if (Number(slot.day_of_week) !== todayIdx) return false;
    if (!slot.start_time || !slot.end_time) return false;
    return nowMins >= toMinutes(slot.start_time.substring(0, 5)) &&
           nowMins <  toMinutes(slot.end_time.substring(0, 5));
  }

  // Find what's happening right now for the banner
  const currentSlot = childSchedule.find(s => isCurrentSlot(s));

  // ── Next subject for today ──────────────────────────────────────────────────
  const nextSlot = todayIdx >= 0
    ? childSchedule
        .filter(s => Number(s.day_of_week) === todayIdx && s.start_time &&
                     toMinutes(s.start_time.substring(0, 5)) > nowMins)
        .sort((a, b) => a.period_order - b.period_order)[0]
    : null;

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>

      {/* pulse animation */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.4); }
        }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>📚 Horario Escolar</h2>
          <p style={{ color: 'var(--domus-muted)', margin: '0.2rem 0 0', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {now.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {KNOWN_CHILDREN.map(c => (
            <Button
              key={c.email}
              size="sm"
              onClick={() => setActiveChild(c.email)}
              style={{
                background: activeChild === c.email ? c.color : 'transparent',
                borderColor: c.color,
                color: activeChild === c.email ? '#fff' : c.color,
                fontWeight: 600,
                minWidth: 80,
              }}
            >
              {c.name}
            </Button>
          ))}
        </div>
      </div>

      {/* ── Now / Next banner ──────────────────────────────────────────────── */}
      {todayIdx >= 0 && childSchedule.length > 0 && (currentSlot || nextSlot) && (
        <div style={{
          display: 'flex',
          gap: '1rem',
          marginBottom: '1.25rem',
          flexWrap: 'wrap',
        }}>
          {currentSlot && (
            <div style={{
              flex: 1,
              minWidth: 200,
              background: getSubjectColor(currentSlot.subject),
              borderRadius: 12,
              padding: '0.9rem 1.2rem',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}>
              <span style={{
                width: 10, height: 10,
                borderRadius: '50%',
                backgroundColor: '#fff',
                flexShrink: 0,
                animation: 'pulse-dot 1.5s ease-in-out infinite',
                display: 'inline-block',
              }} />
              <div>
                <div style={{ fontSize: '0.72rem', opacity: 0.85, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ahora</div>
                <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{currentSlot.subject}</div>
                {currentSlot.end_time && (
                  <div style={{ fontSize: '0.78rem', opacity: 0.85 }}>
                    Termina a las {currentSlot.end_time.substring(0, 5)}
                  </div>
                )}
              </div>
            </div>
          )}
          {nextSlot && (
            <div style={{
              flex: 1,
              minWidth: 200,
              background: 'var(--domus-card-bg)',
              border: `2px solid ${getSubjectColor(nextSlot.subject)}`,
              borderRadius: 12,
              padding: '0.9rem 1.2rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}>
              <span style={{ fontSize: '1.4rem' }}>⏭</span>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--domus-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Próxima clase
                </div>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: getSubjectColor(nextSlot.subject) }}>
                  {nextSlot.subject}
                </div>
                {nextSlot.start_time && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--domus-muted)' }}>
                    A las {nextSlot.start_time.substring(0, 5)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Schedule grid ──────────────────────────────────────────────────── */}
      {childSchedule.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '4rem 2rem',
          background: 'var(--domus-card-bg)',
          borderRadius: 16,
          border: '2px dashed var(--domus-border)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</div>
          <p style={{ color: 'var(--domus-muted)', marginBottom: '0.5rem' }}>
            No hay horario cargado para <strong>{childInfo?.name}</strong>.
          </p>
          <p style={{ color: 'var(--domus-muted)', fontSize: '0.85rem' }}>
            Cárgalo desde <strong>School Sync → 📅 Horarios</strong>.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <DesktopGrid
            childSchedule={childSchedule}
            maxPeriod={maxPeriod}
            todayIdx={todayIdx}
            isCurrentSlot={isCurrentSlot}
          />
        </div>
      )}
    </div>
  );
}

function DesktopGrid({ childSchedule, maxPeriod, todayIdx, isCurrentSlot }) {
  // Detectar si el martes (1) tiene un horario diferido comparando con lunes
  const lunBlocks = childSchedule.filter(s => Number(s.day_of_week) === 0);
  const marBlocks = childSchedule.filter(s => Number(s.day_of_week) === 1);
  const hasDifferentTuesday = lunBlocks.length > 0 && marBlocks.length > 0 &&
    (lunBlocks.length !== marBlocks.length ||
     lunBlocks.some(l => {
       const m = marBlocks.find(mb => Number(mb.period_order) === Number(l.period_order));
       return !m || m.start_time !== l.start_time;
     }));

  return (
    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '4px' }}>
      <thead>
        <tr>
          <th style={{
            width: 72,
            padding: '0.6rem 0.4rem',
            textAlign: 'center',
            color: 'var(--domus-muted)',
            fontSize: '0.75rem',
            fontWeight: 600,
          }}>
            Hora
          </th>
          {DAY_NAMES.map((day, i) => {
            const isToday = i === todayIdx;
            const isDiffTuesday = i === 1 && hasDifferentTuesday;
            return (
              <th key={i} style={{
                padding: '0.75rem 0.5rem',
                textAlign: 'center',
                borderRadius: 10,
                backgroundColor: isToday ? 'var(--domus-primary)' : isDiffTuesday ? 'rgba(168,85,247,0.12)' : 'var(--domus-card-bg)',
                color: isToday ? '#fff' : 'var(--domus-text)',
                fontWeight: 700,
                fontSize: '0.88rem',
                border: isDiffTuesday ? '2px solid #a855f7' : isToday ? 'none' : '1px solid var(--domus-border)',
              }}>
                <span className="d-none d-sm-inline">{day}</span>
                <span className="d-inline d-sm-none">{DAY_NAMES_SHORT[i]}</span>
                {isToday && (
                  <div style={{ fontSize: '0.62rem', fontWeight: 400, opacity: 0.85, marginTop: '0.1rem' }}>
                    hoy
                  </div>
                )}
                {isDiffTuesday && (
                  <div style={{ fontSize: '0.62rem', fontWeight: 500, color: '#a855f7', marginTop: '0.1rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    Diferido
                  </div>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: maxPeriod }, (_, idx) => {
          const period = idx + 1;
          const slots  = [0,1,2,3,4].map(dayIdx =>
            childSchedule.find(s =>
              Number(s.day_of_week) === dayIdx && Number(s.period_order) === period
            )
          );
          const sample    = slots.find(Boolean);
          const startTime = sample?.start_time?.substring(0, 5) || '';
          const endTime   = sample?.end_time?.substring(0, 5)   || '';
          const rowActive = slots.some(s => isCurrentSlot(s));

          return (
            <tr key={period}>
              {/* Time column */}
              <td style={{
                padding: '0.35rem',
                textAlign: 'center',
                verticalAlign: 'middle',
                fontSize: '0.72rem',
                lineHeight: 1.4,
                color: rowActive ? 'var(--domus-primary)' : 'var(--domus-muted)',
                fontWeight: rowActive ? 700 : 400,
              }}>
                <div>{period}</div>
                {startTime && <div>{startTime}</div>}
                {endTime   && <div style={{ opacity: 0.7 }}>{endTime}</div>}
              </td>

              {/* Subject cells */}
              {slots.map((slot, dayIdx) => {
                const active = isCurrentSlot(slot);
                const color  = slot ? getSubjectColor(slot.subject) : null;
                const startTime = slot?.start_time?.substring(0, 5) || '';
                const endTime   = slot?.end_time?.substring(0, 5) || '';
                return (
                  <td key={dayIdx} style={{ padding: '2px', verticalAlign: 'middle' }}>
                    {slot ? (
                      <div style={{
                        backgroundColor: color,
                        color: '#fff',
                        borderRadius: 10,
                        padding: '0.5rem 0.35rem',
                        textAlign: 'center',
                        fontWeight: 600,
                        fontSize: '0.78rem',
                        minHeight: 70,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.3rem',
                        position: 'relative',
                        boxShadow: active
                          ? `0 0 0 3px #fff, 0 0 0 5px ${color}, 0 4px 16px ${color}88`
                          : '0 1px 3px rgba(0,0,0,0.15)',
                        transform: active ? 'scale(1.04)' : 'scale(1)',
                        transition: 'transform 0.2s, box-shadow 0.2s',
                        zIndex: active ? 2 : 1,
                      }}>
                        {active && (
                          <span style={{
                            position: 'absolute',
                            top: 5,
                            right: 6,
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: '#fff',
                            animation: 'pulse-dot 1.5s ease-in-out infinite',
                          }} />
                        )}
                        <span style={{ lineHeight: 1.15 }}>{slot.subject}</span>
                        {(startTime || endTime) && (
                          <span style={{ fontSize: '0.65rem', opacity: 0.85, lineHeight: 1.1 }}>
                            {startTime} - {endTime}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div style={{
                        minHeight: 70,
                        borderRadius: 10,
                        backgroundColor: 'var(--domus-card-bg)',
                        border: '1px solid var(--domus-border)',
                        opacity: 0.4,
                      }} />
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
