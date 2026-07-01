-- 050_add_gst_tds_to_payments.sql
-- Adds optional GST-TDS (tax deducted at source under GST law) tracking on
-- each payment row, alongside the income-tax TDS added in migration 027.
--
-- GST-TDS (CGST+SGST, statutorily 2%) is withheld from the vendor payment on
-- the taxable value — i.e. the pre-GST base_amount, the SAME base the income-
-- tax TDS uses. Like TDS, it settles part of the invoice WITHOUT cash changing
-- hands: the withheld GST-TDS is remitted to the department on the vendor's
-- behalf. HO/site enter gst_tds_pct on the payment form; the backend computes
--   gst_tds_amount = ROUND(invoice.base_amount * gst_tds_pct / 100, 2)
-- once at insert time and freezes it on the row (re-rounding on every read
-- would let floating-point drift the value over time).
--
-- payment_status is recomputed as:
--   sum(payments.amount + payments.tds_amount + payments.gst_tds_amount)
--   + sum(CN allocations) >= invoice_amount  →  'Paid'
-- so cash + income-tax TDS + GST-TDS together settle the invoice.
--
-- Defaults to 0 / 0 so every existing row keeps its current semantics and no
-- other code path needs to special-case "no GST-TDS".

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS gst_tds_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_tds_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Range guard: percentages outside 0–100 are nonsensical, so reject them
-- at the DB layer in case some future code path forgets to validate.
ALTER TABLE payments
  ADD CONSTRAINT payments_gst_tds_pct_range
    CHECK (gst_tds_pct >= 0 AND gst_tds_pct <= 100);

ALTER TABLE payments
  ADD CONSTRAINT payments_gst_tds_amount_nonneg
    CHECK (gst_tds_amount >= 0);
