ALTER TABLE IF EXISTS school_emails
ADD COLUMN IF NOT EXISTS calendar_event_id INTEGER
  REFERENCES calendar_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_school_emails_calendar_event_id
  ON school_emails(calendar_event_id);
