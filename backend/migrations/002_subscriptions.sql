-- ============================================================
-- DOMUS - Suscripciones a servicios digitales
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100) DEFAULT 'Entretenimiento',
  amount NUMERIC(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'EUR',
  billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly', -- monthly | yearly | weekly
  next_billing_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'active', -- active | paused | cancelled
  alert_days INTEGER DEFAULT 3, -- días antes del vencimiento para mostrar alerta
  url VARCHAR(500),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_billing ON subscriptions(next_billing_date);
