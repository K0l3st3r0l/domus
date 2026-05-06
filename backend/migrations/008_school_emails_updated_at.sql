-- ============================================================
-- DOMUS - Add updated_at to school_emails for change tracking
-- ============================================================

ALTER TABLE school_emails ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Backfill existing rows with created_at so the comparison starts sane
UPDATE school_emails SET updated_at = created_at WHERE updated_at IS NULL;

-- Delete stale Classroom announcements so the next sync re-fetches them
-- with the correct updated content (they will be re-inserted automatically)
DELETE FROM school_emails WHERE gmail_id LIKE 'classroom:ann:%';
