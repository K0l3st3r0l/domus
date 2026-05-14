import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Button, Modal, Form, Table } from 'react-bootstrap';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { toast } from 'react-toastify';
import apiClient from '../utils/apiClient';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const PIE_COLORS = ['#4f46e5','#10b981','#f59e0b','#ef4444','#06b6d4','#8b5cf6','#f97316','#ec4899','#14b8a6','#84cc16'];

// Reglas de categorización automática para estado de cuenta CMR Falabella
const CATEGORY_RULES = [
  { keywords: ['unimarc', 'jumbo', 'tottus', 'lider', 'santa isabel', 'papajohn', 'empanada', 'bodeguita', 'foodtruck', 'fruteria', 'minimarket', 'carnece', 'candyfruits', 'coca cola', 'delys', 'sba ', 'redgloba', 'bold ', 'punto de origen', 'altoflor', 'cafe', 'restaurant', 'pizza', 'sushi'], category: 'Alimentación' },
  { keywords: ['shell', 'copec', 'bencin', 'gasolina', 'diesel'], category: 'Combustible' },
  { keywords: ['parking', 'estacionamiento', 'peaje'], category: 'Estacionamiento' },
  { keywords: ['transantiago', 'metro ', 'peaje'], category: 'Transporte' },
  { keywords: ['movistar', 'entel', 'claro ', 'essal', 'saesa', 'chilectra', 'metrogas', 'aguas andinas'], category: 'Suministros' },
  { keywords: ['netflix', 'prime video', 'google play', 'spotify', 'dlocal', 'disney', 'hbo', 'youtube'], category: 'Ocio' },
  { keywords: ['fonasa', 'cruz verde', 'salcobrand', 'farm ', 'clinica', 'isapre', 'dental', 'medic', 'optica'], category: 'Salud' },
  { keywords: ['ripley', 'zara', 'h&m', 'boutique', 'falabella'], category: 'Ropa' },
  { keywords: ['sodimac', 'homecenter', 'easy ', 'ferreteria', 'electrocom', 'baza', 'construmart'], category: 'Construcción' },
  { keywords: ['github', 'ionos', 'microsoft', 'adobe', 'aliexpr', 'paymonade', 'google one', 'icloud'], category: 'Tecnología' },
  { keywords: ['adt', 'unired', 'seguros', 'mapfre', 'liberty'], category: 'Seguros' },
  { keywords: ['petco', 'veterinaria', 'veterinario', 'mascotas', 'pet shop'], category: 'Mascotas' },
  { keywords: ['salon', 'spa', 'estetica', 'barberia', 'peluqueria', 'cosmetica'], category: 'Belleza/Personal' },
  { keywords: ['hotel', 'airline', 'pasaje', 'vuelo', 'airbnb', 'booking'], category: 'Viajes' },
  { keywords: ['gym', 'gimnasio', 'crossfit', 'pilates', 'yoga'], category: 'Deportes' },
  { keywords: ['mueble', 'muebleria', 'sofá', 'cama', 'escritorio'], category: 'Muebles' },
  { keywords: ['mantenimiento auto', 'mecanico', 'neumatico', 'taller'], category: 'Auto' },
  { keywords: ['mall chino', 'centro chino', 'mercado chino'], category: 'Mall Chino' },
  { keywords: ['limpieza', 'jardineria', 'plomeria', 'electricidad', 'pintura'], category: 'Servicios' },
];

const EXCLUDE_KEYWORDS = [
  'pago tarjeta', 'sin movimientos', 'período facturado', 'periodo facturado',
  'pagar hasta', 'saldo adeudado', 'monto facturado', 'monto pagado', 'monto mínimo',
  'costo monetario', 'próximo período', 'monto total', 'cupo total', 'cupo compras',
  'tasa interés', 'facturación estado', 'fecha facturación', 'cupon de pago',
  'información general', 'información de pago', 'período anterior', 'período actual',
  'evolución montos', 'costo por atraso', 'interés por mora', 'gasto de cobranza',
  'productos o servicios', 'cargos, comisiones',
];

