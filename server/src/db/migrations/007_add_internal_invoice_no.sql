-- 007_add_internal_invoice_no.sql
-- Adds an auto-generated internal invoice number for tracking (MKT-00001, MKT-00002, ...)

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS internal_no TEXT;

-- Create a sequence for internal numbering
CREATE SEQUENCE IF NOT EXISTS invoice_internal_seq START WITH 1;

-- Backfill existing invoices with internal numbers based on creation order
DO $$
DECLARE
  r RECORD;
  seq_val INT;
BEGIN
  FOR r IN SELECT id FROM invoices ORDER BY created_at ASC
  LOOP
    seq_val := nextval('invoice_internal_seq');
    UPDATE invoices SET internal_no = 'MKT-' || LPAD(seq_val::text, 5, '0') WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_internal_no ON invoices(internal_no);
