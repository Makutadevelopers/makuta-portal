-- 043_backfill_bank_txns_for_manual_payments.sql
--
-- Cheque/NEFT/RTGS/UPI/IMPS payments entered through the normal invoice
-- payment flow never created a bank_transactions row (only Bulk Pay and the
-- bulk importer did), so they were invisible on Bank Reconciliation. From now
-- on the payment controller creates/links one (see payment.service
-- syncBankTxnForPayment); this migration backfills every existing orphan.
--
-- A physical cheque/transfer is identified by (txn_type, txn_ref, bank,
-- txn_date) — the same key the runtime uses. One cheque paying several invoices
-- collapses to ONE reconciliation row; the same cheque number reused on a
-- different date stays separate (the cross-date dupes migration 041 had to
-- clean up). An orphan that already matches an existing cheque is attached to
-- it; otherwise a new row (remarks 'Backfill 043') is created. txn_amount is
-- then re-summed from all linked payments — the tally invariant.
--
-- Idempotent: every step is guarded on bank_txn_id IS NULL / ON CONFLICT, so a
-- re-run is a no-op. Reversible — touched payment ids are saved to
-- payments_bank_txn_backfill_043. Manual rollback:
--   UPDATE payments p SET bank_txn_id = NULL
--     FROM payments_bank_txn_backfill_043 b WHERE p.id = b.payment_id;
--   DELETE FROM bank_transactions WHERE remarks = 'Backfill 043';
-- (Existing cheques that absorbed an orphan keep their re-summed amount; it is
-- always recomputable from the linked payments and within the page's ₹1 tally
-- tolerance, so it is not separately snapshotted.)

CREATE TABLE IF NOT EXISTS payments_bank_txn_backfill_043 (
  payment_id    UUID PRIMARY KEY,
  backfilled_at TIMESTAMPTZ DEFAULT NOW()
);

-- 0. Record the orphan bank-type payments we are about to touch.
INSERT INTO payments_bank_txn_backfill_043 (payment_id)
SELECT p.id
FROM payments p
WHERE p.bank_txn_id IS NULL
  AND lower(p.payment_type) <> 'cash'
  AND p.amount > 0
  AND NULLIF(btrim(p.payment_ref), '') IS NOT NULL
ON CONFLICT (payment_id) DO NOTHING;

-- 1. Create a bank_transactions row for each orphan group that has no existing
--    matching cheque (same type + ref + bank + date). The group is materialised
--    in a CTE first so the existence check references plain output columns —
--    a correlated subquery in HAVING cannot see the btrim(payment_ref) grouping
--    expression (Postgres error 42803).
WITH orphan_grp AS (
  SELECT p.payment_type            AS txn_type,
         btrim(p.payment_ref)      AS txn_ref,
         p.bank                    AS bank,
         p.payment_date            AS txn_date,
         SUM(p.amount)             AS total,
         (ARRAY_AGG(p.recorded_by))[1] AS created_by
  FROM payments p
  JOIN payments_bank_txn_backfill_043 b ON b.payment_id = p.id
  WHERE p.bank_txn_id IS NULL
  GROUP BY p.payment_type, btrim(p.payment_ref), p.bank, p.payment_date
)
INSERT INTO bank_transactions (txn_type, txn_ref, txn_amount, txn_date, bank, remarks, created_by)
SELECT g.txn_type, g.txn_ref, g.total, g.txn_date, g.bank, 'Backfill 043', g.created_by
FROM orphan_grp g
WHERE NOT EXISTS (
  SELECT 1 FROM bank_transactions bt
  WHERE bt.txn_type = g.txn_type
    AND bt.txn_ref  = g.txn_ref
    AND bt.bank IS NOT DISTINCT FROM g.bank
    AND bt.txn_date = g.txn_date
);

-- 2. Link every orphan payment to its matching cheque (existing or just made).
UPDATE payments p
SET bank_txn_id = (
  SELECT bt.id FROM bank_transactions bt
  WHERE bt.txn_type = p.payment_type
    AND bt.txn_ref  = btrim(p.payment_ref)
    AND bt.bank IS NOT DISTINCT FROM p.bank
    AND bt.txn_date = p.payment_date
  ORDER BY bt.created_at, bt.id
  LIMIT 1
)
FROM payments_bank_txn_backfill_043 b
WHERE p.id = b.payment_id
  AND p.bank_txn_id IS NULL;

-- 3. Re-sum txn_amount for every cheque a backfilled payment is now linked to
--    (newly created rows are unchanged; reused ones grow by the attached
--    orphans). Keeps txn_amount == SUM(linked payments).
UPDATE bank_transactions bt
SET txn_amount = s.total
FROM (
  SELECT p.bank_txn_id AS id, SUM(p.amount) AS total
  FROM payments p
  WHERE p.bank_txn_id IN (
    SELECT DISTINCT p2.bank_txn_id
    FROM payments p2
    JOIN payments_bank_txn_backfill_043 b ON b.payment_id = p2.id
    WHERE p2.bank_txn_id IS NOT NULL
  )
  GROUP BY p.bank_txn_id
) s
WHERE bt.id = s.id;
