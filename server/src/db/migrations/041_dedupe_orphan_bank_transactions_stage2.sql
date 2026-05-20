-- 041_dedupe_orphan_bank_transactions_stage2.sql
--
-- Stage 2 of the cheque cleanup. After 040 normalised cheque refs/dates, the
-- duplicate copies the old importer left now share the same txn_ref (cheque no)
-- and txn_date as their canonical, payment-linked sibling. Migration 038 only
-- removed EXACT txn_ref+bank+amount duplicates, so the cross-format / cross-type
-- copies (e.g. cheque 000601 stored once as "Chq 000601 / 18-Oct-25 / bank null"
-- and again as "Chq 000601 / 18/10/25 / bank Oct-25") slipped through. p4 of the
-- 2026-05-20 audit counted 141 orphan transactions (0 linked payments) — the
-- "0 invoices / Mismatch" rows on Bank Reconciliation.
--
-- This deletes ONLY orphan rows (no linked payments) that have a sibling row
-- which DOES carry payments and shares the same txn_ref + txn_date. Orphans with
-- no linked sibling are LEFT UNTOUCHED — they are real outgoing payments that
-- still need an invoice attached (manual reconciliation), not duplicates.
--
-- FK-safe (payments.bank_txn_id is ON DELETE SET NULL and these rows have no
-- payments). Pre-delete state -> bank_transactions_dedupe_snapshot tag
-- '041_orphan_dedup2' for rollback.

INSERT INTO bank_transactions_dedupe_snapshot
  (id, txn_type, txn_ref, txn_amount, txn_date, bank, remarks, created_by, created_at, snapshot_tag)
SELECT bt.id, bt.txn_type, bt.txn_ref, bt.txn_amount, bt.txn_date, bt.bank, bt.remarks, bt.created_by, bt.created_at, '041_orphan_dedup2'
FROM bank_transactions bt
WHERE bt.txn_ref IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.bank_txn_id = bt.id)
  AND EXISTS (
    SELECT 1
    FROM bank_transactions l
    JOIN payments p ON p.bank_txn_id = l.id
    WHERE l.id <> bt.id
      AND l.txn_ref  = bt.txn_ref
      AND l.txn_date = bt.txn_date
  );

DELETE FROM bank_transactions
WHERE id IN (
  SELECT id FROM bank_transactions_dedupe_snapshot WHERE snapshot_tag = '041_orphan_dedup2'
);
