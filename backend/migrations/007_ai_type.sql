-- ============================================================
-- DOMUS - AI Email Type Classification
-- ============================================================

-- Add AI-detected message type (reunion, tarea, aviso, otro)
ALTER TABLE school_emails ADD COLUMN IF NOT EXISTS ai_type VARCHAR(30);
