-- 004_create_payments.sql

CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount          NUMERIC(14,2) NOT NULL,
  payment_type    TEXT NOT NULL,
  payment_ref     TEXT,
  payment_date    DATE NOT NULL,
  bank            TEXT,
  recorded_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
