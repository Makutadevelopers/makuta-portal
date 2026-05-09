-- Stores HO-confirmed "these two vendors are NOT duplicates" decisions so the
-- "Possible Duplicate Vendors" panel on the Dashboard does not keep
-- resurfacing the same pair on every refresh.
--
-- Pair is stored canonically (vendor_a_id < vendor_b_id) so we can look it up
-- without UNION/OR. CASCADE on vendor delete means a merge automatically
-- cleans up rows referencing the removed vendor.

CREATE TABLE IF NOT EXISTS vendor_dedup_dismissed (
  vendor_a_id   UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  vendor_b_id   UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  dismissed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vendor_a_id, vendor_b_id),
  CHECK (vendor_a_id < vendor_b_id)
);
