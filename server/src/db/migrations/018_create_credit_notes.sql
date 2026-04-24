-- 018_create_credit_notes.sql
-- Credit notes from vendors (returns, rate corrections, short supply, discounts, etc.)
-- A CN can be allocated to one or more invoices (reducing effective payable),
-- or left unallocated as a vendor credit balance that HO can apply later.

-- ── credit_notes ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cn_no           TEXT NOT NULL,
  cn_date         DATE NOT NULL,
  vendor_id       UUID NOT NULL REFERENCES vendors(id),
  vendor_name     TEXT NOT NULL,
  site            TEXT NOT NULL,
  -- GST split mirrors invoices (migration 016)
  base_amount     NUMERIC(14,2) NOT NULL,
  cgst_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,
  sgst_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,
  igst_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(14,2) NOT NULL,
  remarks         TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES users(id),
  CONSTRAINT credit_notes_total_positive CHECK (total_amount > 0),
  CONSTRAINT credit_notes_base_positive  CHECK (base_amount > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_notes_vendor_cn_no
  ON credit_notes(vendor_id, cn_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_credit_notes_vendor     ON credit_notes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_site       ON credit_notes(site);
CREATE INDEX IF NOT EXISTS idx_credit_notes_created_by ON credit_notes(created_by);
CREATE INDEX IF NOT EXISTS idx_credit_notes_deleted_at ON credit_notes(deleted_at);

-- ── credit_note_allocations (N:N with invoices) ───────────
CREATE TABLE IF NOT EXISTS credit_note_allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id    UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  invoice_id        UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  allocated_amount  NUMERIC(14,2) NOT NULL,
  allocated_by      UUID REFERENCES users(id),
  allocated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (credit_note_id, invoice_id),
  CONSTRAINT cn_alloc_positive CHECK (allocated_amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_cn_alloc_invoice ON credit_note_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_cn_alloc_cn      ON credit_note_allocations(credit_note_id);

-- ── trigger: allocation cannot exceed credit note total ──
CREATE OR REPLACE FUNCTION check_cn_allocation_cap() RETURNS TRIGGER AS $$
DECLARE
  total_allocated NUMERIC(14,2);
  cn_total        NUMERIC(14,2);
BEGIN
  SELECT total_amount INTO cn_total FROM credit_notes WHERE id = NEW.credit_note_id;
  SELECT COALESCE(SUM(allocated_amount), 0) INTO total_allocated
    FROM credit_note_allocations
    WHERE credit_note_id = NEW.credit_note_id
      AND id IS DISTINCT FROM NEW.id;
  IF total_allocated + NEW.allocated_amount > cn_total THEN
    RAISE EXCEPTION 'Allocation exceeds credit note total (allocated % + new % > cn total %)',
      total_allocated, NEW.allocated_amount, cn_total;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_cn_allocation_cap ON credit_note_allocations;
CREATE TRIGGER trg_check_cn_allocation_cap
  BEFORE INSERT OR UPDATE ON credit_note_allocations
  FOR EACH ROW EXECUTE FUNCTION check_cn_allocation_cap();

-- ── trigger: total allocations to an invoice cannot exceed invoice_amount ──
CREATE OR REPLACE FUNCTION check_invoice_credit_cap() RETURNS TRIGGER AS $$
DECLARE
  total_allocated NUMERIC(14,2);
  inv_amount      NUMERIC(14,2);
BEGIN
  SELECT invoice_amount INTO inv_amount FROM invoices WHERE id = NEW.invoice_id;
  SELECT COALESCE(SUM(allocated_amount), 0) INTO total_allocated
    FROM credit_note_allocations
    WHERE invoice_id = NEW.invoice_id
      AND id IS DISTINCT FROM NEW.id;
  IF total_allocated + NEW.allocated_amount > inv_amount THEN
    RAISE EXCEPTION 'Allocation exceeds invoice amount (allocated % + new % > invoice %)',
      total_allocated, NEW.allocated_amount, inv_amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_invoice_credit_cap ON credit_note_allocations;
CREATE TRIGGER trg_check_invoice_credit_cap
  BEFORE INSERT OR UPDATE ON credit_note_allocations
  FOR EACH ROW EXECUTE FUNCTION check_invoice_credit_cap();

-- ── audit_logs: extend for credit note actions ───────────
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS credit_note_id UUID REFERENCES credit_notes(id);
CREATE INDEX IF NOT EXISTS idx_audit_credit_note ON audit_logs(credit_note_id);

-- ── attachments: extend to support CN attachments ────────
-- Polymorphic: exactly one of (invoice_id, credit_note_id) is set.
ALTER TABLE attachments ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS credit_note_id UUID REFERENCES credit_notes(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attachments_exactly_one_parent'
  ) THEN
    ALTER TABLE attachments ADD CONSTRAINT attachments_exactly_one_parent
      CHECK ((invoice_id IS NOT NULL)::int + (credit_note_id IS NOT NULL)::int = 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_attachments_credit_note ON attachments(credit_note_id);
