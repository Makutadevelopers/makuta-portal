-- 015_create_bank_transactions.sql
-- Supports bulk cheque / bank transfers that span multiple invoices.
-- A single bank_transaction (e.g., one cheque) can be allocated across
-- many invoices via payments.bank_txn_id. This enables the Bank
-- Reconciliation view where cheque amount is tallied against the
-- sum of linked invoice allocations.

CREATE TABLE IF NOT EXISTS bank_transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_type     TEXT NOT NULL,
  txn_ref      TEXT NOT NULL,
  txn_amount   NUMERIC(14,2) NOT NULL,
  txn_date     DATE NOT NULL,
  bank         TEXT,
  remarks      TEXT,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_txn_ref  ON bank_transactions(txn_ref);
CREATE INDEX IF NOT EXISTS idx_bank_txn_date ON bank_transactions(txn_date);

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS bank_txn_id UUID REFERENCES bank_transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_bank_txn ON payments(bank_txn_id);
