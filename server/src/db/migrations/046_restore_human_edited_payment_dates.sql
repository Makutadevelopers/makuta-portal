-- 046_restore_human_edited_payment_dates.sql
--
-- RULE (CLAUDE.md, 2026-05-20): a date a human typed/edited through the app is
-- the source of truth and outranks any repair migration's recovered value.
--
-- Repairs 040/042/043 recovered a payment_date by parsing the real cheque-stub
-- date out of the misfiled `payment_ref` column. In ~25 rows that overwrote a
-- payment_date that Kesav / Raju S had already corrected by hand (visible as an
-- 'Edited payment' audit entry whose metadata->'after'->>'payment_date' differs
-- from the live row). This migration restores each such payment_date to the
-- value in its LATEST 'Edited payment' audit row, and resyncs payment_month.
--
-- Scope is data-driven (NOT a hardcoded list): any payment whose current
-- payment_date differs from the date in its most recent 'Edited payment' audit
-- row. Only payment_date / payment_month are touched — bank / payment_type /
-- payment_ref keep the repair's normalisation (the hand-entered versions of
-- those were themselves the old scrambled format, e.g. type='Chq 000820').
--
-- Reversible: pre-restore rows are snapshotted to payments_repair_snapshot
-- under tag '046_restore_human_dates'. To roll a row back, copy payment_date /
-- payment_month from the snapshot for that payment_id + tag.
--
-- NOTE: runs inside the migrate.ts BEGIN/COMMIT, so the temp table and all
-- writes are one atomic unit.

CREATE TEMP TABLE _restore_targets ON COMMIT DROP AS
WITH latest_edit AS (
  SELECT DISTINCT ON (a.metadata->>'paymentId')
         (a.metadata->>'paymentId')::uuid                      AS payment_id,
         (left(a.metadata->'after'->>'payment_date', 10))::date AS human_date
  FROM audit_logs a
  WHERE a.action LIKE 'Edited payment%'
    AND a.metadata ? 'paymentId'
    AND a.metadata->'after'->>'payment_date' IS NOT NULL
  ORDER BY a.metadata->>'paymentId', a.created_at DESC
)
SELECT le.payment_id AS id, le.human_date
FROM latest_edit le
JOIN payments p ON p.id = le.payment_id
WHERE p.payment_date IS DISTINCT FROM le.human_date;

-- Snapshot the current (repair-written) state before we overwrite it.
INSERT INTO payments_repair_snapshot
  (repair_tag, payment_id, invoice_id, amount, payment_type, payment_ref,
   payment_date, bank, payment_month, batch_id, bank_txn_id, created_at)
SELECT '046_restore_human_dates', p.id, p.invoice_id, p.amount, p.payment_type,
       p.payment_ref, p.payment_date, p.bank, p.payment_month, p.batch_id,
       p.bank_txn_id, p.created_at
FROM payments p
JOIN _restore_targets t ON t.id = p.id;

-- Restore the human-entered date and resync the month bucket.
UPDATE payments p
SET payment_date  = t.human_date,
    payment_month = date_trunc('month', t.human_date)::date
FROM _restore_targets t
WHERE p.id = t.id;
