-- 040_repair_payment_column_shift_stage1.sql
--
-- Stage 1 of the cheque column-shift repair. The pre-hardening importer (four
-- 16-May-2026 batches: 4559e5bc, 5fdcc961, 7ef0338b, cea80d41) shifted columns:
--   payment_type / txn_type  held "Chq <number>"   (should be 'Cheque')
--   payment_ref  / txn_ref   held the payment DATE  (should be the cheque no)
--   payment_date             held the wrong date    (real date was in the ref)
--   bank                     held a "Mon-YY" month or NULL (real bank lost)
-- Confirmed live 2026-05-20 via /api/admin/import-audit (p1: 237/2211 payments;
-- p3: 71/412 bank_transactions). Two sub-patterns — A: txn_date already correct,
-- ref redundantly holds the same date; B: txn_date wrong, real date in the ref
-- (the "Mon-YY" in bank agrees). Parsing the ref recovers the date for both
-- (a no-op for A), so a single pass handles them.
--
-- SCOPE: only the unambiguous CHEQUE rows (type matches 'Chq <something>').
-- Bare-numeric types (NEFT/RTGS UTRs) and bank-name backfill are deferred to a
-- later stage. `bank` is left untouched here. Rows already hand-fixed (e.g.
-- invoice #5544, whose ref is now a real cheque no) are NOT re-touched for the
-- date, because their ref no longer parses as a date.
--
-- Fully reversible: pre-repair rows are snapshotted to
-- bank_transactions_dedupe_snapshot (tag '040_colshift_txn') and
-- payments_repair_snapshot (tag '040_colshift_payment') before any UPDATE.

-- ── 1. Snapshots ────────────────────────────────────────────────────────────
INSERT INTO bank_transactions_dedupe_snapshot
  (id, txn_type, txn_ref, txn_amount, txn_date, bank, remarks, created_by, created_at, snapshot_tag)
SELECT id, txn_type, txn_ref, txn_amount, txn_date, bank, remarks, created_by, created_at, '040_colshift_txn'
FROM bank_transactions
WHERE txn_type ~* '^\s*Chq\s+\S';

-- (payments has no updated_at column — see 037's note — so it's omitted here)
INSERT INTO payments_repair_snapshot
  (repair_tag, payment_id, invoice_id, amount, payment_type, payment_ref, payment_date, bank, payment_month, batch_id, bank_txn_id, created_at)
SELECT '040_colshift_payment', id, invoice_id, amount, payment_type, payment_ref, payment_date, bank, payment_month, batch_id, bank_txn_id, created_at
FROM payments
WHERE payment_type ~* '^\s*Chq\s+\S';

-- ── 2. bank_transactions: recover date from ref (no-op when already correct),
--       move cheque no from type -> ref, normalise type. SET reads pre-update
--       values, so txn_date sees the OLD txn_ref and txn_ref sees the OLD type. ─
UPDATE bank_transactions
SET txn_date = CASE
      WHEN txn_ref ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{4}\s*$' THEN to_date(trim(txn_ref), 'DD-Mon-YYYY')
      WHEN txn_ref ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{2}\s*$'  THEN to_date(trim(txn_ref), 'DD-Mon-YY')
      WHEN txn_ref ~ '^\s*\d{1,2}/\d{1,2}/\d{4}\s*$'      THEN to_date(trim(txn_ref), 'DD/MM/YYYY')
      WHEN txn_ref ~ '^\s*\d{1,2}/\d{1,2}/\d{2}\s*$'       THEN to_date(trim(txn_ref), 'DD/MM/YY')
      ELSE txn_date
    END,
    txn_ref  = NULLIF(trim(regexp_replace(txn_type, '^\s*Chq\s+', '', 'i')), ''),
    txn_type = 'Cheque'
WHERE txn_type ~* '^\s*Chq\s+\S';

-- ── 3. payments: same normalisation ─────────────────────────────────────────
UPDATE payments
SET payment_date = CASE
      WHEN payment_ref ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{4}\s*$' THEN to_date(trim(payment_ref), 'DD-Mon-YYYY')
      WHEN payment_ref ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{2}\s*$'  THEN to_date(trim(payment_ref), 'DD-Mon-YY')
      WHEN payment_ref ~ '^\s*\d{1,2}/\d{1,2}/\d{4}\s*$'      THEN to_date(trim(payment_ref), 'DD/MM/YYYY')
      WHEN payment_ref ~ '^\s*\d{1,2}/\d{1,2}/\d{2}\s*$'       THEN to_date(trim(payment_ref), 'DD/MM/YY')
      ELSE payment_date
    END,
    payment_ref  = NULLIF(trim(regexp_replace(payment_type, '^\s*Chq\s+', '', 'i')), ''),
    payment_type = 'Cheque'
WHERE payment_type ~* '^\s*Chq\s+\S';

-- ── 4. Resync payment_month to the corrected payment_date on touched rows ────
UPDATE payments
SET payment_month = date_trunc('month', payment_date)::date
WHERE id IN (
  SELECT payment_id FROM payments_repair_snapshot WHERE repair_tag = '040_colshift_payment'
);
