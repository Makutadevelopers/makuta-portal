-- 049_create_invoice_line_items.sql
-- Lets a single invoice carry MULTIPLE additional line items, each with its own
-- GST split. Generalises the single per-invoice "additional charge" (migration
-- 017) — those legacy columns stay on `invoices` for old rows + the bulk
-- importer, and continue to hold the aggregate (additional_charge = Σ item
-- amounts) so exports and fallbacks keep working when no detail rows exist.
--
-- The invoice's own base_amount / cgst_pct / sgst_pct / igst_pct (the primary
-- line) remain authoritative for TDS and the GST base — these rows model the
-- EXTRA items only, exactly as the old additional_charge did.

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL DEFAULT 1,
  description  TEXT NOT NULL,
  amount       NUMERIC(14,2) NOT NULL DEFAULT 0,   -- pre-GST
  cgst_pct     NUMERIC(5,2)  NOT NULL DEFAULT 0,
  sgst_pct     NUMERIC(5,2)  NOT NULL DEFAULT 0,
  igst_pct     NUMERIC(5,2)  NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON invoice_line_items(invoice_id);
