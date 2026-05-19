-- Repair payments where payment_date got stuck at the 2001-01-01 sentinel
-- (F8 in the import-corruption audit). Mechanically identical to F1 (see
-- 035_repair_f1_date_fallback.sql) except the failed-parse fallback wrote
-- 2001-01-01 to payment_date instead of inheriting invoice_date.
--
-- Likely upstream cause: the source spreadsheet's Payment Date cell held
-- either Excel serial 36892 or the literal string "01-01-01". Both pass
-- parseDate cleanly:
--   - serial 36892 → 2001-01-01 (Excel epoch + 36892 days, accounting for
--     the 1900 leap-year bug, hits exactly 01 Jan 2001)
--   - "01-01-01" → year < 50 rule converts the 2-digit year to 2001
-- The *real* payment date string ("21-Mar-25") ended up in payment_ref
-- and the Payment Month string ("Mar-25") ended up in bank — same shape
-- as F1, so the same repair logic applies.
--
-- Snapshot tag: 036_F8_epoch_sentinel in payments_repair_snapshot. Pass 1
-- recovers dates only; payment_type is left to migration 034's prefix
-- cleanup and any remaining manual work.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Snapshot
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO payments_repair_snapshot (
  repair_tag, payment_id, invoice_id, amount, payment_type, payment_ref,
  payment_date, bank, payment_month, batch_id, bank_txn_id, created_at
)
SELECT
  '036_F8_epoch_sentinel',
  p.id, p.invoice_id, p.amount, p.payment_type, p.payment_ref,
  p.payment_date, p.bank, p.payment_month, p.batch_id, p.bank_txn_id,
  p.created_at
FROM payments p
WHERE p.payment_date = DATE '2001-01-01'
  AND p.payment_ref ~ '^\s*\d{1,2}[-/\s][A-Za-z]{3}[-/\s]\d{2,4}\s*$';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Repair payments
-- ─────────────────────────────────────────────────────────────────────────
WITH parsed AS (
  SELECT
    p.id,
    to_date(
      regexp_replace(trim(p.payment_ref), '[/\s]', '-', 'g'),
      'DD-Mon-YY'
    ) AS real_payment_date
  FROM payments p
  WHERE p.payment_date = DATE '2001-01-01'
    AND p.payment_ref ~ '^\s*\d{1,2}[-/\s][A-Za-z]{3}[-/\s]\d{2,4}\s*$'
)
UPDATE payments p
SET
  payment_date  = parsed.real_payment_date,
  payment_month = (date_trunc('month', parsed.real_payment_date))::date,
  payment_ref   = NULL,
  bank          = NULL
FROM parsed
WHERE p.id = parsed.id;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Parallel repair for bank_transactions where the same bug fired.
--    Filter by exact txn_date sentinel + date-pattern txn_ref so we don't
--    crash to_date() on unrelated rows.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE bank_transactions bt
SET
  txn_date = to_date(regexp_replace(trim(bt.txn_ref), '[/\s]', '-', 'g'), 'DD-Mon-YY'),
  bank     = NULL
WHERE bt.txn_date = DATE '2001-01-01'
  AND bt.txn_ref ~ '^\s*\d{1,2}[-/\s][A-Za-z]{3}[-/\s]\d{2,4}\s*$';

-- After this migration, invoices.payment_status / total_paid / days_past_due
-- for affected invoices need a recompute (HO clicks "Recompute statuses" in
-- the All Invoices header, or POST /api/invoices/recompute-statuses).
