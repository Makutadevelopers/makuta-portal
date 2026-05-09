-- =============================================================================
-- audit_invoice_duplicates.sql
--
-- Read-only audit query.  Run this against prod RDS BEFORE deploying the
-- strict-uniqueness change so you know exactly which rows are duplicates and
-- can decide which one to keep.  Nothing is mutated.
--
-- Usage on EC2 (host with psql installed):
--   psql "$DATABASE_URL" -f scripts/audit_invoice_duplicates.sql
--
-- Or via the Docker network:
--   docker exec -i makuta_portal_api_prod psql "$DATABASE_URL" \
--     < scripts/audit_invoice_duplicates.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Group key: prefer vendor_id when present, else fall back to a normalised
-- vendor_name.  invoice_no is compared case-insensitive after trimming.
-- ---------------------------------------------------------------------------
WITH keyed AS (
  SELECT
    i.id,
    i.internal_no,
    i.invoice_date,
    i.invoice_no,
    i.vendor_id,
    i.vendor_name,
    i.invoice_amount,
    i.site,
    i.payment_status,
    i.created_at,
    i.created_by,
    COALESCE(i.vendor_id::text, LOWER(TRIM(i.vendor_name))) AS vendor_key,
    LOWER(TRIM(i.invoice_no)) AS invoice_no_key
  FROM invoices i
  WHERE i.deleted_at IS NULL
    AND i.invoice_no IS NOT NULL
    AND TRIM(i.invoice_no) <> ''
),
-- Count per (vendor, invoice_no).  Pairs with count > 1 are duplicates.
dupe_groups AS (
  SELECT vendor_key, invoice_no_key, COUNT(*) AS hit_count
  FROM keyed
  GROUP BY vendor_key, invoice_no_key
  HAVING COUNT(*) > 1
)
SELECT
  k.vendor_key,
  k.invoice_no_key                                  AS invoice_no,
  k.vendor_name,
  k.id                                              AS invoice_id,
  k.internal_no,
  k.invoice_date,
  k.invoice_amount,
  k.site,
  k.payment_status,
  k.created_at,
  -- "1" is the oldest (created first); higher numbers are newer duplicates
  ROW_NUMBER() OVER (
    PARTITION BY k.vendor_key, k.invoice_no_key
    ORDER BY k.created_at ASC, k.id ASC
  )                                                 AS rank_oldest_first,
  -- Has any payment been recorded against this row?  Helps decide which to keep.
  EXISTS (
    SELECT 1 FROM payments p
    WHERE p.invoice_id = k.id AND p.deleted_at IS NULL
  )                                                 AS has_payments,
  -- Number of attachments — another signal of which row was actively used.
  (SELECT COUNT(*) FROM attachments a WHERE a.invoice_id = k.id) AS attachment_count
FROM keyed k
JOIN dupe_groups d
  ON d.vendor_key     = k.vendor_key
 AND d.invoice_no_key = k.invoice_no_key
ORDER BY k.vendor_name ASC, k.invoice_no_key ASC, k.created_at ASC;

-- ---------------------------------------------------------------------------
-- Summary counters: how many groups, how many rows total in those groups.
-- ---------------------------------------------------------------------------
SELECT
  COUNT(*) AS duplicate_groups,
  SUM(hit_count) AS total_rows_in_duplicate_groups,
  SUM(hit_count) - COUNT(*) AS rows_to_remove_if_keeping_oldest
FROM (
  SELECT
    COALESCE(i.vendor_id::text, LOWER(TRIM(i.vendor_name))) AS vendor_key,
    LOWER(TRIM(i.invoice_no)) AS invoice_no_key,
    COUNT(*) AS hit_count
  FROM invoices i
  WHERE i.deleted_at IS NULL
    AND i.invoice_no IS NOT NULL
    AND TRIM(i.invoice_no) <> ''
  GROUP BY vendor_key, invoice_no_key
  HAVING COUNT(*) > 1
) t;
