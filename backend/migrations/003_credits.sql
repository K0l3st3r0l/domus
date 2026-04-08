-- ============================================================
-- DOMUS - Créditos activos (hipotecarios, consumo, avances, etc.)
-- ============================================================

CREATE TABLE IF NOT EXISTS credits (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  institution VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'consumo', -- avance | hipotecario | consumo | educacion | auto | otro
  original_amount NUMERIC(14,2) NOT NULL,
  current_balance NUMERIC(14,2) NOT NULL,
  monthly_payment NUMERIC(12,2) NOT NULL,
  interest_rate NUMERIC(6,2),               -- tasa anual en %
  total_installments INTEGER,
  paid_installments INTEGER DEFAULT 0,
  start_date DATE,
  end_date DATE,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credits_active ON credits(active);