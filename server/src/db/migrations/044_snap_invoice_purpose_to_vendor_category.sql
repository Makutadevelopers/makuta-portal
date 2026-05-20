-- Consolidate each vendor's invoice categories onto its single Vendor Master
-- category.
--
-- Background: vendors.category is a single TEXT column, but invoice.purpose is
-- a denormalised per-invoice copy of it. Over time a single vendor accumulated
-- invoices carrying DIFFERENT purpose values ("multiple categories per
-- vendor") for various reasons:
--   * invoices entered before the vendor existed in Vendor Master;
--   * bulk imports writing the CSV's own Category/Purpose column verbatim;
--   * a vendor's master category being edited AFTER invoices were created --
--     the edit-cascade in vendor.service.ts only re-points vendor_id-linked,
--     live rows, leaving legacy/unlinked rows stale.
--
-- This is a one-time backfill that snaps every affected invoice's purpose onto
-- its vendor's master category, so category-level reports stop splitting one
-- vendor's spend across several buckets. It mirrors the cascade in
-- updateVendor() (server/src/services/vendor.service.ts) but applies it across
-- the whole table, and additionally covers legacy rows linked only by
-- vendor_name (not vendor_id).
--
-- Safety:
--   * Vendors with a NULL/blank master category are SKIPPED -- there is
--     nothing to snap to, and we never wipe purpose to null.
--   * Every changed row is snapshotted into invoice_purpose_snapshot first, so
--     the change can be reverted if the consolidation turns out wrong (same
--     pattern as payments_repair_snapshot, migrations 033+).
--   * Pass 2 (name-only legacy rows) only touches invoices with NO vendor_id,
--     and only when the (case/space-normalised) vendor name maps to exactly
--     ONE master category -- ambiguous names are left untouched.

-- ── Rollback-insurance snapshot ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_purpose_snapshot (
  snapshot_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  repair_tag   TEXT NOT NULL,
  invoice_id   UUID NOT NULL,
  old_purpose  TEXT,
  new_purpose  TEXT,
  match_kind   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_purpose_snapshot_invoice
  ON invoice_purpose_snapshot(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_purpose_snapshot_tag
  ON invoice_purpose_snapshot(repair_tag);

-- ── Pass 1: vendor_id-linked live invoices ─────────────────────────────────
WITH targets AS (
  SELECT i.id,
         i.purpose   AS old_purpose,
         TRIM(v.category) AS new_purpose
  FROM invoices i
  JOIN vendors v ON v.id = i.vendor_id
  WHERE i.deleted_at IS NULL
    AND v.category IS NOT NULL
    AND TRIM(v.category) <> ''
    AND i.purpose IS DISTINCT FROM TRIM(v.category)
),
snap AS (
  INSERT INTO invoice_purpose_snapshot
    (repair_tag, invoice_id, old_purpose, new_purpose, match_kind)
  SELECT '044_snap_purpose', id, old_purpose, new_purpose, 'vendor_id'
  FROM targets
)
UPDATE invoices i
SET purpose = t.new_purpose, updated_at = NOW()
FROM targets t
WHERE i.id = t.id;

-- ── Pass 2: legacy invoices linked only by vendor_name (no vendor_id) ───────
WITH name_map AS (
  -- Collapse vendor names case/space-insensitively; only keep names that map
  -- to a single non-blank master category (skip ambiguous collisions).
  SELECT LOWER(TRIM(v.name))      AS nkey,
         MIN(TRIM(v.category))    AS category,
         COUNT(DISTINCT TRIM(v.category)) AS cat_variants
  FROM vendors v
  WHERE v.category IS NOT NULL AND TRIM(v.category) <> ''
  GROUP BY LOWER(TRIM(v.name))
),
targets AS (
  SELECT i.id,
         i.purpose   AS old_purpose,
         nm.category AS new_purpose
  FROM invoices i
  JOIN name_map nm ON nm.nkey = LOWER(TRIM(i.vendor_name))
  WHERE i.deleted_at IS NULL
    AND i.vendor_id IS NULL
    AND nm.cat_variants = 1
    AND i.purpose IS DISTINCT FROM nm.category
),
snap AS (
  INSERT INTO invoice_purpose_snapshot
    (repair_tag, invoice_id, old_purpose, new_purpose, match_kind)
  SELECT '044_snap_purpose', id, old_purpose, new_purpose, 'vendor_name'
  FROM targets
)
UPDATE invoices i
SET purpose = t.new_purpose, updated_at = NOW()
FROM targets t
WHERE i.id = t.id;

-- ── Visibility: print what changed into the migration log ──────────────────
DO $$
DECLARE
  n_id   INTEGER;
  n_name INTEGER;
BEGIN
  SELECT COUNT(*) INTO n_id
    FROM invoice_purpose_snapshot
    WHERE repair_tag = '044_snap_purpose' AND match_kind = 'vendor_id';
  SELECT COUNT(*) INTO n_name
    FROM invoice_purpose_snapshot
    WHERE repair_tag = '044_snap_purpose' AND match_kind = 'vendor_name';
  RAISE NOTICE '044_snap_purpose: % invoice(s) snapped via vendor_id, % via vendor_name (% total)',
    n_id, n_name, n_id + n_name;
END $$;
