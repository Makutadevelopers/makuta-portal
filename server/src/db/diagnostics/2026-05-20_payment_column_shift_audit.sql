-- 2026-05-20_payment_column_shift_audit.sql
-- READ-ONLY. Measures the scope of the "column-shift" corruption seen on
-- cheque 000968 / batch 5fdcc961, where the old (pre-2026-05-19) importer wrote:
--     payment date  -> payment_ref   (e.g. ref "24-Apr-26")
--     payment month -> bank          (e.g. bank "Apr-26")
--     invoice date  -> payment_date  (real payment date lost)
-- and left some bank payments with a blank reference / bank entirely.
--
-- Proven by invoice #5544's activity log:
--   "ref 24-Apr-26 -> 000968 · date Tue Jan 13 -> Fri Apr 24 · bank Apr-26 -> HDFC"
--
-- Run on RDS (psql) before deciding on a repair. Nothing here mutates data.
-- ============================================================================

-- A. Headline counts per fingerprint -----------------------------------------
SELECT 'A. fingerprint summary' AS section;

WITH flagged AS (
  SELECT
    p.id,
    p.payment_type,
    -- ref holds a date instead of a cheque no / UTR
    (p.payment_ref ~ '^\s*\d{1,2}-[A-Za-z]{3,}-\d{2,4}\s*$'
       OR p.payment_ref ~ '^\s*\d{4}-\d{2}-\d{2}\s*$'
       OR p.payment_ref ~ '^\s*\d{1,2}/\d{1,2}/\d{2,4}\s*$')           AS ref_is_date,
    -- bank holds a "Mon-YY" / "Mon-YYYY" month token instead of a bank name
    (p.bank ~* '^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[- ]?\d{2,4}\s*$') AS bank_is_month,
    -- non-cash payment with no reference at all (the blank #5422 case)
    (lower(COALESCE(p.payment_type,'')) <> 'cash'
       AND COALESCE(NULLIF(trim(p.payment_ref), ''), NULL) IS NULL)    AS bank_no_ref,
    -- payment_date equals the invoice date (classic date fallback)
    (p.payment_date = i.invoice_date)                                  AS paydate_eq_invdate
  FROM payments p
  JOIN invoices i ON i.id = p.invoice_id
)
SELECT
  COUNT(*) FILTER (WHERE ref_is_date)        AS ref_is_date,
  COUNT(*) FILTER (WHERE bank_is_month)      AS bank_is_month,
  COUNT(*) FILTER (WHERE bank_no_ref)        AS bank_payment_no_ref,
  COUNT(*) FILTER (WHERE paydate_eq_invdate) AS paydate_eq_invdate,
  COUNT(*) FILTER (WHERE ref_is_date OR bank_is_month OR bank_no_ref) AS any_shift_fingerprint,
  COUNT(*)                                   AS total_payments
FROM flagged;

-- B. Per-batch breakdown of the shift fingerprint ----------------------------
--    (payments don't carry batch_id on the main import path, so attribute via
--     the invoice's batch_id; NULL = manually-entered / pre-batch rows)
SELECT 'B. per-batch breakdown' AS section;

SELECT
  i.batch_id,
  COUNT(*) AS payments,
  COUNT(*) FILTER (WHERE p.payment_ref ~ '^\s*\d{1,2}-[A-Za-z]{3,}-\d{2,4}\s*$'
                      OR p.payment_ref ~ '^\s*\d{4}-\d{2}-\d{2}\s*$'
                      OR p.payment_ref ~ '^\s*\d{1,2}/\d{1,2}/\d{2,4}\s*$') AS ref_is_date,
  COUNT(*) FILTER (WHERE p.bank ~* '^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[- ]?\d{2,4}\s*$') AS bank_is_month,
  COUNT(*) FILTER (WHERE lower(COALESCE(p.payment_type,'')) <> 'cash'
                      AND COALESCE(NULLIF(trim(p.payment_ref), ''), NULL) IS NULL) AS bank_no_ref,
  MIN(p.created_at)::date AS first_created,
  MAX(p.created_at)::date AS last_created
FROM payments p
JOIN invoices i ON i.id = p.invoice_id
GROUP BY i.batch_id
HAVING COUNT(*) FILTER (WHERE
        p.payment_ref ~ '^\s*\d{1,2}-[A-Za-z]{3,}-\d{2,4}\s*$'
     OR p.payment_ref ~ '^\s*\d{4}-\d{2}-\d{2}\s*$'
     OR p.bank ~* '^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[- ]?\d{2,4}\s*$'
     OR (lower(COALESCE(p.payment_type,'')) <> 'cash' AND NULLIF(trim(p.payment_ref),'') IS NULL)
   ) > 0
ORDER BY ref_is_date + bank_is_month + bank_no_ref DESC;

-- C. Cross-type orphan duplicate bank_transactions ---------------------------
--    (the row-6 case: a NEFT/HDFC txn with 0 invoices that mirrors a linked
--     Cheque txn of the same amount+date — migration 038 only caught exact
--     txn_ref+bank+amount matches, so these slipped through.)
SELECT 'C. cross-type orphan duplicate cheques' AS section;

WITH bt_alloc AS (
  SELECT bt.*, COUNT(p.id) AS pay_count
  FROM bank_transactions bt
  LEFT JOIN payments p ON p.bank_txn_id = bt.id
  GROUP BY bt.id
)
SELECT o.id AS orphan_txn_id, o.txn_type AS orphan_type, o.txn_ref AS orphan_ref,
       o.bank AS orphan_bank, o.txn_amount, o.txn_date,
       l.id AS linked_txn_id, l.txn_type AS linked_type, l.txn_ref AS linked_ref,
       l.bank AS linked_bank
FROM bt_alloc o
JOIN bt_alloc l
  ON l.txn_amount = o.txn_amount
 AND l.txn_date   = o.txn_date
 AND l.id <> o.id
 AND l.pay_count > 0
WHERE o.pay_count = 0
ORDER BY o.txn_amount DESC;

-- D. The reference case: cheque 000968 / batch 5fdcc961 ----------------------
SELECT 'D. cheque 000968 detail' AS section;

SELECT p.id AS payment_id, i.invoice_no, i.internal_no, i.vendor_name,
       p.amount, p.payment_type, p.payment_ref, p.bank, p.payment_date,
       i.invoice_date, p.payment_month, p.bank_txn_id, i.batch_id
FROM payments p
JOIN invoices i ON i.id = p.invoice_id
WHERE p.bank_txn_id IN (
        SELECT id FROM bank_transactions
        WHERE txn_ref ILIKE '%000968%' OR remarks ILIKE '%5fdcc961%'
      )
   OR i.batch_id = (SELECT batch_id FROM invoices WHERE internal_no = 'MKT-04008')
ORDER BY i.invoice_no;
