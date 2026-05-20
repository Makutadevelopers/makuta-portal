-- 038_dedupe_orphan_bank_transactions.sql
--
-- Remove duplicate bank_transactions rows left behind by the old bulk importer.
-- The importer was meant to REUSE an existing cheque (matched on txn_ref + bank)
-- and bump its amount, but some runs INSERTed a fresh row instead. The result:
-- the same cheque (e.g. 000973, ₹53,08,479) appears two or three times, with the
-- canonical copy carrying the linked payments and the duplicate copies orphaned
-- (zero linked payments). Each orphan shows ₹0 allocated / 0 invoices and a
-- non-zero balance, which inflates the "Un-tallied" count on Bank Reconciliation.
--
-- We delete ONLY orphan copies (no linked payments) that have a SIBLING row with
-- the SAME txn_ref + bank + txn_amount that DOES carry payments. Cheques that are
-- unlinked but have no linked sibling (real money out that still needs an invoice
-- attached) are LEFT UNTOUCHED — those require manual reconciliation, not deletion.
--
-- Deleting an orphan is FK-safe: payments.bank_txn_id is ON DELETE SET NULL and
-- the rows we delete have no payments pointing at them. Pre-delete state is copied
-- to bank_transactions_dedupe_snapshot (tag '038_orphan_dupe') for rollback.

CREATE TABLE IF NOT EXISTS bank_transactions_dedupe_snapshot (
  id           UUID,
  txn_type     TEXT,
  txn_ref      TEXT,
  txn_amount   NUMERIC(14,2),
  txn_date     DATE,
  bank         TEXT,
  remarks      TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ,
  snapshot_tag TEXT,
  snapshot_at  TIMESTAMPTZ DEFAULT NOW()
);

WITH linked AS (
  -- (txn_ref, bank, amount) combinations that have at least one linked payment
  SELECT DISTINCT bt.txn_ref,
                  COALESCE(bt.bank, '') AS bank_key,
                  bt.txn_amount
  FROM bank_transactions bt
  WHERE EXISTS (SELECT 1 FROM payments p WHERE p.bank_txn_id = bt.id)
),
orphan_dupes AS (
  SELECT bt.id
  FROM bank_transactions bt
  JOIN linked l
    ON l.txn_ref    = bt.txn_ref
   AND l.bank_key   = COALESCE(bt.bank, '')
   AND l.txn_amount = bt.txn_amount
  WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.bank_txn_id = bt.id)
)
INSERT INTO bank_transactions_dedupe_snapshot
  (id, txn_type, txn_ref, txn_amount, txn_date, bank, remarks, created_by, created_at, snapshot_tag)
SELECT bt.id, bt.txn_type, bt.txn_ref, bt.txn_amount, bt.txn_date,
       bt.bank, bt.remarks, bt.created_by, bt.created_at, '038_orphan_dupe'
FROM bank_transactions bt
WHERE bt.id IN (SELECT id FROM orphan_dupes);

DELETE FROM bank_transactions
WHERE id IN (
  SELECT id FROM bank_transactions_dedupe_snapshot WHERE snapshot_tag = '038_orphan_dupe'
);