const LIDER_EXCLUDE_KEYWORDS = [
  'cupo total', 'cupo utilizado', 'cupo disponible', 'tasa interés vigente',
  'período facturado', 'pagar hasta', 'cae prepago', 'saldo adeudado',
  'información general', 'información de pago', 'costos por atraso',
  'próximo período', 'monto total facturado', 'monto mínimo', 'costo monetario',
  'evolución montos', 'gastos de cobranza', 'interés moratorio',
  'vencimiento actual', 'vencimiento próximos', 'detalle', 'período anterior',
  'dcto', 'comisión', 'cargo del mes', 'número cuota', 'valor cuota',
];

const MONTH_MAP = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };

function parseCMRWebStatement(text) {
  // Formato web de CMR Falabella: tabla con columnas separadas por tabulador
  // Fecha de compras | Descripción | Persona | Monto total | Cuotas | Cuota a pagar
  const transactions = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lowerLine = trimmed.toLowerCase();

    // Saltar fila de encabezado
    if (lowerLine.startsWith('fecha de compras') || lowerLine.startsWith('descripción')) continue;

    const parts = trimmed.split('\t').map(p => p.trim());

    // Necesitamos al menos: fecha, descripción, persona, monto
    if (parts.length < 4) continue;

    const [dateStr, description, , amountStr] = parts;

    // Validar formato de fecha DD/MM/YYYY
    if (!/^\d{2}\/\d{2}\/20\d{2}$/.test(dateStr)) continue;

    // Parsear monto: " $50" o " $40.000" → 50 o 40000
    const cleanAmount = amountStr.replace(/\$/g, '').replace(/\s/g, '').replace(/\./g, '');
    const amount = parseInt(cleanAmount, 10);
    if (!amount || amount <= 0) continue;

    // Convertir fecha DD/MM/YYYY → YYYY-MM-DD
    const [day, mon, yr] = dateStr.split('/');
    const date = `${yr}-${mon}-${day}`;

    // Categorización automática
    const descLower = description.toLowerCase();
    let category = 'Otros gastos';
    for (const { keywords, category: cat } of CATEGORY_RULES) {
      if (keywords.some(kw => descLower.includes(kw))) { category = cat; break; }
    }

    transactions.push({
      _id: Math.random().toString(36).slice(2, 11),
      selected: true,
      type: 'expense',
      amount,
      category,
      description: description.trim(),
      date,
    });
  }

  return { transactions, detectedCredits: [] };
}

