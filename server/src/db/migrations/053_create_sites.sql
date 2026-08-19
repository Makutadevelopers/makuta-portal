-- 053_create_sites.sql
-- Promotes "site" (a project) from a hardcoded constant to a real table, so HO
-- can open a new project from the Project Master page instead of needing a code
-- change + deploy. Mirrors the banks table added in 026.
--
-- Deliberately NOT a foreign key. invoices.site, credit_notes.site,
-- petty_cash_*.site and users.sites[] all store the site NAME as text, and
-- 5,300+ historical rows depend on that. Converting them to site_id would be a
-- far larger, riskier migration for no gain here — this table is a registry
-- that drives dropdowns and validation, and renames cascade explicitly in
-- sites.service.ts (transactional + audit-logged).

CREATE TABLE IF NOT EXISTS sites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_name_lower
  ON sites (LOWER(name));

-- Seed the six canonical projects so the dropdowns are byte-identical to
-- today's behaviour the moment this deploys.
INSERT INTO sites (name) VALUES
  ('Nirvana'), ('Taranga'), ('Horizon'),
  ('Green Wood Villas'), ('Aruna Arcade'), ('Office')
ON CONFLICT DO NOTHING;

-- Register every OTHER site name that already exists in live data, as
-- INACTIVE. These are phantom projects created by typos or bulk imports that
-- slipped past the preview warning (e.g. "Villa No -140 Honer Homes", 1
-- invoice). Seeding them inactive means:
--   - nothing is hidden: HO sees them listed as archived and can activate,
--     rename, or reassign the stray rows,
--   - they stay out of every dropdown, so the typo can't spread further.
-- Discovering them from the data rather than hardcoding a list keeps this
-- correct whatever the production data actually holds.
INSERT INTO sites (name, active)
SELECT DISTINCT TRIM(s.site), FALSE
  FROM (
    SELECT site FROM invoices                 WHERE site IS NOT NULL
    UNION SELECT site FROM credit_notes       WHERE site IS NOT NULL
    UNION SELECT site FROM petty_cash_disbursements WHERE site IS NOT NULL
    UNION SELECT site FROM petty_cash_expenses      WHERE site IS NOT NULL
    UNION SELECT UNNEST(sites) FROM users
  ) s
 WHERE TRIM(s.site) <> ''
   AND NOT EXISTS (
     SELECT 1 FROM sites x WHERE LOWER(x.name) = LOWER(TRIM(s.site))
   )
ON CONFLICT DO NOTHING;
