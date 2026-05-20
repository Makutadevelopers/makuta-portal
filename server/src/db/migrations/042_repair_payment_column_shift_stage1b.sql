-- 042_repair_payment_column_shift_stage1b.sql
--
-- 040 normalised bank_transactions but its payments UPDATE matched 0 rows: the
-- payment_type isn't "Chq <n>" like txn_type. The audit (p5/p6, 2026-05-20)
-- shows payments are corrupted differently and ALL are linked to a
-- bank_transaction (has_bank_txn = true):
--   (a) type = cheque no, ref = a date   ("492199" / "05/02/25")
--   (b) type = bare cheque-no / UTR, ref = null   ("781" / null)
--   (c) type = "Cheque" (valid), ref = null, bank = null   (SOEE rows)
--   (d) type = "Import" placeholder (119 rows)
--
-- 040 already cleaned the LINKED bank_transactions (cheque no in txn_ref, type
-- 'Cheque', correct date), so the authoritative values live there. This adopts
-- ref/type/date from the linked, now-clean bank_transaction onto the corrupted
-- payment. The date is only overwritten when the current payment_date is the
-- invoice-date fallback OR the real date had been shifted into the ref — so
-- genuinely-correct payment dates (the type-c rows) are preserved.
--
-- Scope: only payments LINKED to a clean bank_transaction (txn_type is a valid
-- method and txn_ref is not a date). Payments linked to still-dirty bare-UTR
-- transactions, and `bank` backfill, are deferred. Fully reversible via
-- payments_repair_snapshot tag '042_adopt_from_txn'.

-- ── 1. Snapshot every payment this migration will touch ─────────────────────
INSERT INTO payments_repair_snapshot
  (repair_tag, payment_id, invoice_id, amount, payment_type, payment_ref, payment_date, bank, payment_month, batch_id, bank_txn_id, created_at)
SELECT '042_adopt_from_txn', p.id, p.invoice_id, p.amount, p.payment_type, p.payment_ref, p.payment_date, p.bank, p.payment_month, p.batch_id, p.bank_txn_id, p.created_at
FROM payments p
JOIN bank_transactions bt ON bt.id = p.bank_txn_id
WHERE bt.txn_ref IS NOT NULL
  AND lower(trim(bt.txn_type)) IN ('cash','cheque','neft','rtgs','imps','upi')   -- bt is clean
  AND bt.txn_ref !~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{2,4}\s*$'
  AND bt.txn_ref !~ '^\s*\d{1,2}/\d{1,2}/\d{2,4}\s*$'
  AND (                                                                          -- payment is corrupted
        p.payment_ref ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{2,4}\s*$'
     OR p.payment_ref ~ '^\s*\d{1,2}/\d{1,2}/\d{2,4}\s*$'
     OR lower(trim(COALESCE(p.payment_type,''))) NOT IN ('cash','cheque','neft','rtgs','imps','upi')
     OR (lower(COALESCE(p.payment_type,'')) <> 'cash' AND NULLIF(trim(p.payment_ref), '') IS NULL)
      );

-- ── 2. Adopt the clean ref/type from the linked bank_transaction; fix the date
--       only when the current one is the invoice-date fallback or was a ref ───
UPDATE payments p
SET payment_ref  = bt.txn_ref,
    payment_type = bt.txn_type,
    payment_date = CASE
        WHEN p.payment_date = i.invoice_date
          OR p.payment_ref ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{2,4}\s*$'
          OR p.payment_ref ~ '^\s*\d{1,2}/\d{1,2}/\d{2,4}\s*$' THEN bt.txn_date
        ELSE p.payment_date
      END,
    payment_month = CASE
        WHEN p.payment_date = i.invoice_date
          OR p.payment_ref ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{2,4}\s*$'
          OR p.payment_ref ~ '^\s*\d{1,2}/\d{1,2}/\d{2,4}\s*$' THEN date_trunc('month', bt.txn_date)::date
        ELSE p.payment_month
      END
FROM bank_transactions bt, invoices i
WHERE p.bank_txn_id = bt.id
  AND i.id = p.invoice_id
  AND p.id IN (SELECT payment_id FROM payments_repair_snapshot WHERE repair_tag = '042_adopt_from_txn');
