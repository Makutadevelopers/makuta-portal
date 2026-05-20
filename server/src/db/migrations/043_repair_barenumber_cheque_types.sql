-- 043_repair_barenumber_cheque_types.sql
--
-- 040 cleaned only the "Chq <n>"-typed rows. The audit (p6/p8, 2026-05-20)
-- shows the larger family stores the BARE cheque-no / UTR in the type field,
-- with the date in the ref — in BOTH payments and their linked bank_transactions
-- (e.g. payment_type "781" + payment_ref null linked to txn_type "781" +
-- txn_ref "19/06/24"; or the 13 "492199" payments + ref "05/02/25"). 042 found
-- nothing to adopt because the linked transactions were themselves dirty.
--
-- This applies 040's normalisation to bare-number types in both tables:
--   * the number in the type IS the real cheque no / UTR  -> move it to ref
--   * type becomes 'Cheque' (<=6 digit cheque no) or 'NEFT' (>=9 digit UTR)
--   * the real date is recovered by parsing the old ref (DD/MM/YY or DD-Mon-YY);
--     left as-is when the ref is not a date (date already correct)
--
-- DEFERRED (not matched here): the 119 "Import"-typed payments (unlinked, no
-- cheque number recoverable) and the 4 "5.50E+11" Excel-mangled UTRs (precision
-- lost). Those need source sheets / a manual call. `bank` is left untouched.
--
-- Reversible: bank_transactions_dedupe_snapshot tag '043_barenum_txn';
-- payments_repair_snapshot tag '043_barenum_payment'.

-- ── Snapshots ───────────────────────────────────────────────────────────────
INSERT INTO bank_transactions_dedupe_snapshot
  (id, txn_type, txn_ref, txn_amount, txn_date, bank, remarks, created_by, created_at, snapshot_tag)
SELECT id, txn_type, txn_ref, txn_amount, txn_date, bank, remarks, created_by, created_at, '043_barenum_txn'
FROM bank_transactions
WHERE txn_type ~ '^\s*\d{1,12}\s*$';

INSERT INTO payments_repair_snapshot
  (repair_tag, payment_id, invoice_id, amount, payment_type, payment_ref, payment_date, bank, payment_month, batch_id, bank_txn_id, created_at)
SELECT '043_barenum_payment', id, invoice_id, amount, payment_type, payment_ref, payment_date, bank, payment_month, batch_id, bank_txn_id, created_at
FROM payments
WHERE payment_type ~ '^\s*\d{1,12}\s*$';

-- ── bank_transactions ───────────────────────────────────────────────────────
UPDATE bank_transactions
SET txn_date = CASE
      WHEN txn_ref ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{4}\s*$' THEN to_date(trim(txn_ref), 'DD-Mon-YYYY')
      WHEN txn_ref ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{2}\s*$'  THEN to_date(trim(txn_ref), 'DD-Mon-YY')
      WHEN txn_ref ~ '^\s*\d{1,2}/\d{1,2}/\d{4}\s*$'      THEN to_date(trim(txn_ref), 'DD/MM/YYYY')
      WHEN txn_ref ~ '^\s*\d{1,2}/\d{1,2}/\d{2}\s*$'       THEN to_date(trim(txn_ref), 'DD/MM/YY')
      ELSE txn_date
    END,
    txn_ref  = trim(txn_type),
    txn_type = CASE WHEN char_length(trim(txn_type)) >= 9 THEN 'NEFT' ELSE 'Cheque' END
WHERE txn_type ~ '^\s*\d{1,12}\s*$';

-- ── payments ────────────────────────────────────────────────────────────────
UPDATE payments
SET payment_date = CASE
      WHEN payment_ref ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{4}\s*$' THEN to_date(trim(payment_ref), 'DD-Mon-YYYY')
      WHEN payment_ref ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{2}\s*$'  THEN to_date(trim(payment_ref), 'DD-Mon-YY')
      WHEN payment_ref ~ '^\s*\d{1,2}/\d{1,2}/\d{4}\s*$'      THEN to_date(trim(payment_ref), 'DD/MM/YYYY')
      WHEN payment_ref ~ '^\s*\d{1,2}/\d{1,2}/\d{2}\s*$'       THEN to_date(trim(payment_ref), 'DD/MM/YY')
      ELSE payment_date
    END,
    payment_ref  = trim(payment_type),
    payment_type = CASE WHEN char_length(trim(payment_type)) >= 9 THEN 'NEFT' ELSE 'Cheque' END
WHERE payment_type ~ '^\s*\d{1,12}\s*$';

-- ── Resync payment_month to the corrected payment_date on touched rows ───────
UPDATE payments
SET payment_month = date_trunc('month', payment_date)::date
WHERE id IN (
  SELECT payment_id FROM payments_repair_snapshot WHERE repair_tag = '043_barenum_payment'
);
