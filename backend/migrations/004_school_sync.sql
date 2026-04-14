-- ============================================================
-- DOMUS - School Sync: Google Classroom + Gmail
-- ============================================================

-- Tokens OAuth por hijo (un padre puede conectar múltiples hijos)
CREATE TABLE IF NOT EXISTS google_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  child_email VARCHAR(255) NOT NULL,
  child_name VARCHAR(100),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expiry TIMESTAMP,
  last_sync TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, child_email)
);

-- Correos del colegio almacenados localmente
CREATE TABLE IF NOT EXISTS school_emails (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  child_email VARCHAR(255) NOT NULL,
  gmail_id VARCHAR(255) UNIQUE NOT NULL,
  from_address TEXT,
  subject TEXT,
  snippet TEXT,
  body TEXT,
  date TIMESTAMP,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tareas de Classroom
CREATE TABLE IF NOT EXISTS school_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  child_email VARCHAR(255) NOT NULL,
  classroom_id VARCHAR(255) NOT NULL,
  course_name VARCHAR(255),
  title VARCHAR(500),
  description TEXT,
  due_date TIMESTAMP,
  synced_to_calendar BOOLEAN DEFAULT false,
  calendar_event_id INTEGER REFERENCES calendar_events(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(child_email, classroom_id)
);

CREATE INDEX IF NOT EXISTS idx_school_emails_user ON school_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_school_assignments_user ON school_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_google_tokens_user ON google_tokens(user_id);
