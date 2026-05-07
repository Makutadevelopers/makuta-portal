-- 018_add_users_sites_array.sql
-- Allows a user (typically a site accountant) to be assigned to multiple sites.
-- The legacy `site` column is kept as a "primary site" (= sites[1]) for any
-- code path that still expects a single string; `sites` is the source of truth
-- for permission checks going forward.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sites TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: copy the existing single `site` into the array for site accountants
UPDATE users
   SET sites = ARRAY[site]
 WHERE site IS NOT NULL
   AND sites = '{}';

CREATE INDEX IF NOT EXISTS idx_users_sites ON users USING GIN (sites);
