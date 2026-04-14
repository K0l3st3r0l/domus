-- ============================================================
-- DOMUS - Horarios escolares por hijo
-- ============================================================

CREATE TABLE IF NOT EXISTS school_schedules (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  child_email VARCHAR(255) NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Lunes ... 4=Viernes
  period_order SMALLINT NOT NULL,
  subject VARCHAR(255) NOT NULL,
  start_time TIME,
  end_time TIME,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, child_email, day_of_week, period_order)
);

CREATE INDEX IF NOT EXISTS idx_school_schedules_user ON school_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_school_schedules_child ON school_schedules(child_email);
