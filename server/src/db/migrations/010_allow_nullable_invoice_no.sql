-- 010_allow_nullable_invoice_no.sql
-- Allow invoice_no to be NULL for imported rows that have no invoice number
ALTER TABLE invoices ALTER COLUMN invoice_no DROP NOT NULL;
