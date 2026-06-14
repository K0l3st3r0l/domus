ALTER TABLE school_emails DROP CONSTRAINT IF EXISTS school_emails_gmail_id_key;
DROP INDEX IF EXISTS school_emails_gmail_id_key;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='school_emails' AND column_name='user_id') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS school_emails_gmail_user_unique ON school_emails(gmail_id, user_id);
  END IF;
END $$;
