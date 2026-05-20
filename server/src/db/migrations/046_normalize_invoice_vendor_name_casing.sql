-- Snap every invoice's denormalised vendor_name onto its Vendor Master casing.
--
-- Background: invoices.vendor_name is a denormalised TEXT copy of the vendor's
-- canonical name (vendors.name). Cashflow/Expenditure groups by this raw text
-- column (cashflow.controller.ts), and PostgreSQL's UNIQUE on vendors.name is
-- case-sensitive, so a single vendor whose invoices were stored under different
-- casings ("ROBO SILICON PRIVATE LIMITED" vs "Robo Silicon Private Limited" --
-- typically from bulk imports writing the CSV's verbatim text) splits into two
-- rows in Cashflow even though Vendor Master folds them into one (it groups by
-- vendor_id with a lowercased-name fallback).
--
-- This is a one-time backfill that snaps every affected invoice's vendor_name
-- onto its vendor's canonical master casing, so vendor-level reports stop
-- splitting one vendor's spend across casing variants. It is the vendor_name
-- twin of migration 044 (which did the same for purpose <- vendor.category).
--
-- Safety:
--   * Only casing/whitespace differences are touched -- the lower/trim'd name
--     is never changed, so we never re-point an invoice to a DIFFERENT vendor.
--   * Every changed row is snapshotted into invoice_vendor_name_snapshot first,
--     so the change can be reverted (same pattern as payments_repair_snapshot
--     and invoice_purpose_snapshot, migrations 033+ / 044).
--   * Pass 2 (name-only legacy rows) only touches invoices with NO vendor_id,
--     and only when the (case/space-normalised) vendor name maps to exactly ONE
--     master vendor -- ambiguous collisions are left untouched and should be
--     resolved with Vendor Master -> Merge instead.

-- ── Rollback-insurance snapshot ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_vendor_name_snapshot (
  snapshot_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  repair_tag       TEXT NOT NULL,
  invoice_id       UUID NOT NULL,
  old_vendor_name  TEXT,
  new_vendor_name  TEXT,
  old_vendor_id    UUID,
  new_vendor_id    UUID,
  match_kind       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_vendor_name_snapshot_invoice
  ON invoice_vendor_name_snapshot(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_vendor_name_snapshot_tag
  ON invoice_vendor_name_snapshot(repair_tag);

-- ── Pass 1: vendor_id-linked invoices -- sync vendor_name to master casing ──
WITH targets AS (
  SELECT i.id,
         i.vendor_name AS old_vendor_name,
         v.name        AS new_vendor_name
  FROM invoices i
  JOIN vendors v ON v.id = i.vendor_id
  WHERE i.deleted_at IS NULL
    AND i.vendor_name IS DISTINCT FROM v.name
),
snap AS (
  INSERT INTO invoice_vendor_name_snapshot
    (repair_tag, invoice_id, old_vendor_name, new_vendor_name, old_vendor_id, new_vendor_id, match_kind)
  SELECT '046_normalize_vendor_name', id, old_vendor_name, new_vendor_name, NULL, NULL, 'vendor_id'
  FROM targets
)
UPDATE invoices i
SET vendor_name = t.new_vendor_name, updated_at = NOW()
FROM targets t
WHERE i.id = t.id;

-- ── Pass 2: legacy invoices linked only by vendor_name (no vendor_id) ───────
WITH name_map AS (
  -- Collapse vendor names case/space-insensitively; only keep names that map
  -- to a single master vendor (skip case-duplicate collisions for Merge).
  SELECT LOWER(TRIM(v.name))    AS nkey,
         MIN(v.name)            AS canonical_name,
         (ARRAY_AGG(v.id))[1]   AS vendor_id,
         COUNT(*)               AS n
  FROM vendors v
  GROUP BY LOWER(TRIM(v.name))
  HAVING COUNT(*) = 1
),
targets AS (
  SELECT i.id,
         i.vendor_name      AS old_vendor_name,
         nm.canonical_name  AS new_vendor_name,
         nm.vendor_id       AS new_vendor_id
  FROM invoices i
  JOIN name_map nm ON nm.nkey = LOWER(TRIM(i.vendor_name))
  WHERE i.deleted_at IS NULL
    AND i.vendor_id IS NULL
    AND i.vendor_name IS DISTINCT FROM nm.canonical_name
),
snap AS (
  INSERT INTO invoice_vendor_name_snapshot
    (repair_tag, invoice_id, old_vendor_name, new_vendor_name, old_vendor_id, new_vendor_id, match_kind)
  SELECT '046_normalize_vendor_name', id, old_vendor_name, new_vendor_name, NULL, new_vendor_id, 'vendor_name'
  FROM targets
)
UPDATE invoices i
SET vendor_name = t.new_vendor_name, vendor_id = t.new_vendor_id, updated_at = NOW()
FROM targets t
WHERE i.id = t.id;

-- ── Visibility: print what changed into the migration log ──────────────────
DO $$
DECLARE
  n_id   INTEGER;
  n_name INTEGER;
BEGIN
  SELECT COUNT(*) INTO n_id
    FROM invoice_vendor_name_snapshot
    WHERE repair_tag = '046_normalize_vendor_name' AND match_kind = 'vendor_id';
  SELECT COUNT(*) INTO n_name
    FROM invoice_vendor_name_snapshot
    WHERE repair_tag = '046_normalize_vendor_name' AND match_kind = 'vendor_name';
  RAISE NOTICE '046_normalize_vendor_name: % invoice(s) snapped via vendor_id, % via vendor_name (% total)',
    n_id, n_name, n_id + n_name;
END $$;
