-- 017_add_additional_charge_and_dispute.sql
-- Adds per-invoice "additional charge" (e.g. transport, loading) with optional GST
-- and a lightweight dispute flag (minor / major) for attention tracking.
-- Dispute does NOT block payments — it is purely an attention marker.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS additional_charge          NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_charge_cgst_pct NUMERIC(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_charge_sgst_pct NUMERIC(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_charge_igst_pct NUMERIC(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_charge_reason   TEXT,
  ADD COLUMN IF NOT EXISTS disputed                   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dispute_severity           TEXT
      CHECK (dispute_severity IN ('minor', 'major')),
  ADD COLUMN IF NOT EXISTS dispute_reason             TEXT,
  ADD COLUMN IF NOT EXISTS disputed_by                UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS disputed_at                TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_disputed ON invoices(disputed) WHERE disputed = TRUE;
