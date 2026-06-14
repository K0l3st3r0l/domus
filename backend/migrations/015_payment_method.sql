ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_finance_payment_method ON finance_transactions(payment_method);