function parseFalabellaStatement(text) {
  // Auto-detectar formato web (últimas transacciones desde el sitio CMR)
  if (text.toLowerCase().includes('fecha de compras')) {
    return parseCMRWebStatement(text);
  }

  // Detecta líneas con fecha DD/MM/YYYY seguida de descripción, indicador T/A1, y monto
  const txRegex = /(\d{2}\/\d{2}\/20\d{2})\s+(.+?)\s+(T|A\d+)\s+([\d.]+)/;
  // Patrón de créditos: fecha + "Super avance..." + T + monto_original + saldo + cuotas + mes_fin + cuota_mensual
  const creditRegex = /(\d{2}\/\d{2}\/20\d{2})\s+(super avance[^T\n]*?)\s+T\s+([\d.]+)\s+([\d.]+)\s+(\d{2})\/(\d{2})\s+([a-z]{3}-\d{4})\s+([\d.]+)/i;
  const transactions = [];
  const detectedCredits = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lowerLine = trimmed.toLowerCase();

    // Detectar créditos primero (antes del filtro de EXCLUDE_KEYWORDS)
    if (lowerLine.includes('super avance')) {
      const creditMatch = trimmed.match(creditRegex);
      if (creditMatch) {
        const [, , description, origStr, balStr, paidStr, totalStr, monthStr, paymentStr] = creditMatch;

        // Convertir mes abreviado (ene, feb, etc.) → número
        const monthNum = MONTH_MAP[monthStr.split('-')[0].toLowerCase()];
        const year = parseInt(monthStr.split('-')[1], 10);
        const endDate = monthNum ? `${year}-${String(monthNum).padStart(2, '0')}-01` : null;

        detectedCredits.push({
          _id: Math.random().toString(36).slice(2, 11),
          name: description.trim(),
          institution: 'Falabella CMR',
          type: 'avance',
          original_amount: parseInt(origStr.replace(/\./g, ''), 10),
          current_balance: parseInt(balStr.replace(/\./g, ''), 10),
          monthly_payment: parseInt(paymentStr.replace(/\./g, ''), 10),
          total_installments: parseInt(totalStr, 10),
          paid_installments: parseInt(paidStr, 10),
          end_date: endDate,
          interest_rate: null,
          notes: null,
        });
        continue;
      }
    }

    if (EXCLUDE_KEYWORDS.some(kw => lowerLine.includes(kw))) continue;

    const match = trimmed.match(txRegex);
    if (!match) continue;

    const [, dateStr, description, , amountStr] = match;

    // Convertir fecha DD/MM/YYYY → YYYY-MM-DD
    const [day, mon, yr] = dateStr.split('/');
    const date = `${yr}-${mon}-${day}`;

    // Los puntos son separadores de miles en CLP (ej: "11.980" = 11980)
    const amount = parseInt(amountStr.replace(/\./g, ''), 10);
    if (!amount || amount <= 0) continue;

    // Asignar categoría automáticamente según palabras clave
    const descLower = description.toLowerCase();
    let category = 'Otros gastos';
    for (const { keywords, category: cat } of CATEGORY_RULES) {
      if (keywords.some(kw => descLower.includes(kw))) { category = cat; break; }
    }

    transactions.push({
      _id: Math.random().toString(36).slice(2, 11),
      selected: true,
      type: 'expense',
      amount,
      category,
      description: description.trim(),
      date,
    });
  }

  return { transactions, detectedCredits };
}

function parseLiderStatement(text) {
  // Detecta líneas con fecha DD/MM/YYYY, descripción y monto en formato Lider BCI
  // Formato: LUGAR  DD/MM/YYYY  DESCRIPCION (T)  $ MONTO
  // o simplemente: DD/MM/YYYY  DESCRIPCION (T)  $ MONTO
  const txRegex = /(\d{2}\/\d{2}\/20\d{2})\s+(.+?)\s+\(T\)\s+\$\s+([\d.]+)/;
  const transactions = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lowerLine = trimmed.toLowerCase();

    // Excluir líneas de metadatos
    if (LIDER_EXCLUDE_KEYWORDS.some(kw => lowerLine.includes(kw))) continue;

    const match = trimmed.match(txRegex);
    if (!match) continue;

    const [, dateStr, description, amountStr] = match;

    // Convertir fecha DD/MM/YYYY → YYYY-MM-DD
    const [day, mon, yr] = dateStr.split('/');
    const date = `${yr}-${mon}-${day}`;

    // Los puntos son separadores de miles en CLP (ej: "11.980" = 11980)
    const amount = parseInt(amountStr.replace(/\./g, ''), 10);
    if (!amount || amount <= 0) continue;

    // Asignar categoría automáticamente según palabras clave
    const descLower = description.toLowerCase();
    let category = 'Otros gastos';
    for (const { keywords, category: cat } of CATEGORY_RULES) {
      if (keywords.some(kw => descLower.includes(kw))) { category = cat; break; }
    }

    transactions.push({
      _id: Math.random().toString(36).slice(2, 11),
      selected: true,
      type: 'expense',
      amount,
      category,
      description: description.trim(),
      date,
    });
  }

  return { transactions, detectedCredits: [] };
}

const formatCLP = (n) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(n);

const BANK_OPTIONS = [
  { id: 'falabella', label: 'CMR Falabella', icon: '🏪', parser: parseFalabellaStatement },
  { id: 'lider', label: 'Lider BCI', icon: '🛒', parser: parseLiderStatement },
];

