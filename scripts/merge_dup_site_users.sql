-- merge_dup_site_users.sql
-- Run AFTER migration 021_user_multi_site.sql.
-- Collapses the duplicate site-accountant logins (Ramana / Madhu) into a
-- single login each that owns multiple sites, and re-attributes the rows
-- they created so history is preserved.
--
-- This file is NOT picked up by the seed runner — apply it manually on prod
-- inside a transaction. Email addresses are the join keys so this stays
-- deterministic regardless of how the rows were originally seeded.

BEGIN;

-- 1. Make sure the surviving accounts own the right sites.
UPDATE users SET sites = ARRAY['Nirvana', 'Aruna Arcade']
 WHERE email = 'raman@makuta.in' OR email = 'ramana@makuta.in';
UPDATE users SET sites = ARRAY['Horizon', 'Green Wood Villas']
 WHERE email = 'madhu@makuta.in';

-- 2. Re-attribute everything the duplicate accounts created.
WITH dup AS (
  SELECT u.id  AS dup_id,
         k.id  AS keep_id,
         u.email AS dup_email,
         k.email AS keep_email
    FROM users u
    JOIN users k ON (
       (u.email = 'ramana.aa@makuta.in' AND k.email = 'ramana@makuta.in')
    OR (u.email = 'madhu.gw@makuta.in'  AND k.email = 'madhu@makuta.in')
    )
)
SELECT * FROM dup;  -- preview — inspect before committing

UPDATE invoices                  SET created_by   = k.id FROM users u JOIN users k ON true WHERE invoices.created_by   = u.id AND ((u.email = 'ramana.aa@makuta.in' AND k.email = 'ramana@makuta.in') OR (u.email = 'madhu.gw@makuta.in' AND k.email = 'madhu@makuta.in'));
UPDATE invoices                  SET disputed_by  = k.id FROM users u JOIN users k ON true WHERE invoices.disputed_by  = u.id AND ((u.email = 'ramana.aa@makuta.in' AND k.email = 'ramana@makuta.in') OR (u.email = 'madhu.gw@makuta.in' AND k.email = 'madhu@makuta.in'));
UPDATE payments                  SET recorded_by  = k.id FROM users u JOIN users k ON true WHERE payments.recorded_by  = u.id AND ((u.email = 'ramana.aa@makuta.in' AND k.email = 'ramana@makuta.in') OR (u.email = 'madhu.gw@makuta.in' AND k.email = 'madhu@makuta.in'));
UPDATE attachments               SET uploaded_by  = k.id FROM users u JOIN users k ON true WHERE attachments.uploaded_by = u.id AND ((u.email = 'ramana.aa@makuta.in' AND k.email = 'ramana@makuta.in') OR (u.email = 'madhu.gw@makuta.in' AND k.email = 'madhu@makuta.in'));
UPDATE audit_log                 SET user_id      = k.id FROM users u JOIN users k ON true WHERE audit_log.user_id      = u.id AND ((u.email = 'ramana.aa@makuta.in' AND k.email = 'ramana@makuta.in') OR (u.email = 'madhu.gw@makuta.in' AND k.email = 'madhu@makuta.in'));
UPDATE petty_cash_disbursements  SET given_by     = k.id FROM users u JOIN users k ON true WHERE petty_cash_disbursements.given_by  = u.id AND ((u.email = 'ramana.aa@makuta.in' AND k.email = 'ramana@makuta.in') OR (u.email = 'madhu.gw@makuta.in' AND k.email = 'madhu@makuta.in'));
UPDATE petty_cash_expenses       SET recorded_by  = k.id FROM users u JOIN users k ON true WHERE petty_cash_expenses.recorded_by  = u.id AND ((u.email = 'ramana.aa@makuta.in' AND k.email = 'ramana@makuta.in') OR (u.email = 'madhu.gw@makuta.in' AND k.email = 'madhu@makuta.in'));
UPDATE credit_notes              SET created_by   = k.id FROM users u JOIN users k ON true WHERE credit_notes.created_by  = u.id AND ((u.email = 'ramana.aa@makuta.in' AND k.email = 'ramana@makuta.in') OR (u.email = 'madhu.gw@makuta.in' AND k.email = 'madhu@makuta.in'));

-- 3. Drop the now-empty duplicate accounts so they can no longer log in.
DELETE FROM users
 WHERE email IN ('ramana.aa@makuta.in', 'madhu.gw@makuta.in');

-- 4. Verify before committing — should return the consolidated rows with both
-- sites populated and no duplicates remaining.
SELECT email, role, sites FROM users
 WHERE email IN ('ramana@makuta.in', 'madhu@makuta.in', 'ramana.aa@makuta.in', 'madhu.gw@makuta.in')
 ORDER BY email;

-- COMMIT;  -- uncomment after verifying step 4
-- ROLLBACK;
