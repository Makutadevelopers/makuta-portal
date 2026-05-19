-- Resync payments.payment_month with payment_date.
--
-- Background: payments.payment_month was originally stored from the bulk CSV's
-- "Payment Month" column so an Apr-30 payment could be booked into May for
-- accounting purposes. The Cashflow tab buckets by COALESCE(payment_month,
-- payment_date), so payment_month wins when both are set.
--
-- The payment-edit endpoint only updated payment_date, leaving payment_month
-- stuck at the imported value. After fixing that endpoint to keep both
-- columns in sync, this migration heals the historical rows so Cashflow no
-- longer shows them in a stale month.
--
-- Heal scope: only rows where payment_month and payment_date already fall in
-- DIFFERENT months. Rows where they match (the common case) are untouched.
-- The "deliberate Apr/May override" use case wasn't used in practice, so
-- collapsing the divergence is safe; if it ever comes back, the CSV's
-- Payment Month column still works for fresh imports.

UPDATE payments
SET payment_month = DATE_TRUNC('month', payment_date)::date
WHERE payment_month IS NOT NULL
  AND DATE_TRUNC('month', payment_month) <> DATE_TRUNC('month', payment_date);
