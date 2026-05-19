-- Create a rollback-insurance snapshot table for bulk-import data-quality
-- repair work tracked in server/src/db/diagnostics/2026-05-19_import_corruption_audit.sql.
--
-- Every UPDATE statement that fixes corrupted import data should first INSERT
-- the affected rows into this table so we can revert if the repair logic
-- itself turns out to be wrong (we learned this lesson the expensive way with
-- 031_fix_batch_90209c92_dates.sql, which had no escape hatch).
--
-- This migration only creates the table — repair migrations (034+) populate
-- it and then UPDATE the live rows.

CREATE TABLE IF NOT EXISTS payments_repair_snapshot (
  snapshot_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  repair_tag    TEXT NOT NULL,
  payment_id    UUID NOT NULL,
  invoice_id    UUID,
  amount        NUMERIC(14,2),
  payment_type  TEXT,
  payment_ref   TEXT,
  payment_date  DATE,
  bank          TEXT,
  payment_month DATE,
  batch_id      UUID,
  bank_txn_id   UUID,
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payments_repair_payment ON payments_repair_snapshot(payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_repair_tag     ON payments_repair_snapshot(repair_tag);
