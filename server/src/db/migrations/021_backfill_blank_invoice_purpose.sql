-- Backfill invoices.purpose from the vendor's stored category whenever the
-- invoice's purpose was saved as blank/NULL by an older bulk-import run.
-- Only touches rows where purpose is empty — never overwrites an explicit
-- category, so legitimate "General Supplies" / "Steel" / etc. entries
-- are left as-is.

UPDATE invoices i
SET purpose = v.category
FROM vendors v
WHERE i.vendor_id = v.id
  AND v.category IS NOT NULL
  AND v.category <> ''
  AND (i.purpose IS NULL OR TRIM(i.purpose) = '')
  AND i.deleted_at IS NULL;
