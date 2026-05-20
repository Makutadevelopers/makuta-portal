-- 2026-05-20_bank_recon_untally_buckets.sql
-- Read-only. Run on RDS to see WHY each bank transaction is un-tallied, before
-- and after migration 038. Buckets the mismatch population so we know how much
-- is cosmetic (rounding), how much is duplicate corruption, and how much is a
-- genuine reconciliation gap that needs a human.
--
--   rounding_only   -> |cheque - allocated| < ₹1. Cosmetic; the controller
--                       tolerance fix (≥ ₹1) flips these to "Tallied". No data change.
--   orphan_dupe     -> 0 linked payments AND a sibling (same txn_ref+bank+amount)
--                       that HAS payments. Migration 038 deletes these.
--   orphan_solo     -> 0 linked payments, NO linked sibling. Real money out with
--                       no invoice attached. NOT auto-fixed — needs manual linking.
--   partial_alloc   -> has payments but allocated < cheque by ≥ ₹1. Genuine
--                       partial reconciliation; leave flagged.

WITH bt_alloc AS (
  SELECT bt.id,
         bt.txn_ref,
         COALESCE(bt.bank, '') AS bank_key,
         bt.txn_amount,
         COALESCE(SUM(p.amount), 0)::NUMERIC(14,2) AS allocated,
         COUNT(p.id) AS pay_count
  FROM bank_transactions bt
  LEFT JOIN payments p ON p.bank_txn_id = bt.id
  GROUP BY bt.id, bt.txn_ref, bt.bank, bt.txn_amount
),
linked_keys AS (
  SELECT DISTINCT txn_ref, bank_key, txn_amount
  FROM bt_alloc WHERE pay_count > 0
),
classified AS (
  SELECT a.*,
         ABS(a.txn_amount - a.allocated) AS diff,
         EXISTS (
           SELECT 1 FROM linked_keys l
           WHERE l.txn_ref = a.txn_ref AND l.bank_key = a.bank_key AND l.txn_amount = a.txn_amount
         ) AS has_linked_sibling
  FROM bt_alloc a
)
SELECT
  CASE
    WHEN diff < 1                              THEN 'rounding_only'
    WHEN pay_count = 0 AND has_linked_sibling  THEN 'orphan_dupe'
    WHEN pay_count = 0                         THEN 'orphan_solo'
    ELSE                                            'partial_alloc'
  END AS bucket,
  COUNT(*)                  AS txns,
  SUM(txn_amount)::NUMERIC(14,2) AS total_cheque_amount,
  SUM(diff)::NUMERIC(14,2)       AS total_gap
FROM classified
GROUP BY 1
ORDER BY txns DESC;
