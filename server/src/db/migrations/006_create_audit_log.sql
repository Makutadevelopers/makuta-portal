-- 006_create_audit_log.sql

CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id),
  action          TEXT NOT NULL,
  invoice_id      UUID REFERENCES invoices(id),
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_invoice ON audit_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_logs(user_id);
