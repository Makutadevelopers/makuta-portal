-- 019_create_petty_cash.sql
-- Petty cash float tracked per SITE (Nirvana, Taranga, Horizon, …).
-- HO disburses cash to a site (adds to the float).
-- Site accountant logs expenses (draws from the float).
-- An expense may optionally link to an invoice — in which case the expense
-- also records a row in `payments` so invoice.payment_status auto-recomputes.
-- Balance per site = Σ(disbursements) − Σ(expenses), computed at query time.
--
-- Visibility: HO sees all sites; site sees own site only; MD has no access.

-- ── disbursements: HO hands cash to a site ──────────────────────────────
CREATE TABLE IF NOT EXISTS petty_cash_disbursements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site            TEXT NOT NULL,
  amount          NUMERIC(14,2) NOT NULL,
  given_on        DATE NOT NULL,
  given_by        UUID NOT NULL REFERENCES users(id),
  mode            TEXT NOT NULL DEFAULT 'cash',
  reference       TEXT,
  remarks         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES users(id),
  CONSTRAINT pcd_amount_positive CHECK (amount > 0),
  CONSTRAINT pcd_mode_valid      CHECK (mode IN ('cash','bank'))
);

CREATE INDEX IF NOT EXISTS idx_pcd_site     ON petty_cash_disbursements(site) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pcd_given_on ON petty_cash_disbursements(given_on DESC);

-- ── expenses: site spends from the float ────────────────────────────────
-- invoice_id + payment_id are optional; set together when a site pays a
-- small invoice from petty cash (≤ ₹50k — enforced in controller).
CREATE TABLE IF NOT EXISTS petty_cash_expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site            TEXT NOT NULL,
  amount          NUMERIC(14,2) NOT NULL,
  spent_on        DATE NOT NULL,
  purpose         TEXT NOT NULL,
  invoice_id      UUID REFERENCES invoices(id) ON DELETE SET NULL,
  payment_id      UUID REFERENCES payments(id) ON DELETE SET NULL,
  recorded_by     UUID NOT NULL REFERENCES users(id),
  remarks         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES users(id),
  CONSTRAINT pce_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_pce_site       ON petty_cash_expenses(site) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pce_spent_on   ON petty_cash_expenses(spent_on DESC);
CREATE INDEX IF NOT EXISTS idx_pce_invoice_id ON petty_cash_expenses(invoice_id) WHERE invoice_id IS NOT NULL;
