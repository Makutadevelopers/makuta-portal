-- 003_create_invoices.sql

CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sl_no           SERIAL,
  month           DATE NOT NULL,
  invoice_date    DATE NOT NULL,
  vendor_id       UUID REFERENCES vendors(id),
  vendor_name     TEXT NOT NULL,
  invoice_no      TEXT NOT NULL,
  po_number       TEXT,
  purpose         TEXT NOT NULL,
  site            TEXT NOT NULL,
  invoice_amount  NUMERIC(14,2) NOT NULL,
  payment_status  TEXT NOT NULL DEFAULT 'Not Paid'
                    CHECK (payment_status IN ('Not Paid', 'Partial', 'Paid')),
  remarks         TEXT,
  pushed          BOOLEAN DEFAULT FALSE,
  pushed_at       TIMESTAMPTZ,
  approved_by     UUID REFERENCES users(id),
  minor_payment   BOOLEAN DEFAULT FALSE,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_site       ON invoices(site);
CREATE INDEX IF NOT EXISTS idx_invoices_status     ON invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor     ON invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON invoices(created_by);
