-- Repair the remaining F8-pattern rows whose payment_ref holds a *numeric*
-- date string ("19/06/24") instead of the "21-Mar-25" month-name shape that
-- migration 036 caught. Same root cause (Payment Date cell yielded the
-- 2001-01-01 sentinel and the real date string was shifted into payment_ref);
-- different surface formatting from the source spreadsheet.
--
-- Sample row that motivated this migration (Sree Om Electricals, invoice
-- soee/24-25/*, Jun 2024): payment_date=2001-01-01, payment_ref='19/06/24',
-- bank=NULL. The 19 May 2026 audit counted ~10 such rows after 036 ran.
--
-- Strategy:
--   1. Snapshot tag '037_F8_numeric_ref_date' so we can roll back.
--   2. Parse "DD/MM/YY", "D-M-YY", "DD.MM.YYYY" etc. via regex_match into
--      day/month/year_raw integers, then make_date(). Indian DD/MM/YY
--      convention — ambiguous combos default to day-first (same call
--      parseDate() makes in import.controller.ts).
--   3. Reject rows whose day > 31 or month > 12 so a bad regex match
--      can never produce an invalid date and crash make_date(). The
--      WHERE clause on the validated CTE is the safety net.
--   4. Leave payment_type alone (034 handled the prefix-clobber pattern);
--      null payment_ref (it held the date string, not a real reference)
--      and leave bank alone (already NULL on these rows).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Snapshot
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO payments_repair_snapshot (
  repair_tag, payment_id, invoice_id, amount, payment_type, payment_ref,
  payment_date, bank, payment_month, batch_id, bank_txn_id, created_at
)
SELECT
  '037_F8_numeric_ref_date',
  p.id, p.invoice_id, p.amount, p.payment_type, p.payment_ref,
  p.payment_date, p.bank, p.payment_month, p.batch_id, p.bank_txn_id,
  p.created_at
FROM payments p
WHERE p.payment_date = DATE '2001-01-01'
  AND p.payment_ref ~ '^\s*\d{1,2}[/\-.\s]\d{1,2}[/\-.\s]\d{2,4}\s*$';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Repair
-- ─────────────────────────────────────────────────────────────────────────
WITH parts AS (
  SELECT
    p.id,
    (regexp_match(
      trim(p.payment_ref),
      '^(\d{1,2})[/\-.\s](\d{1,2})[/\-.\s](\d{2,4})$'
    )) AS m
  FROM payments p
  WHERE p.payment_date = DATE '2001-01-01'
    AND p.payment_ref ~ '^\s*\d{1,2}[/\-.\s]\d{1,2}[/\-.\s]\d{2,4}\s*$'
),
validated AS (
  SELECT
    id,
    m[1]::int AS day_part,
    m[2]::int AS month_part,
    CASE
      WHEN m[3]::int < 50  THEN m[3]::int + 2000
      WHEN m[3]::int < 100 THEN m[3]::int + 1900
      ELSE m[3]::int
    END AS year_part
  FROM parts
  WHERE m IS NOT NULL
    AND m[1]::int BETWEEN 1 AND 31
    AND m[2]::int BETWEEN 1 AND 12
)
UPDATE payments p
SET
  payment_date  = make_date(v.year_part, v.month_part, v.day_part),
  payment_month = date_trunc('month', make_date(v.year_part, v.month_part, v.day_part))::date,
  payment_ref   = NULL
FROM validated v
WHERE p.id = v.id;

-- Parallel bank_transactions cleanup, same filter.
UPDATE bank_transactions bt
SET
  txn_date = make_date(
    CASE
      WHEN (regexp_match(trim(bt.txn_ref), '^(\d{1,2})[/\-.\s](\d{1,2})[/\-.\s](\d{2,4})$'))[3]::int < 50  THEN (regexp_match(trim(bt.txn_ref), '^(\d{1,2})[/\-.\s](\d{1,2})[/\-.\s](\d{2,4})$'))[3]::int + 2000
      WHEN (regexp_match(trim(bt.txn_ref), '^(\d{1,2})[/\-.\s](\d{1,2})[/\-.\s](\d{2,4})$'))[3]::int < 100 THEN (regexp_match(trim(bt.txn_ref), '^(\d{1,2})[/\-.\s](\d{1,2})[/\-.\s](\d{2,4})$'))[3]::int + 1900
      ELSE (regexp_match(trim(bt.txn_ref), '^(\d{1,2})[/\-.\s](\d{1,2})[/\-.\s](\d{2,4})$'))[3]::int
    END,
    (regexp_match(trim(bt.txn_ref), '^(\d{1,2})[/\-.\s](\d{1,2})[/\-.\s](\d{2,4})$'))[2]::int,
    (regexp_match(trim(bt.txn_ref), '^(\d{1,2})[/\-.\s](\d{1,2})[/\-.\s](\d{2,4})$'))[1]::int
  )
WHERE bt.txn_date = DATE '2001-01-01'
  AND bt.txn_ref ~ '^\s*\d{1,2}[/\-.\s]\d{1,2}[/\-.\s]\d{2,4}\s*$'
  AND (regexp_match(trim(bt.txn_ref), '^(\d{1,2})[/\-.\s](\d{1,2})[/\-.\s](\d{2,4})$'))[1]::int BETWEEN 1 AND 31
  AND (regexp_match(trim(bt.txn_ref), '^(\d{1,2})[/\-.\s](\d{1,2})[/\-.\s](\d{2,4})$'))[2]::int BETWEEN 1 AND 12;
