-- 055_add_petty_cash_limit_to_sites.sql
-- Lets HO configure a per-project cap on how much a site accountant can pay
-- from petty cash in one go. Previously this was a single hardcoded ₹50,000
-- for every project. NULL means "use the ₹50,000 default" — existing
-- projects need no backfill.
ALTER TABLE sites ADD COLUMN petty_cash_payment_limit NUMERIC(14,2);
