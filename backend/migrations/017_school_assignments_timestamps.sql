-- ============================================================
-- DOMUS 017 - Timestamps de Classroom en school_assignments
-- Guarda creation_time y update_time que entrega la API de
-- Google Classroom para cada courseWork. Permite filtrar
-- tareas por año vigente sin parsear el nombre del curso.
-- Idempotente.
-- ============================================================

ALTER TABLE school_assignments
  ADD COLUMN IF NOT EXISTS creation_time TIMESTAMP,
  ADD COLUMN IF NOT EXISTS update_time   TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_school_assignments_update_time
  ON school_assignments(update_time);
