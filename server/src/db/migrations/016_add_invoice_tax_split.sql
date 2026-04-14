-- 016_add_invoice_tax_split.sql
-- Split the invoice amount into a taxable base + GST components.
-- invoice_amount stays canonical (total) so payments/aging/reports are untouched.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS base_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS cgst_pct    NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_pct    NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_pct    NUMERIC(5,2) NOT NULL DEFAULT 0;

-- Backfill: existing rows were entered as a flat total — treat it as base with zero tax
UPDATE invoices SET base_amount = invoice_amount WHERE base_amount IS NULL;
-- Left nullable so legacy import paths (CSV imports) that don't supply a split still work;
-- the UI falls back to invoice_amount when base_amount is null.
