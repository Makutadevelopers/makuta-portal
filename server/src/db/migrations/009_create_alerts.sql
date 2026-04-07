-- 009_create_alerts.sql
-- Stores system alerts for HO users (duplicate invoices, vendor dedup, etc.)

CREATE TABLE IF NOT EXISTS alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type      TEXT NOT NULL,          -- 'duplicate_invoice', 'vendor_dedup'
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  metadata        JSONB,                  -- e.g. { invoiceId, vendorA, vendorB }
  resolved        BOOLEAN DEFAULT FALSE,
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(alert_type);
