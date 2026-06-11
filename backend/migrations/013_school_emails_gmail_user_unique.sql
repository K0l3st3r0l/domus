ALTER TABLE school_emails DROP CONSTRAINT IF EXISTS school_emails_gmail_id_key;
DROP INDEX IF EXISTS school_emails_gmail_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS school_emails_gmail_user_unique
  ON school_emails(gmail_id, user_id);
