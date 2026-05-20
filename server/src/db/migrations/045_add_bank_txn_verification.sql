-- 045_add_bank_txn_verification.sql
-- Manual bank-statement verification for the Bank Reconciliation page.
-- HO/MD compare each transaction against the actual bank statement and
-- tick it as Verified. We record WHO verified and WHEN so the page can
-- show "Verified by X on date" and the tick can be toggled off to undo.

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id);

-- Fast filtering of un-verified rows on the reconciliation view.
CREATE INDEX IF NOT EXISTS idx_bank_txn_verified_at ON bank_transactions(verified_at);
