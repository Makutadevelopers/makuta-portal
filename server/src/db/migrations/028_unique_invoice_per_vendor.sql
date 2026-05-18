-- 028_unique_invoice_per_vendor.sql
--
-- Enforce one invoice_no per vendor at the DB layer. The app already
-- rejects duplicates at create / bulk-import / vendor-merge time, but a
-- partial UNIQUE index closes the door at the schema level for any future
-- code path that forgets to call the check.
--
-- Pre-existing duplicates (live, non-empty invoice_no, same vendor_id)
-- get soft-deleted using the same winner logic the merge code uses:
--   pushed > most payments > most attachments > oldest created_at.

-- ── Step 1: cleanup ────────────────────────────────────────────────────────
WITH ranked AS (
  SELECT
    i.id,
    i.vendor_id,
    LOWER(TRIM(i.invoice_no)) AS invoice_no_norm,
    ROW_NUMBER() OVER (
      PARTITION BY i.vendor_id, LOWER(TRIM(i.invoice_no))
      ORDER BY
        COALESCE(i.pushed, FALSE) DESC,
        (SELECT COUNT(*) FROM payments p WHERE p.invoice_id = i.id) DESC,
        (SELECT COUNT(*) FROM attachments a WHERE a.invoice_id = i.id) DESC,
        i.created_at ASC,
        i.id ASC
    ) AS rn
  FROM invoices i
  WHERE i.vendor_id IS NOT NULL
    AND i.deleted_at IS NULL
    AND i.invoice_no IS NOT NULL
    AND TRIM(i.invoice_no) <> ''
)
UPDATE invoices
SET deleted_at = NOW(), updated_at = NOW()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── Step 2: enforce the constraint ─────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_vendor_no_unique
  ON invoices (vendor_id, LOWER(TRIM(invoice_no)))
  WHERE deleted_at IS NULL
    AND vendor_id IS NOT NULL
    AND invoice_no IS NOT NULL
    AND TRIM(invoice_no) <> '';
