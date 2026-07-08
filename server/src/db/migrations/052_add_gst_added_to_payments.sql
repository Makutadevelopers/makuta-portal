-- 052_add_gst_added_to_payments.sql
-- Adds optional "GST added at payment" tracking on each payment row.
--
-- This is the OPPOSITE of the GST-TDS withholding in migration 050. Some vendor
-- invoices are entered at the pre-GST base value; when such an invoice is paid,
-- the employee may need to ADD the vendor's GST on top of the cash — extra money
-- that LEAVES the business and reaches the vendor (who remits it themselves).
--
-- Business rules:
--   - gst_added is computed on the base AFTER income-tax TDS is removed:
--       new_base       = base_amount - tds_amount
--       gst_added_amount = ROUND(new_base * gst_added_pct / 100, 2)
--     frozen once at insert (re-rounding on every read would drift the value).
--   - gst_added is EXTRA cash to the vendor. It is NOT part of invoice
--     settlement: payment_status / outstanding balance / aging continue to use
--     ONLY (amount + tds_amount + gst_tds_amount), exactly as before. Adding
--     GST therefore never marks an invoice more "Paid" than its cash+TDS does.
--   - The cheque/bank-transaction total DOES include it, so bank reconciliation
--     matches the real amount that cleared: txn_amount = SUM(amount + gst_added_amount).
--
-- Defaults to 0 / 0 so every existing row keeps its current semantics and no
-- other code path needs to special-case "no GST added".

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS gst_added_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_added_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Range guard: GST slabs top out at 28%, but allow up to 100 to stay in step
-- with the other percentage columns and reject only clearly-nonsensical values.
ALTER TABLE payments
  ADD CONSTRAINT payments_gst_added_pct_range
    CHECK (gst_added_pct >= 0 AND gst_added_pct <= 100);

ALTER TABLE payments
  ADD CONSTRAINT payments_gst_added_amount_nonneg
    CHECK (gst_added_amount >= 0);
