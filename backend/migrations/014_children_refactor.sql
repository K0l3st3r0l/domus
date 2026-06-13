-- ============================================================
-- DOMUS 014 - Refactor: children como entidad central
-- Los correos/tareas/horarios pasan de estar atados a (user_id, child_email)
-- a estar atados a child_id. Una sola descarga por hijo, visible a toda la familia.
-- Migración idempotente: detecta si ya corrió usando información_schema.
-- ============================================================

-- 1) Tabla children
CREATE TABLE IF NOT EXISTS children (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Backfill children desde tokens existentes (solo si la columna child_email aún existe)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'google_tokens' AND column_name = 'child_email'
  ) THEN
    INSERT INTO children (email, name)
    SELECT child_email, COALESCE(MAX(child_name), split_part(child_email, '@', 1))
    FROM google_tokens
    WHERE child_email IS NOT NULL
    GROUP BY child_email
    ON CONFLICT (email) DO NOTHING;
  END IF;
END $$;

-- 2) family_role en users
ALTER TABLE users ADD COLUMN IF NOT EXISTS family_role VARCHAR(20);

UPDATE users
SET family_role = CASE
  WHEN email IN (SELECT email FROM children) THEN 'child'
  ELSE 'parent'
END
WHERE family_role IS NULL;

-- 3) google_tokens: agregar child_id, connected_by_user_id, connected_at
ALTER TABLE google_tokens
  ADD COLUMN IF NOT EXISTS child_id INTEGER REFERENCES children(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS connected_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'google_tokens' AND column_name = 'child_email'
  ) THEN
    UPDATE google_tokens gt
    SET child_id = c.id,
        connected_by_user_id = COALESCE(gt.connected_by_user_id, gt.user_id),
        connected_at = COALESCE(gt.connected_at, gt.created_at)
    FROM children c
    WHERE c.email = gt.child_email AND gt.child_id IS NULL;
  END IF;
END $$;

-- Consolidar duplicados por child_id: el más recientemente actualizado gana
DELETE FROM google_tokens
WHERE child_id IS NOT NULL AND id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY child_id ORDER BY updated_at DESC NULLS LAST, id DESC) AS rn
    FROM google_tokens WHERE child_id IS NOT NULL
  ) sub
  WHERE rn > 1
);

ALTER TABLE google_tokens DROP CONSTRAINT IF EXISTS google_tokens_user_id_child_email_key;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_tokens_child_id_key') THEN
    ALTER TABLE google_tokens ADD CONSTRAINT google_tokens_child_id_key UNIQUE (child_id);
  END IF;
END $$;

-- Hacer child_id NOT NULL si todas las filas restantes lo tienen
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM google_tokens WHERE child_id IS NULL) THEN
    BEGIN
      ALTER TABLE google_tokens ALTER COLUMN child_id SET NOT NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

ALTER TABLE google_tokens
  DROP COLUMN IF EXISTS user_id,
  DROP COLUMN IF EXISTS child_email,
  DROP COLUMN IF EXISTS child_name;

-- 4) school_emails: agregar child_id, drop user_id/child_email, recalcular UNIQUE
ALTER TABLE school_emails
  ADD COLUMN IF NOT EXISTS child_id INTEGER REFERENCES children(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'school_emails' AND column_name = 'child_email'
  ) THEN
    UPDATE school_emails se
    SET child_id = c.id
    FROM children c
    WHERE c.email = se.child_email AND se.child_id IS NULL;
  END IF;
END $$;

DELETE FROM school_emails WHERE child_id IS NULL;

ALTER TABLE school_emails DROP CONSTRAINT IF EXISTS school_emails_gmail_user_unique;
DROP INDEX IF EXISTS school_emails_gmail_user_unique;

-- Consolidar duplicados por gmail_id (quedarse con la fila más reciente)
DELETE FROM school_emails
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY gmail_id ORDER BY updated_at DESC NULLS LAST, id DESC) AS rn
    FROM school_emails
  ) sub
  WHERE rn > 1
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_emails_gmail_id_key') THEN
    ALTER TABLE school_emails ADD CONSTRAINT school_emails_gmail_id_key UNIQUE (gmail_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM school_emails WHERE child_id IS NULL) THEN
    BEGIN
      ALTER TABLE school_emails ALTER COLUMN child_id SET NOT NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

ALTER TABLE school_emails
  DROP COLUMN IF EXISTS user_id,
  DROP COLUMN IF EXISTS child_email;

CREATE INDEX IF NOT EXISTS idx_school_emails_child ON school_emails(child_id);

-- 5) school_assignments
ALTER TABLE school_assignments
  ADD COLUMN IF NOT EXISTS child_id INTEGER REFERENCES children(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'school_assignments' AND column_name = 'child_email'
  ) THEN
    UPDATE school_assignments sa
    SET child_id = c.id
    FROM children c
    WHERE c.email = sa.child_email AND sa.child_id IS NULL;
  END IF;
END $$;

DELETE FROM school_assignments WHERE child_id IS NULL;

ALTER TABLE school_assignments DROP CONSTRAINT IF EXISTS school_assignments_child_email_classroom_id_key;

DELETE FROM school_assignments
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY child_id, classroom_id ORDER BY id DESC) AS rn
    FROM school_assignments
  ) sub
  WHERE rn > 1
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_assignments_child_id_classroom_id_key') THEN
    ALTER TABLE school_assignments ADD CONSTRAINT school_assignments_child_id_classroom_id_key UNIQUE (child_id, classroom_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM school_assignments WHERE child_id IS NULL) THEN
    BEGIN
      ALTER TABLE school_assignments ALTER COLUMN child_id SET NOT NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

ALTER TABLE school_assignments
  DROP COLUMN IF EXISTS user_id,
  DROP COLUMN IF EXISTS child_email;

CREATE INDEX IF NOT EXISTS idx_school_assignments_child ON school_assignments(child_id);

-- 6) school_schedules
ALTER TABLE school_schedules
  ADD COLUMN IF NOT EXISTS child_id INTEGER REFERENCES children(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'school_schedules' AND column_name = 'child_email'
  ) THEN
    UPDATE school_schedules ss
    SET child_id = c.id
    FROM children c
    WHERE c.email = ss.child_email AND ss.child_id IS NULL;
  END IF;
END $$;

DELETE FROM school_schedules WHERE child_id IS NULL;

DELETE FROM school_schedules
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY child_id, day_of_week, period_order ORDER BY id DESC) AS rn
    FROM school_schedules
  ) sub
  WHERE rn > 1
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM school_schedules WHERE child_id IS NULL) THEN
    BEGIN
      ALTER TABLE school_schedules ALTER COLUMN child_id SET NOT NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

ALTER TABLE school_schedules
  DROP COLUMN IF EXISTS user_id,
  DROP COLUMN IF EXISTS child_email;

CREATE INDEX IF NOT EXISTS idx_school_schedules_child ON school_schedules(child_id);
