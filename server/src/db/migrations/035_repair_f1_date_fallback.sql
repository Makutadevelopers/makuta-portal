-- Repair payments corrupted by the F1 silent-date-fallback bug in the bulk
-- importer (see server/src/db/diagnostics/2026-05-19_import_corruption_audit.sql).
--
-- Symptom: an old import couldn't parse the source CSV's Payment Date cell, so
-- it silently fell back to invoice_date and wrote the *real* payment date
-- string into payment_ref ("03-Jul-24") and the Payment Month string into
-- bank ("Jul-24"). The 19 May 2026 audit found 131 such rows — mostly
-- SALASAR IRON AND STEEL invoices from Apr–Jun 2024, with real payment
-- dates 70–124 days later than the system was reporting. Every aging,
-- cashflow, and MD-dashboard number for these payments was therefore
-- understating the lag time by months.
--
-- This is Pass 1 — dates only. We deliberately do NOT try to recover the
-- cheque/UTR number into payment_ref in this pass:
--   - migration 034 already cleaned the recoverable "Chq 598520" → "Cheque"
--     prefix cases for payment_type.
--   - For F1 rows, payment_ref currently holds the date string, so 034's
--     ref-recovery skipped them (only writes when payment_ref is empty).
--   - The remaining ref-extraction is judgement-heavy (some originals were
--     Excel scientific-notation like "5.50E+11" with lost precision; others
--     are pure numerics where we don't know if NEFT vs RTGS vs IMPS).
--     Leave it for Pass 2, with HO eyes on the snapshot.
--
-- The snapshot (035_F1_date_fallback tag in payments_repair_snapshot) keeps
-- the pre-repair payment_ref and bank values so we can recover the date
-- string and month-string back if anything in this migration is wrong.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Snapshot the current state of every F1 row, before any UPDATE.
-- ─────────────────────────────────────────────────────────────────────────
-- payments has no updated_at column (verified against 004_create_payments.sql);
-- the snapshot table's updated_at column stays nullable.
INSERT INTO payments_repair_snapshot (
  repair_tag, payment_id, invoice_id, amount, payment_type, payment_ref,
  payment_date, bank, payment_month, batch_id, bank_txn_id, created_at
)
SELECT
  '035_F1_date_fallback',
  p.id, p.invoice_id, p.amount, p.payment_type, p.payment_ref,
  p.payment_date, p.bank, p.payment_month, p.batch_id, p.bank_txn_id,
  p.created_at
FROM payments p
JOIN invoices i ON i.id = p.invoice_id
WHERE p.payment_date = i.invoice_date
  AND p.payment_ref ~ '^\s*\d{1,2}[-/\s][A-Za-z]{3}[-/\s]\d{2,4}\s*$';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Repair payments: parse the real date out of payment_ref, set the
--    correct payment_date / payment_month, null bank (which currently
--    holds a "Mon-YY" string) and null payment_ref (which currently holds
--    the date string). payment_type is left untouched — 034 already did
--    its best on the recoverable prefix patterns.
-- ─────────────────────────────────────────────────────────────────────────
WITH parsed AS (
  SELECT
    p.id,
    to_date(
      regexp_replace(trim(p.payment_ref), '[/\s]', '-', 'g'),
      'DD-Mon-YY'
    ) AS real_payment_date
  FROM payments p
  JOIN invoices i ON i.id = p.invoice_id
  WHERE p.payment_date = i.invoice_date
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
--    Only matches rows whose txn_ref is itself a date-pattern string —
--    a previous version used OR with the bank-month pattern, which let
--    rows with non-date txn_refs like "1143" through and crashed
--    to_date(). Strict AND-equivalent (single regex on txn_ref) is safe.
--    bank_transactions.txn_ref is NOT NULL, so we leave the bogus
--    date-string ref in place; HO can clean it via Bank Reconciliation.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE bank_transactions bt
SET
  txn_date = to_date(regexp_replace(trim(bt.txn_ref), '[/\s]', '-', 'g'), 'DD-Mon-YY'),
  bank     = NULL
WHERE bt.txn_ref ~ '^\s*\d{1,2}[-/\s][A-Za-z]{3}[-/\s]\d{2,4}\s*$';

-- NOTE: invoices.payment_status / total_paid / days_past_due are
-- denormalised views computed from the payments rows we just edited. They
-- need a recompute after this migration. The deploy script should call
-- POST /api/invoices/recompute-statuses (HO role) — or set
-- RUN_RECOMPUTE_AFTER_MIGRATE=true in the prod env if such a hook exists.
