-- 008_add_soft_delete.sql
-- Soft-delete support: invoices go to bin instead of being permanently deleted.
-- Auto-purge after 30 days.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_deleted ON invoices(deleted_at) WHERE deleted_at IS NOT NULL;
