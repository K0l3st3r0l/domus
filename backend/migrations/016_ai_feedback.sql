-- ============================================================
-- DOMUS - AI Classification Feedback
-- ============================================================

ALTER TABLE school_emails ADD COLUMN IF NOT EXISTS ai_feedback VARCHAR(20);
ALTER TABLE school_emails ADD COLUMN IF NOT EXISTS ai_original_type VARCHAR(30);
ALTER TABLE school_emails ADD COLUMN IF NOT EXISTS ai_observation TEXT;
