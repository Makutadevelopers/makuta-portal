-- Bulk-import corruption audit
-- Run order: D1 (overview) → D2-D5 (drill-downs). All queries are read-only.
--
-- Failure modes mapped here:
--   F1  payment_date silently inherited invoice_date when CSV Payment Date was unparseable
--   F1b bank column holds a "Apr-26"-style month string (was source's Payment Month)
--   F5  payment_ref starts with "IMPORT-" (synthetic placeholder, real ref was blank)
--   F6  payment_type is literal "Import" (default when source Payment Type was blank)
--   F7  payment_type contains digits (e.g. "Chq 000968" — type+ref smushed into one cell)
--
-- See server/src/controllers/import.controller.ts for the (now patched) sources
-- and the corresponding senior-manager analysis in the team-tracker.

-- ─────────────────────────────────────────────────────────────────────────
-- D1: Per-batch corruption fingerprint — the headline inventory
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  p.batch_id,
  MIN(p.created_at)::date AS imported_on,
  COUNT(*) AS total_payments,
  COUNT(*) FILTER (WHERE p.payment_ref ~ '^\s*\d{1,2}[-/\s][A-Za-z]{3}[-/\s]\d{2,4}\s*$') AS f1_ref_is_date,
  COUNT(*) FILTER (WHERE p.bank   ~ '^\s*[A-Za-z]{3,}[- ]?\d{2,4}\s*$')                AS f1b_bank_is_month,
  COUNT(*) FILTER (WHERE p.payment_date = i.invoice_date)                              AS f1c_paydate_eq_invdate,
  COUNT(*) FILTER (WHERE p.payment_ref LIKE 'IMPORT-%')                                AS f5_synthetic_ref,
  COUNT(*) FILTER (WHERE p.payment_type = 'Import')                                    AS f6_invalid_type,
  COUNT(*) FILTER (WHERE p.payment_type ~ '\d')                                        AS f7_type_has_digits
FROM payments p
JOIN invoices i ON i.id = p.invoice_id
WHERE p.batch_id IS NOT NULL
GROUP BY p.batch_id
ORDER BY imported_on DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- D2: Exact rows hit by the F1 date-fallback bug (highest-priority fix)
--     These are payments where payment_date == invoice_date AND the real
--     payment date is still recoverable from the payment_ref column.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  p.id, i.invoice_no, i.vendor_name, i.site, p.amount,
  i.invoice_date,
  p.payment_date AS stored_payment_date,
  p.payment_ref  AS suspect_real_date,
  p.bank         AS suspect_payment_month,
  p.payment_type,
  p.batch_id
FROM payments p
JOIN invoices i ON i.id = p.invoice_id
WHERE p.payment_date = i.invoice_date
  AND p.payment_ref ~ '^\s*\d{1,2}[-/\s][A-Za-z]{3}[-/\s]\d{2,4}\s*$'
ORDER BY p.batch_id, p.created_at;

-- ─────────────────────────────────────────────────────────────────────────
-- D3: Batches dominated by synthetic placeholders
--     If pct_synthetic is high, that batch's source CSV omitted Payment
--     Details entirely — meaning we have no real reference data to recover.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  p.batch_id,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE p.payment_ref LIKE 'IMPORT-%') AS synthetic_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE p.payment_ref LIKE 'IMPORT-%') / COUNT(*),
    1
  ) AS pct_synthetic
FROM payments p
WHERE p.batch_id IS NOT NULL
GROUP BY p.batch_id
HAVING COUNT(*) FILTER (WHERE p.payment_ref LIKE 'IMPORT-%') > 0
ORDER BY pct_synthetic DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- D4: Invoice-side: clusters of invoice_date = first-of-month (possible F3)
--     A normal month should have ~3% of invoices land on day 1. Batches
--     where day-1 dominates are likely victims of the Month-only fallback.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  batch_id,
  COUNT(*) AS total_in_batch,
  COUNT(*) FILTER (WHERE EXTRACT(DAY FROM invoice_date) = 1) AS day1_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE EXTRACT(DAY FROM invoice_date) = 1) / COUNT(*),
    1
  ) AS pct_day1
FROM invoices
WHERE batch_id IS NOT NULL
GROUP BY batch_id
HAVING COUNT(*) FILTER (WHERE EXTRACT(DAY FROM invoice_date) = 1) > 0
ORDER BY pct_day1 DESC
LIMIT 20;

-- ─────────────────────────────────────────────────────────────────────────
-- D5: bank_transactions that inherited the bug
--     The bank_transactions table denormalizes payment metadata, so F1
--     corruption flows here too. These need parallel repair.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  bt.id, bt.txn_ref, bt.bank, bt.txn_type, bt.txn_date, bt.txn_amount, bt.remarks
FROM bank_transactions bt
WHERE bt.bank ~ '^[A-Za-z]{3,}[- ]?\d{2,4}$'
   OR bt.txn_ref ~ '^\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}$'
ORDER BY bt.created_at DESC;
