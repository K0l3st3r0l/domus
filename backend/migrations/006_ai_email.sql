-- ============================================================
-- DOMUS - AI Email Processing
-- ============================================================

-- Extend school_emails table with AI processing capabilities
ALTER TABLE school_emails ADD COLUMN IF NOT EXISTS html_body TEXT;
ALTER TABLE school_emails ADD COLUMN IF NOT EXISTS ai_processed BOOLEAN DEFAULT false;
ALTER TABLE school_emails ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE school_emails ADD COLUMN IF NOT EXISTS extracted_date TIMESTAMP;
ALTER TABLE school_emails ADD COLUMN IF NOT EXISTS ai_model VARCHAR(100);

-- Index for efficient filtering during batch processing
CREATE INDEX IF NOT EXISTS idx_school_emails_unread_unprocessed ON school_emails(user_id, is_read, ai_processed, date);
