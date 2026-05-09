-- =============================================================================
-- cleanup_invoice_duplicates.sql
--
-- Soft-deletes duplicate invoices, KEEPING the oldest (or the one that has
-- payments / attachments) per (vendor, invoice_no) group.
--
-- ⚠️  RUN audit_invoice_duplicates.sql FIRST and review the output.
-- ⚠️  This wraps everything in a transaction.  At the end the script issues
--     `ROLLBACK` by default — change it to `COMMIT` only after you have
--     reviewed the candidate list inside the transaction and are happy.
-- ⚠️  Rows with payments or attachments are NEVER auto-deleted.  If a
--     duplicate group has more than one row with payments/attachments, the
--     script will RAISE EXCEPTION so you can resolve it manually.
--
-- Usage on EC2:
--   psql "$DATABASE_URL" -f scripts/cleanup_invoice_duplicates.sql
-- =============================================================================

BEGIN;

-- 1. Pick the "winner" per duplicate group.
--    Priority:  has_payments DESC, has_attachments DESC, oldest created_at
--    Rationale: rows people actively used are protected; otherwise keep the
--    one entered first (the original).
CREATE TEMP TABLE _dup_ranked AS
WITH keyed AS (
  SELECT
    i.id,
    i.invoice_no,
    i.vendor_id,
    i.vendor_name,
    i.created_at,
    COALESCE(i.vendor_id::text, LOWER(TRIM(i.vendor_name))) AS vendor_key,
    LOWER(TRIM(i.invoice_no)) AS invoice_no_key,
    EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id AND p.deleted_at IS NULL) AS has_payments,
    EXISTS (SELECT 1 FROM attachments a WHERE a.invoice_id = i.id) AS has_attachments
  FROM invoices i
  WHERE i.deleted_at IS NULL
    AND i.invoice_no IS NOT NULL
    AND TRIM(i.invoice_no) <> ''
),
groups AS (
  SELECT vendor_key, invoice_no_key
  FROM keyed
  GROUP BY vendor_key, invoice_no_key
  HAVING COUNT(*) > 1
)
SELECT
  k.id,
  k.invoice_no,
  k.vendor_name,
  k.has_payments,
  k.has_attachments,
  k.created_at,
  ROW_NUMBER() OVER (
    PARTITION BY k.vendor_key, k.invoice_no_key
    ORDER BY k.has_payments DESC, k.has_attachments DESC, k.created_at ASC, k.id ASC
  ) AS rnk
FROM keyed k
JOIN groups g
  ON g.vendor_key     = k.vendor_key
 AND g.invoice_no_key = k.invoice_no_key;

-- 2. Safety check: a group must not have more than one row with payments OR
--    more than one row with attachments. If it does, abort so a human can
--    decide which payments/attachments to merge into the survivor.
DO $$
DECLARE
  bad_pay  INT;
  bad_att  INT;
BEGIN
  SELECT COUNT(*) INTO bad_pay FROM (
    SELECT 1 FROM _dup_ranked WHERE has_payments AND rnk > 1
  ) sub;
  SELECT COUNT(*) INTO bad_att FROM (
    SELECT 1 FROM _dup_ranked WHERE has_attachments AND rnk > 1
  ) sub;
  IF bad_pay > 0 THEN
    RAISE EXCEPTION 'Aborting: % duplicate row(s) have payments attached. Merge payments to the survivor first, then re-run.', bad_pay;
  END IF;
  IF bad_att > 0 THEN
    RAISE EXCEPTION 'Aborting: % duplicate row(s) have attachments. Move attachments to the survivor first, then re-run.', bad_att;
  END IF;
END
$$;

-- 3. Show what will be soft-deleted.
SELECT
  id, invoice_no, vendor_name, created_at, has_payments, has_attachments
FROM _dup_ranked
WHERE rnk > 1
ORDER BY vendor_name, invoice_no, created_at;

-- 4. Soft-delete the losers.  deleted_at is set; row stays auditable.
UPDATE invoices
SET deleted_at = NOW(),
    updated_at = NOW(),
    remarks = COALESCE(remarks || E'\n', '') ||
              '[auto-deleted ' || NOW()::DATE ||
              ': duplicate of another invoice for the same vendor]'
WHERE id IN (SELECT id FROM _dup_ranked WHERE rnk > 1);

-- 5. Final tally.
SELECT
  (SELECT COUNT(*) FROM _dup_ranked WHERE rnk > 1)  AS rows_marked_deleted,
  (SELECT COUNT(*) FROM _dup_ranked WHERE rnk = 1)  AS rows_kept;

-- ---------------------------------------------------------------------------
-- Default: ROLLBACK so nothing changes until you flip this to COMMIT.
-- ---------------------------------------------------------------------------
ROLLBACK;
-- COMMIT;
