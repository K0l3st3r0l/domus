-- ============================================================
-- DOMUS - Schema inicial
-- ============================================================

-- Usuarios / Miembros de la familia
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member', -- admin | member
  avatar VARCHAR(10) DEFAULT '🏠',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Invitaciones
CREATE TABLE IF NOT EXISTS invitations (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'member',
  token VARCHAR(255) UNIQUE NOT NULL,
  used BOOLEAN DEFAULT false,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Eventos del calendario
CREATE TABLE IF NOT EXISTS calendar_events (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  all_day BOOLEAN DEFAULT false,
  color VARCHAR(20) DEFAULT '#4f46e5',
  alert_minutes INTEGER, -- minutos antes para alerta (NULL = sin alerta)
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Menú semanal
-- day_of_week: 0=Lunes, 1=Martes, ..., 6=Domingo
-- meal_type: desayuno | almuerzo | cena | merienda
CREATE TABLE IF NOT EXISTS weekly_menu (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL, -- lunes de la semana
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  meal_type VARCHAR(20) NOT NULL CHECK (meal_type IN ('desayuno','almuerzo','cena','merienda')),
  dish_name VARCHAR(200) NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (week_start, day_of_week, meal_type)
);

-- Listas de la compra
CREATE TABLE IF NOT EXISTS shopping_lists (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Items de la lista de compra
CREATE TABLE IF NOT EXISTS shopping_items (
  id SERIAL PRIMARY KEY,
  list_id INTEGER REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  quantity NUMERIC(10,2) DEFAULT 1,
  unit VARCHAR(50), -- kg, g, litros, uds...
  category VARCHAR(100) DEFAULT 'General',
  checked BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Transacciones financieras
CREATE TABLE IF NOT EXISTS finance_transactions (
  id SERIAL PRIMARY KEY,
  type VARCHAR(10) NOT NULL CHECK (type IN ('income','expense')),
  amount NUMERIC(12,2) NOT NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  recurring BOOLEAN DEFAULT false,
  recurring_period VARCHAR(20), -- monthly | weekly | yearly
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Índices útiles
CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_menu_week ON weekly_menu(week_start);
CREATE INDEX IF NOT EXISTS idx_finance_date ON finance_transactions(date);
CREATE INDEX IF NOT EXISTS idx_shopping_list ON shopping_items(list_id);
