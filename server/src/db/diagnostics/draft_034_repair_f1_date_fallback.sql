-- Repair payments corrupted by the F1 silent-date-fallback bug in the bulk
-- importer. Before the fix in import.controller.ts, a row whose source CSV
-- had a Payment Date the parser couldn't read silently fell back to the
-- invoice_date — and the *real* payment date string was already sitting in
-- the next column over, which ended up in payment_ref. The bank column got
-- the source's Payment Month text (e.g. "Apr-26") instead of a real bank
-- name. See server/src/db/diagnostics/2026-05-19_import_corruption_audit.sql
-- for the full failure-mode catalogue.
--
-- Strategy: snapshot the affected rows first, then UPDATE in place using the
-- string sitting in payment_ref as the recovered date. The bank field is
-- unrecoverable from in-DB data alone (it holds a month, not a bank); we
-- null it so reports stop pretending we have it. HO can re-enter bank
-- per-row from the source spreadsheets or derive it from the cheque series.
--
-- After this migration runs, the application's POST /api/recompute-statuses
-- endpoint should be triggered (HO role) so invoices.payment_status reflects
-- the corrected payment dates / amounts.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Snapshot every payment that matches the F1 fingerprint, before any
--    UPDATE touches them.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO payments_repair_snapshot (
  repair_tag, payment_id, invoice_id, amount, payment_type, payment_ref,
  payment_date, bank, payment_month, batch_id, bank_txn_id, created_at, updated_at
)
SELECT
  '034_F1_date_fallback',
  p.id, p.invoice_id, p.amount, p.payment_type, p.payment_ref,
  p.payment_date, p.bank, p.payment_month, p.batch_id, p.bank_txn_id,
  p.created_at, p.updated_at
FROM payments p
JOIN invoices i ON i.id = p.invoice_id
WHERE p.payment_date = i.invoice_date
  AND p.payment_ref ~ '^\s*\d{1,2}[-/\s][A-Za-z]{3}[-/\s]\d{2,4}\s*$';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Repair: parse the real date out of payment_ref, normalize the
--    payment_type that has the cheque number appended ("Chq 000968" →
--    type="Cheque", ref="000968"), and null the bank field which we know
--    holds a month string.
-- ─────────────────────────────────────────────────────────────────────────
WITH parsed AS (
  SELECT
    p.id,
    -- "24-Apr-26", "24/Apr/26", "24 Apr 26" → 2026-04-24
    to_date(
      regexp_replace(trim(p.payment_ref), '[/\s]', '-', 'g'),
      'DD-Mon-YY'
    ) AS real_payment_date,
    -- Split "Chq 000968" → type prefix + numeric ref
    split_part(trim(p.payment_type), ' ', 1) AS type_prefix,
    NULLIF(
      btrim(substring(p.payment_type FROM '\s+(.+)$')),
      ''
    ) AS extracted_ref
  FROM payments p
  JOIN invoices i ON i.id = p.invoice_id
  WHERE p.payment_date = i.invoice_date
    AND p.payment_ref ~ '^\s*\d{1,2}[-/\s][A-Za-z]{3}[-/\s]\d{2,4}\s*$'
)
UPDATE payments p
SET
  payment_date  = parsed.real_payment_date,
  payment_ref   = parsed.extracted_ref,
  payment_type  = CASE LOWER(parsed.type_prefix)
                    WHEN 'chq'    THEN 'Cheque'
                    WHEN 'cheque' THEN 'Cheque'
                    WHEN 'neft'   THEN 'NEFT'
                    WHEN 'rtgs'   THEN 'RTGS'
                    WHEN 'imps'   THEN 'IMPS'
                    WHEN 'upi'    THEN 'UPI'
                    WHEN 'cash'   THEN 'Cash'
                    ELSE p.payment_type   -- leave unfamiliar prefixes intact for manual review
                  END,
  bank          = NULL,
  payment_month = (date_trunc('month', parsed.real_payment_date))::date,
  updated_at    = NOW()
FROM parsed
WHERE p.id = parsed.id;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Parallel repair for bank_transactions, which denormalize payment
--    metadata and inherited the same bug for any non-Cash payment.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE bank_transactions bt
SET
  txn_date  = COALESCE(
    to_date(regexp_replace(trim(bt.txn_ref), '[/\s]', '-', 'g'), 'DD-Mon-YY'),
    bt.txn_date
  ),
  txn_ref   = NULL,
  bank      = NULL
WHERE bt.txn_ref ~ '^\s*\d{1,2}[-/\s][A-Za-z]{3}[-/\s]\d{2,4}\s*$';

-- NOTE: This migration only repairs the *rows*. The denormalized
-- invoices.payment_status / total_paid / days_past_due fields recompute via
-- POST /api/recompute-statuses (HO role). Run that immediately after this
-- migration deploys so dashboards reflect the corrected dates.
