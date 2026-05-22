-- 047_vendor_invoice_no_optional.sql
--
-- Some vendors never issue an invoice number (e.g. bank charges, refunds).
-- This adds a per-vendor opt-out: when invoice_no_optional = TRUE, invoices for
-- that vendor may be saved with a blank invoice_no, and a reason must be recorded
-- on the vendor explaining why. Default FALSE keeps every existing vendor
-- requiring an invoice number (no behaviour change).
--
-- invoices.invoice_no is already nullable (migration 010); the requirement was
-- only enforced in app-level validation.

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS invoice_no_optional BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS invoice_no_optional_reason TEXT;