export default function FinancesPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState({ income: [], expense: [] });
  const [showModal, setShowModal] = useState(false);
  const [editingTx, setEditingTx] = useState(null);
  const [form, setForm] = useState({ type: 'expense', amount: '', category: '', description: '', date: new Date().toISOString().split('T')[0] });

  // Estado del modal de importación
  const [showImport, setShowImport] = useState(false);
  const [importBank, setImportBank] = useState(null);
  const [importStep, setImportStep] = useState(0);
  const [importText, setImportText] = useState('');
  const [importTxs, setImportTxs] = useState([]);
  const [importCredits, setImportCredits] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [txRes, sumRes, catRes] = await Promise.all([
        apiClient.get(`/finances?month=${month}&year=${year}`),
        apiClient.get(`/finances/summary?month=${month}&year=${year}`),
        apiClient.get('/finances/categories'),
      ]);
      setTransactions(txRes.data);
      setSummary(sumRes.data);
      setCategories(catRes.data);
    } catch { toast.error('Error cargando datos financieros'); }
  }, [month, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNew = () => {
    setEditingTx(null);
    setForm({ type: 'expense', amount: '', category: '', description: '', date: new Date().toISOString().split('T')[0] });
    setShowModal(true);
  };

  const openEdit = (tx) => {
    setEditingTx(tx);
    setForm({ type: tx.type, amount: tx.amount, category: tx.category, description: tx.description || '', date: tx.date?.split('T')[0] || '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.amount || !form.category) { toast.warn('Importe y categoría requeridos'); return; }
    try {
      if (editingTx) {
        await apiClient.put(`/finances/${editingTx.id}`, form);
        toast.success('Transacción actualizada');
      } else {
        await apiClient.post('/finances', form);
        toast.success('Transacción añadida');
      }
      setShowModal(false);
      fetchData();
    } catch { toast.error('Error guardando'); }
  };

  const handleDelete = async () => {
    if (!window.confirm('¿Eliminar esta transacción?')) return;
    try {
      await apiClient.delete(`/finances/${editingTx.id}`);
      toast.success('Eliminada');
      setShowModal(false);
      fetchData();
    } catch { toast.error('Error eliminando'); }
  };

  // Handlers de importación
  const handleAnalyze = async () => {
    const bank = BANK_OPTIONS.find(b => b.id === importBank);
    if (!bank) {
      toast.error('Selecciona un banco');
      return;
    }
    const { transactions, detectedCredits } = bank.parser(importText);
    if (transactions.length === 0 && detectedCredits.length === 0) {
      toast.warn('No se encontraron transacciones. Verifica que pegaste el texto completo del estado de cuenta.');
      return;
    }

    // Verificar duplicados y categorías aprendidas en paralelo
    try {
      const descriptions = transactions.map(tx => tx.description).filter(Boolean);
      const [checkRes, catRes] = await Promise.all([
        apiClient.post('/finances/check-duplicates', { transactions }),
        apiClient.post('/finances/categories-by-description', { descriptions }),
      ]);

      const duplicateSet = new Set(checkRes.data.duplicates.map(d => `${d.description}|${d.date}|${d.amount}`));
      const learnedCategories = catRes.data; // { "COMPRA IONOS Inc.": "Servicios", ... }

      const txsWithFlags = transactions.map(tx => {
        const key = `${tx.description}|${tx.date}|${tx.amount}`;
        const isDuplicate = duplicateSet.has(key);
        const learnedCategory = learnedCategories[tx.description];
        return {
          ...tx,
          isDuplicate,
          selected: isDuplicate ? false : tx.selected,
          category: learnedCategory || tx.category,
          learnedCategory: !!learnedCategory,
        };
      });

      setImportTxs(txsWithFlags);
      if (checkRes.data.count > 0) {
        toast.warn(`⚠️ ${checkRes.data.count} transacción(es) ya existen en la BD y han sido desmarcadas`);
      }
      const learnedCount = txsWithFlags.filter(tx => tx.learnedCategory && !tx.isDuplicate).length;
      if (learnedCount > 0) {
        toast.info(`🧠 ${learnedCount} categoría(s) aplicadas desde tu historial`);
      }
    } catch (err) {
      console.error('Error en análisis:', err);
      setImportTxs(transactions);
    }

    setImportCredits(detectedCredits);
    setImportStep(2);
  };

  const toggleTx = (id) => setImportTxs(txs => txs.map(tx => tx._id === id ? { ...tx, selected: !tx.selected } : tx));
  const updateCategory = (id, category) => setImportTxs(txs => txs.map(tx => tx._id === id ? { ...tx, category } : tx));

  const handleCreateCredit = async (credit) => {
    try {
      const payload = {
        name: credit.name,
        institution: credit.institution,
        type: credit.type,
        original_amount: credit.original_amount,
        current_balance: credit.current_balance,
        monthly_payment: credit.monthly_payment,
        total_installments: credit.total_installments,
        paid_installments: credit.paid_installments,
        end_date: credit.end_date,
        interest_rate: credit.interest_rate,
        start_date: null,
        notes: credit.notes,
      };
      await apiClient.post('/credits', payload);
      toast.success(`Crédito "${credit.name}" creado correctamente`);
      setImportCredits(credits => credits.filter(c => c._id !== credit._id));
    } catch (err) {
      console.error('Error creando crédito:', err);
      toast.error('Error creando crédito');
    }
  };

  const handleImport = async () => {
    const selected = importTxs.filter(tx => tx.selected);
    if (selected.length === 0) { toast.warn('Selecciona al menos una transacción'); return; }
    try {
      const payload = selected.map(({ type, amount, category, description, date }) => ({ type, amount, category, description, date }));
      await apiClient.post('/finances/batch', { transactions: payload });
      toast.success(`${selected.length} transacciones importadas correctamente`);
      closeImport();
      fetchData();
    } catch { toast.error('Error importando transacciones'); }
  };

  const closeImport = () => { setShowImport(false); setImportBank(null); setImportStep(0); setImportText(''); setImportTxs([]); setImportCredits([]); };

  const selectedCount = importTxs.filter(tx => tx.selected).length;
  const selectedTotal = importTxs.filter(tx => tx.selected).reduce((s, tx) => s + tx.amount, 0);
  const expenseBreakdown = summary?.breakdown?.filter(r => r.type === 'expense') || [];
  const filteredTransactions = selectedCategory ? transactions.filter(tx => tx.category === selectedCategory && tx.type === 'expense') : transactions;

  return (
    <div>
      <div className="domus-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 className="domus-page-title">💰 Finanzas del hogar</h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Form.Select size="sm" value={month} onChange={e => setMonth(Number(e.target.value))} style={{ width: 130 }}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Form.Select>
            <Form.Select size="sm" value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 90 }}>
              {[2023, 2024, 2025, 2026].map(y => <option key={y}>{y}</option>)}
            </Form.Select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant="outline-secondary" size="sm" onClick={() => setShowImport(true)}>
            📥 Importar estado
          </Button>
          <Button className="btn-domus" onClick={openNew}>+ Añadir</Button>
        </div>
      </div>

      {/* Resumen */}
      {summary && (
        <Row className="g-3 mb-4">
          <Col md={4}>
            <div className="domus-card text-center">
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>INGRESOS</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#10b981' }}>{summary.income.toFixed(0)} CLP</div>
            </div>
          </Col>
          <Col md={4}>
            <div className="domus-card text-center">
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>GASTOS</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#ef4444' }}>{summary.expenses.toFixed(0)} CLP</div>
            </div>
          </Col>
          <Col md={4}>
            <div className="domus-card text-center">
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>BALANCE</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: summary.balance >= 0 ? '#10b981' : '#ef4444' }}>
                {summary.balance >= 0 ? '+' : ''}{summary.balance.toFixed(0)} CLP
              </div>
            </div>
          </Col>
        </Row>
      )}

      <Row className="g-3 mb-4">
        {expenseBreakdown.length > 0 && (
          <Col md={6}>
            <div className="domus-card">
              <h6 style={{ fontWeight: 600, marginBottom: '1rem' }}>Gastos por categoría</h6>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={expenseBreakdown} dataKey="total" nameKey="category" cx="50%" cy="45%" outerRadius={80}
                    onClick={(e) => setSelectedCategory(selectedCategory === e.category ? null : e.category)}>
                    {expenseBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={v => `${parseFloat(v).toFixed(0)} CLP`} />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Col>
        )}
        <Col md={expenseBreakdown.length > 0 ? 6 : 12}>
          <div className="domus-card">
            <h6 style={{ fontWeight: 600, marginBottom: '1rem' }}>Detalle {selectedCategory && `— ${selectedCategory}`}</h6>
            {expenseBreakdown.map((item, i) => (
              <div key={i} onClick={() => setSelectedCategory(selectedCategory === item.category ? null : item.category)}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0.5rem', borderBottom: '1px solid #f1f5f9', fontSize: '0.875rem', cursor: 'pointer', borderRadius: '0.25rem', background: selectedCategory === item.category ? '#1e293b' : 'transparent', transition: 'background 0.2s' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length], display: 'inline-block' }} />
                  {item.category}
                </span>
                <span style={{ fontWeight: 500 }}>{parseFloat(item.total).toFixed(0)} CLP</span>
              </div>
            ))}
          </div>
        </Col>
      </Row>

      {/* Transacciones */}
      <div className="domus-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h6 style={{ fontWeight: 600, margin: 0 }}>Transacciones — {MONTHS[month - 1]} {year} {selectedCategory && `(${selectedCategory})`}</h6>
          {selectedCategory && <Button size="sm" variant="outline-secondary" onClick={() => setSelectedCategory(null)}>Limpiar filtro</Button>}
        </div>
        {filteredTransactions.length === 0 && <p style={{ color: '#94a3b8', textAlign: 'center', padding: '1.5rem 0' }}>{selectedCategory ? `Sin transacciones en ${selectedCategory}.` : 'Sin transacciones este mes.'}</p>}
        {filteredTransactions.map(tx => (
          <div key={tx.id} onClick={() => openEdit(tx)}
            style={{ display: 'flex', alignItems: 'center', padding: '0.75rem 0', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', gap: '1rem' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
              background: tx.type === 'income' ? '#d1fae5' : '#fee2e2', flexShrink: 0 }}>
              {tx.type === 'income' ? '📈' : '📉'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{tx.category}</div>
              {tx.description && <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{tx.description}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600, color: tx.type === 'income' ? '#10b981' : '#ef4444' }}>
                {tx.type === 'income' ? '+' : '-'}{parseFloat(tx.amount).toFixed(0)} CLP
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{new Date(tx.date).toLocaleDateString('es-ES')}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal — transacción manual */}
      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{editingTx ? 'Editar transacción' : 'Nueva transacción'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Tipo</Form.Label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['expense', 'income'].map(t => (
                <button key={t} type="button" onClick={() => setForm(f => ({ ...f, type: t, category: '' }))}
                  style={{ flex: 1, padding: '0.5rem', border: '2px solid', borderRadius: 8, cursor: 'pointer', fontWeight: 500,
                    borderColor: form.type === t ? (t === 'income' ? '#10b981' : '#ef4444') : '#e2e8f0',
                    background: form.type === t ? (t === 'income' ? '#d1fae5' : '#fee2e2') : '#fff',
                    color: form.type === t ? (t === 'income' ? '#065f46' : '#991b1b') : '#64748b' }}>
                  {t === 'income' ? '💚 Ingreso' : '❤️ Gasto'}
                </button>
              ))}
            </div>
          </Form.Group>
          <Row>
            <Col>
              <Form.Group className="mb-3">
                <Form.Label>Importe (CLP) *</Form.Label>
                <Form.Control type="number" min="0.01" step="0.01" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
              </Form.Group>
            </Col>
            <Col>
              <Form.Group className="mb-3">
                <Form.Label>Fecha</Form.Label>
                <Form.Control type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </Form.Group>
            </Col>
          </Row>
          <Form.Group className="mb-3">
            <Form.Label>Categoría *</Form.Label>
            <Form.Select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              <option value="">Selecciona categoría</option>
              {(form.type === 'income' ? categories.income : categories.expense).map(c => <option key={c}>{c}</option>)}
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label>Descripción</Form.Label>
            <Form.Control value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Descripción opcional" />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          {editingTx && <Button variant="outline-danger" onClick={handleDelete}>Eliminar</Button>}
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
          <Button className="btn-domus" onClick={handleSave}>Guardar</Button>
        </Modal.Footer>
      </Modal>

      {/* Modal — importar estado de cuenta */}
      <Modal show={showImport} onHide={closeImport} size="xl" centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {importStep === 0
              ? '📥 Importar Estado de Cuenta'
              : importStep === 1
              ? `📥 Importar ${BANK_OPTIONS.find(b => b.id === importBank)?.label || ''}`
              : `Revisar transacciones — ${importTxs.length} encontradas`}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {importStep === 0 ? (
            <>
              <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Selecciona el banco o institución de donde quieres importar el estado de cuenta:
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                {BANK_OPTIONS.map(bank => (
                  <div
                    key={bank.id}
                    onClick={() => { setImportBank(bank.id); setImportStep(1); }}
                    style={{
                      padding: '1rem',
                      border: '2px solid #e2e8f0',
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#4f46e5'; e.currentTarget.style.background = '#f0f4ff'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#fff'; }}
                  >
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{bank.icon}</div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{bank.label}</div>
                  </div>
                ))}
              </div>
            </>
          ) : importStep === 1 ? (
            <>
              <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                {importBank === 'falabella' ? (
                  <>
                    Puedes pegar el texto de <strong>dos formas</strong>:<br />
                    <strong>· PDF:</strong> Abre el PDF en Chrome o Adobe, selecciona todo con <kbd>Ctrl+A</kbd> y pega aquí.<br />
                    <strong>· Web CMR:</strong> En el sitio de CMR, selecciona la tabla de "Últimas transacciones" y pégala directamente.
                  </>
                ) : (
                  <>
                    Abre el PDF del estado de cuenta en tu visor (Chrome, Adobe, etc.), selecciona todo el texto con{' '}
                    <kbd>Ctrl+A</kbd>, cópialo con <kbd>Ctrl+C</kbd> y pégalo aquí abajo.
                  </>
                )}
              </p>
              <Form.Control
                as="textarea"
                rows={11}
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder="Pega aquí el texto del estado de cuenta..."
                style={{ fontFamily: 'monospace', fontSize: '0.78rem', resize: 'vertical' }}
              />
              <small style={{ color: '#94a3b8', marginTop: '0.5rem', display: 'block' }}>
                Las compras se detectan automáticamente. Los pagos a la tarjeta y avances en efectivo se excluyen.
              </small>
            </>
          ) : (
            <>
              {/* Créditos detectados */}
              {importCredits.length > 0 && (
                <div style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: 8, background: '#fef3c7', border: '1px solid #f59e0b' }}>
                  <h6 style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#92400e' }}>
                    ⚠️ Se detectaron {importCredits.length} avance(s) en efectivo
                  </h6>
                  <small style={{ color: '#92400e', display: 'block', marginBottom: '0.75rem' }}>
                    Puedes crearlos como créditos en la página de Créditos Activos.
                  </small>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {importCredits.map(credit => (
                      <div key={credit._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: '#fff', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{credit.name}</div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>
                            {credit.paid_installments}/{credit.total_installments} cuotas · {formatCLP(credit.monthly_payment)}/mes
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', marginRight: '0.5rem' }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 500, color: '#ef4444' }}>Saldo: {formatCLP(credit.current_balance)}</div>
                        </div>
                        <Button size="sm" className="btn-domus" onClick={() => handleCreateCredit(credit)} style={{ whiteSpace: 'nowrap' }}>
                          Crear crédito
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <Form.Check
                  id="select-all"
                  label={`Seleccionar todas (${importTxs.filter(tx => !tx.isDuplicate).length})`}
                  checked={importTxs.filter(tx => !tx.isDuplicate).length > 0 && importTxs.filter(tx => !tx.isDuplicate).every(tx => tx.selected)}
                  onChange={(e) => {
                    const nonDuplicates = importTxs.filter(tx => !tx.isDuplicate);
                    const allSelected = nonDuplicates.length > 0 && nonDuplicates.every(tx => tx.selected);
                    setImportTxs(txs => txs.map(tx =>
                      tx.isDuplicate ? tx : { ...tx, selected: !allSelected }
                    ));
                  }}
                />
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#4f46e5' }}>
                  {selectedCount} seleccionadas · {formatCLP(selectedTotal)}
                </span>
              </div>

              <div style={{ maxHeight: 430, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                <Table size="sm" style={{ marginBottom: 0 }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                    <tr>
                      <th style={{ width: 36, padding: '0.5rem 0.75rem' }}></th>
                      <th style={{ width: 95 }}>Fecha</th>
                      <th>Descripción</th>
                      <th style={{ width: 175 }}>Categoría</th>
                      <th style={{ width: 115, textAlign: 'right' }}>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importTxs.map(tx => (
                      <tr key={tx._id} style={{
                        opacity: tx.isDuplicate ? 0.4 : (tx.selected ? 1 : 0.6),
                        background: tx.isDuplicate ? '#fee2e2' : 'transparent',
                        transition: 'opacity 0.2s'
                      }}>
                        <td style={{ padding: '0.4rem 0.75rem' }}>
                          <Form.Check
                            checked={tx.selected}
                            onChange={() => toggleTx(tx._id)}
                            disabled={tx.isDuplicate}
                            title={tx.isDuplicate ? 'Duplicado detectado' : ''}
                          />
                        </td>
                        <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                          {tx.date.split('-').reverse().join('/')}
                          {tx.isDuplicate && <span title="Transacción duplicada" style={{ marginLeft: '0.3rem', color: '#ef4444', fontWeight: 'bold' }}>⚠️</span>}
                        </td>
                        <td style={{ fontSize: '0.8rem', verticalAlign: 'middle' }}>
                          {tx.description}
                          {tx.isDuplicate && <div style={{ fontSize: '0.7rem', color: '#dc2626', marginTop: '0.2rem' }}>Duplicado: ya existe en BD</div>}
                        </td>
                        <td style={{ verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            {tx.learnedCategory && !tx.isDuplicate && (
                              <span title="Categoría aprendida desde tu historial" style={{ fontSize: '0.85rem', cursor: 'default', flexShrink: 0 }}>🧠</span>
                            )}
                          <Form.Select size="sm" value={tx.category}
                            onChange={e => updateCategory(tx._id, e.target.value)}
                            style={{ fontSize: '0.78rem' }}
                            disabled={tx.isDuplicate}>
                            {categories.expense.map(c => <option key={c}>{c}</option>)}
                          </Form.Select>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontSize: '0.85rem', fontWeight: 500, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                          {formatCLP(tx.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              <small style={{ color: '#94a3b8', marginTop: '0.5rem', display: 'block' }}>
                Puedes cambiar la categoría de cada transacción antes de importar.
                {importTxs.some(tx => tx.isDuplicate) && (
                  <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#fee2e2', borderRadius: 4, color: '#991b1b' }}>
                    ⚠️ Las transacciones marcadas con ⚠️ ya existen en la BD (coinciden por empresa, fecha y monto) y han sido automáticamente desmarcadas.
                  </div>
                )}
              </small>
            </>
          )}
        </Modal.Body>

        <Modal.Footer>
          {importStep === 0 ? (
            <Button variant="secondary" onClick={closeImport}>Cancelar</Button>
          ) : importStep === 1 ? (
            <>
              <Button variant="secondary" onClick={() => setImportStep(0)}>← Volver</Button>
              <Button className="btn-domus" onClick={handleAnalyze} disabled={!importText.trim()}>
                Analizar →
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setImportStep(1)}>← Volver</Button>
              <Button className="btn-domus" onClick={handleImport} disabled={selectedCount === 0}>
                Importar {selectedCount} transacciones
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal>
    </div>
  );
}