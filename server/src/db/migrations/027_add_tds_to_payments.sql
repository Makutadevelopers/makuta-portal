-- 027_add_tds_to_payments.sql
-- Adds optional TDS (tax deducted at source) tracking on each payment row.
-- Indian construction vendors are typically taxed at 1% or 2% under section
-- 194C (contractors); other sections go up to 10%. Site accountants enter
-- tds_pct on the payment form; the backend computes
--   tds_amount = ROUND(invoice.invoice_amount * tds_pct / 100, 2)
-- once at insert time. The amount is then frozen on the row — re-rounding
-- on every read would let floating-point drift the value over time.
--
-- payment_status is recomputed as:
--   sum(payments.amount + payments.tds_amount) + sum(CN allocations)
--   >= invoice_amount   →  'Paid'
-- so a vendor handed ₹98,000 cash on a ₹1,00,000 invoice with 2% TDS still
-- settles the invoice fully — the ₹2,000 TDS stands in for the rest.
--
-- Defaults to 0 / 0 so existing rows keep their pre-TDS semantics and
-- nothing else in the app needs to special-case "no TDS".

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS tds_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tds_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Range guard: percentages outside 0–100 are nonsensical, so reject them
-- at the DB layer in case some future code path forgets to validate.
ALTER TABLE payments
  ADD CONSTRAINT payments_tds_pct_range
    CHECK (tds_pct >= 0 AND tds_pct <= 100);

ALTER TABLE payments
  ADD CONSTRAINT payments_tds_amount_nonneg
    CHECK (tds_amount >= 0);
