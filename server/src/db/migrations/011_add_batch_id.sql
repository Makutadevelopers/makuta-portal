-- 011_add_batch_id.sql
-- Tag imported rows with a batch_id so bulk imports can be undone
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_invoices_batch ON invoices(batch_id);
CREATE INDEX IF NOT EXISTS idx_payments_batch ON payments(batch_id);
