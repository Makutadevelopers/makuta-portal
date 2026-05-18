-- 030_perf_indexes.sql
-- Fills in the indexes that the hot list/dashboard queries scan without.
-- All four are additive (CREATE INDEX IF NOT EXISTS) and complete in well
-- under a second at current table sizes, so no online-build trick is needed.
-- The brief AccessExclusive lock per CREATE INDEX is masked by the
-- container restart that follows on the same deploy.

-- attachments(invoice_id) — FK column with no explicit index. The invoice
-- list joins attachments per invoice; without this it sequential-scans.
CREATE INDEX IF NOT EXISTS idx_attachments_invoice
  ON attachments(invoice_id);

-- invoices(invoice_date DESC, created_at DESC) — the ORDER BY of every
-- list-view query. Partial WHERE keeps the index small (only live rows).
CREATE INDEX IF NOT EXISTS idx_invoices_live_date
  ON invoices(invoice_date DESC, created_at DESC)
  WHERE deleted_at IS NULL;

-- payments(payment_date) — cashflow page groups by month from this column.
CREATE INDEX IF NOT EXISTS idx_payments_date
  ON payments(payment_date);

-- audit_logs(created_at DESC) — audit list ORDER BY a.created_at DESC.
CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at DESC);
