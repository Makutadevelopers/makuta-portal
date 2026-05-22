-- 048_reconcile_bank_txns.sql
--
-- Make Bank Reconciliation 100% correct by cleaning the bank_transactions rows
-- the old (now-fixed) importer left behind. Confirmed on prod 2026-05-22:
--   (1) 146 ORPHAN rows (zero linked payments, ₹30.72 Cr) — the "no vendor /
--       Mismatch" rows from bank-statement-style imports (batches 85bba58c=106,
--       48e4fe8c=17, + 23 no-remarks). They inflated Total cheque/txn amount.
--   (2) Duplicate rows for the same physical cheque (the orphan twins are removed
--       by step 1; step 2 merges any remaining pair where BOTH copies carry
--       payments — there was 1 such group).
--   (3) 21 rows where txn_amount != SUM(linked payments) — the old importer's
--       `txn_amount += amount` over-accumulation.
--
-- End state: every surviving row has >=1 linked payment and txn_amount =
-- SUM(payments), so every row tallies (Balance ₹0). The interactive flow and the
-- now-fixed importers (which route through syncBankTxnForPayment) keep it that way.
--
-- Fully reversible: every deleted/changed row is snapshotted (full row as JSONB)
-- to bank_txn_cleanup_snapshot tag '048_reconcile' before the change. FK-safe:
-- payments.bank_txn_id is ON DELETE SET NULL and orphans have no payments.
-- Runs inside migrate.ts BEGIN/COMMIT (atomic).

CREATE TABLE IF NOT EXISTS bank_txn_cleanup_snapshot (
  snapshot_tag   TEXT        NOT NULL,
  reason         TEXT        NOT NULL,
  bank_txn_id    UUID        NOT NULL,
  row_data       JSONB       NOT NULL,
  snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- (1) Orphans (no linked payments): snapshot, then delete.
INSERT INTO bank_txn_cleanup_snapshot (snapshot_tag, reason, bank_txn_id, row_data)
SELECT '048_reconcile', 'orphan_no_payments', bt.id, to_jsonb(bt)
FROM bank_transactions bt
WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.bank_txn_id = bt.id);

DELETE FROM bank_transactions bt
WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.bank_txn_id = bt.id);

-- (2) Merge duplicates. A physical cheque is identified by (digits-only ref,
-- txn_date, rounded amount) — deliberately NOT by bank/type, since the import
-- copy differs there ("Chq 000968 / NEFT / HDFC 57500..." vs "000968 / Cheque /
-- null"). Keep the earliest-created row, re-point the extras' payments onto it,
-- then delete the extras.
CREATE TEMP TABLE _dups ON COMMIT DROP AS
SELECT id, keep_id FROM (
  SELECT id,
         row_number()    OVER w AS rn,
         first_value(id) OVER w AS keep_id
  FROM bank_transactions
  WINDOW w AS (
    PARTITION BY regexp_replace(COALESCE(txn_ref, ''), '[^0-9]', '', 'g'), txn_date, round(txn_amount)
    ORDER BY created_at, id
  )
) g
WHERE rn > 1;

INSERT INTO bank_txn_cleanup_snapshot (snapshot_tag, reason, bank_txn_id, row_data)
SELECT '048_reconcile', 'duplicate_merged_into:' || d.keep_id, bt.id, to_jsonb(bt)
FROM bank_transactions bt JOIN _dups d ON d.id = bt.id;

UPDATE payments p SET bank_txn_id = d.keep_id FROM _dups d WHERE p.bank_txn_id = d.id;

DELETE FROM bank_transactions bt USING _dups d WHERE bt.id = d.id;

-- (3) Re-tally any row whose stored amount drifted from its linked payments
-- (>= ₹1). Runs last so the merge in (2) is included in the sum.
INSERT INTO bank_txn_cleanup_snapshot (snapshot_tag, reason, bank_txn_id, row_data)
SELECT '048_reconcile', 'retally', bt.id, to_jsonb(bt)
FROM bank_transactions bt
WHERE ABS(bt.txn_amount - (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.bank_txn_id = bt.id)) >= 1;

UPDATE bank_transactions bt
SET txn_amount = (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.bank_txn_id = bt.id)
WHERE ABS(bt.txn_amount - (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.bank_txn_id = bt.id)) >= 1;
