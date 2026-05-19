-- Repair payments where payment_type contains digits — the F7 failure mode
-- catalogued in server/src/db/diagnostics/2026-05-19_import_corruption_audit.sql.
--
-- Symptom: an old import wrote values like "Chq 000968" into payments.payment_type
-- (type + cheque number smushed into one cell) instead of "Cheque" with the
-- number in payment_ref. The Edit Payment dropdown couldn't match "Chq 000968"
-- against its options, so opening the editor and clicking Save silently
-- re-persisted the corrupted string.
--
-- Strategy:
--   1. Snapshot every affected row into payments_repair_snapshot (rollback insurance).
--   2. Parse the type prefix → canonical PAYMENT_TYPE; recover the trailing
--      token into payment_ref only when payment_ref is currently empty
--      (don't clobber a real reference if one already exists).
--   3. Leave payment_date / bank / amount untouched — F7 is type-only.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. Snapshot
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO payments_repair_snapshot (
  repair_tag, payment_id, invoice_id, amount, payment_type, payment_ref,
  payment_date, bank, payment_month, batch_id, bank_txn_id, created_at, updated_at
)
SELECT
  '034_F7_type_has_digits',
  p.id, p.invoice_id, p.amount, p.payment_type, p.payment_ref,
  p.payment_date, p.bank, p.payment_month, p.batch_id, p.bank_txn_id,
  p.created_at, p.updated_at
FROM payments p
WHERE p.payment_type ~ '\d';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Repair
-- ─────────────────────────────────────────────────────────────────────────
WITH parsed AS (
  SELECT
    id,
    LOWER(split_part(trim(payment_type), ' ', 1)) AS type_prefix,
    NULLIF(btrim(substring(payment_type FROM '\s+(.+)$')), '') AS extracted_ref
  FROM payments
  WHERE payment_type ~ '\d'
)
UPDATE payments p
SET
  payment_type = CASE parsed.type_prefix
                   WHEN 'chq'    THEN 'Cheque'
                   WHEN 'cheque' THEN 'Cheque'
                   WHEN 'neft'   THEN 'NEFT'
                   WHEN 'rtgs'   THEN 'RTGS'
                   WHEN 'imps'   THEN 'IMPS'
                   WHEN 'upi'    THEN 'UPI'
                   WHEN 'cash'   THEN 'Cash'
                   ELSE p.payment_type    -- leave unfamiliar prefixes for manual review
                 END,
  payment_ref  = COALESCE(NULLIF(btrim(p.payment_ref), ''), parsed.extracted_ref),
  updated_at   = NOW()
FROM parsed
WHERE p.id = parsed.id
  AND parsed.type_prefix IN ('chq', 'cheque', 'neft', 'rtgs', 'imps', 'upi', 'cash');
