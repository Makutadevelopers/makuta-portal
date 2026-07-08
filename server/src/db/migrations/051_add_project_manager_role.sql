-- 051_add_project_manager_role.sql
--
-- Adds the 'project_manager' role.
--
-- A project manager is a READ-ONLY, multi-site expenditure viewer: like an HO
-- they see full amounts + aging, but like a site accountant their view is
-- filtered to their assigned sites[] only. They have no write access of any
-- kind (no invoices, payments, petty cash, vendors or credit notes).
--
-- Multi-site assignment reuses the existing users.sites TEXT[] column
-- (migration 018) — no new column needed.
--
-- The role CHECK constraint on users was created inline & unnamed in
-- 001_create_users.sql, so Postgres auto-named it `users_role_check`. We drop
-- and re-create it here to widen the allowed set. Migrations are append-only,
-- so this cannot be done by editing 001.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('ho', 'site', 'mgmt', 'project_manager'));
