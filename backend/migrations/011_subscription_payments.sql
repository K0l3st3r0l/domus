-- Seguimiento de pagos reales por suscripción
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS last_paid_at DATE,
  ADD COLUMN IF NOT EXISTS last_paid_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS match_keywords TEXT; -- palabras clave separadas por coma, ej: "ANTHROPIC,CLAUDE"
