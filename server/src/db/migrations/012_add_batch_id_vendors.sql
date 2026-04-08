-- 012_add_batch_id_vendors.sql
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS batch_id UUID;
CREATE INDEX IF NOT EXISTS idx_vendors_batch ON vendors(batch_id);
