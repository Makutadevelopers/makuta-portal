-- Tracks every vendor merge so it can be reverted.  We don't soft-delete the
-- removed vendor (existing queries don't filter by deleted_at and would have
-- to be touched everywhere) — instead, we snapshot the removed vendor's row
-- as JSONB plus the per-invoice changes the merge made.  Revert re-creates
-- the removed vendor with its original UUID and restores each invoice's
-- vendor_id / vendor_name from the snapshot.

CREATE TABLE IF NOT EXISTS vendor_merges (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kept_vendor_id           UUID NOT NULL,
  removed_vendor_id        UUID NOT NULL,
  removed_vendor_snapshot  JSONB NOT NULL,
  invoice_changes          JSONB NOT NULL DEFAULT '[]'::jsonb,
  merged_by                UUID REFERENCES users(id) ON DELETE SET NULL,
  merged_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reverted_at              TIMESTAMPTZ,
  reverted_by              UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Active (non-reverted) merges, newest first — the typical query for the
-- "Recent merges / Revert" UI.
CREATE INDEX IF NOT EXISTS idx_vendor_merges_active
  ON vendor_merges(merged_at DESC)
  WHERE reverted_at IS NULL;

-- Per-user lookup so site accountants can find the merges they did.
CREATE INDEX IF NOT EXISTS idx_vendor_merges_merged_by
  ON vendor_merges(merged_by);
