-- 039_repair_batch_90209c92_date_shift.sql
--
-- Supersedes the never-applied, snapshot-less 031_fix_batch_90209c92_dates.sql.
-- The XLSX import that created batch 90209c92 on 2026-04-11 ran on an
-- east-of-UTC host; SheetJS aligned date cells to LOCAL midnight and the
-- importer's .toISOString().split('T')[0] then rolled each date back to the
-- PREVIOUS day. Every invoice in the batch is stored exactly one day early.
--
-- Confirmed live on 2026-05-20 via GET /api/admin/import-audit (d7): all four
-- reference invoices (SCMP25059012/15, SCMP25060488, SCMP25060831) read one
-- day before their CSV-known dates -> status "pending". The parser was already
-- fixed to use local getters, so this is a one-time data repair.
--
-- Unlike 031 this snapshots every affected row first (into
-- invoices_date_repair_snapshot, tag '039_tz_shift') so the shift is fully
-- reversible, and it is tracked in schema_migrations so it runs exactly once.
-- The untracked 031 file must NOT also be committed/run, or dates double-shift.

CREATE TABLE IF NOT EXISTS invoices_date_repair_snapshot (
  snapshot_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  repair_tag    TEXT NOT NULL,
  invoice_id    UUID NOT NULL,
  invoice_no    TEXT,
  batch_id      UUID,
  invoice_date  DATE,
  month         DATE
);

INSERT INTO invoices_date_repair_snapshot
  (repair_tag, invoice_id, invoice_no, batch_id, invoice_date, month)
SELECT '039_tz_shift', id, invoice_no, batch_id, invoice_date, month
FROM invoices
WHERE batch_id = '90209c92-5c25-4ddc-8cd1-e01e36ff9610';

UPDATE invoices
SET invoice_date = invoice_date + INTERVAL '1 day',
    month        = (date_trunc('month', invoice_date + INTERVAL '1 day'))::date,
    updated_at   = NOW()
WHERE batch_id = '90209c92-5c25-4ddc-8cd1-e01e36ff9610';
