-- 021_user_multi_site.sql
-- Allow one user to own multiple sites (e.g. Ramana handles Nirvana + Aruna
-- Arcade, Madhu handles Horizon + Green Wood Villas). Replaces the single
-- `site TEXT` column with `sites TEXT[]`.
--
-- Backfill keeps existing rows working: a single-site user becomes a 1-element
-- array. Account merges (collapsing duplicate logins for the same person)
-- are NOT done here — they touch invoice/payment/audit FK references and
-- should be run as a separate, reviewed data migration on production.

ALTER TABLE users ADD COLUMN sites TEXT[] NOT NULL DEFAULT '{}';

UPDATE users
   SET sites = ARRAY[site]
 WHERE site IS NOT NULL AND site <> '';

ALTER TABLE users DROP COLUMN site;
