ALTER TABLE IF EXISTS school_emails
ADD COLUMN IF NOT EXISTS synced_to_calendar BOOLEAN DEFAULT false;

UPDATE school_emails
SET synced_to_calendar = false
WHERE synced_to_calendar IS NULL;