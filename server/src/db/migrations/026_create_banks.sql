-- 026_create_banks.sql
-- Moves the bank dropdown out of the static BANKS array in
-- client/src/utils/constants.ts and into a database table so HO can add a
-- new bank from the UI without a deploy. Names are compared
-- case-insensitively (UNIQUE INDEX ON LOWER(name)) so "HDFC", "Hdfc" and
-- "hdfc" collapse to a single row. Banks are never hard-deleted — HO
-- toggles `active = FALSE` to hide an unused bank from new payment
-- dropdowns without invalidating historical payments referencing its name.

CREATE TABLE IF NOT EXISTS banks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_banks_name_lower
  ON banks (LOWER(name));

-- Seed with the existing static BANKS list so the dropdown is identical to
-- today's behaviour at deploy time. Future banks get added via the
-- Bank Master page (POST /api/banks).
INSERT INTO banks (name) VALUES
  ('HDFC'), ('SBI'), ('ICICI'), ('Axis'), ('Kotak'), ('Yes Bank'), ('Canara')
ON CONFLICT DO NOTHING;
