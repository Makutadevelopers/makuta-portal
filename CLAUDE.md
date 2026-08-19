# Makuta Accounts Module

## What this project is
A multi-role invoice and payment portal for a real estate company.
Vendors supply materials to construction sites. Site accountants enter
invoices. Head Office processes payments. MD views executive dashboards.

## Roles and what they can do
- **ho** (Head Accountant): full CRUD on invoices, payments, vendors, audit
- **mgmt** (Managing Director): read-only dashboards — no data entry
- **site** (Site Accountant): enter invoices for their site only,
  view category/vendor expenditure for their site, see Paid/Partial/Pending
  payment badge on own-site invoices (no amounts, no aging)

## Key business rules (enforce these rigorously)
- Site accountants see the payment_status badge (Paid / Partial / Not Paid)
  AND the outstanding balance for their own site's invoices, so the site
  dashboard can surface "outstanding per project". Aging data
  (total_paid, days_past_due, overdue) stays HO+mgmt only.
- Site accountants can open Vendor Master → Vendor Detail; the invoices
  and stats shown there are scoped to their assigned sites only (never
  another project's data) and the per-row Delete action is hidden.
- Minor payments ≤ ₹50,000 can be processed by site accountants directly
- Payments above ₹50,000 are HO-only
- One invoice can have MULTIPLE part-payments (payments[] array)
- Payment status auto-computes: sum(payments) = invoice_amount → Paid,
  sum > 0 but < invoice_amount → Partial, no payments → Not Paid
- Vendor due date = invoice_date + vendor.payment_terms (days)
- Overdue = today > due_date AND balance > 0
- All server responses must filter data by role — never trust client role claims

## Petty cash
- HO hands a per-site cash float to site accountants; site logs expenses
  against it. Balance per site = Σ(disbursements) − Σ(expenses).
- A petty-cash expense may optionally pay a site's invoice (≤ ₹50k for site
  role); in that case a `payments` row is created with payment_type =
  'petty_cash' so invoice.payment_status auto-recomputes.
- Visibility: HO sees all sites; site sees own site only; MD has no access.
- No approval workflow, no receipts required, no close-out — float rolls
  forward indefinitely.

## Bulk invoice import
- CSV/XLSX importer at `POST /api/import/invoices` (preview → commit).
  Header is read by name; unrecognised columns surface as a yellow
  warning in the preview UI, and missing required columns
  (Invoice date, Vendor Name, Invoice amount, Site Location) hard-stop
  the upload with a 400.
- Payment Status column accepts `Paid`, `Partial`, `Not Paid`. For `Paid`
  and `Partial`, the importer auto-writes a `payments` row (and a
  `bank_transactions` row for Cheque/NEFT/RTGS) so `payment_status`
  recomputes from real data — never trust the CSV's status label alone.
- `Paid Amount` column is **mandatory for Partial** (must be `> 0` and
  `< Invoice amount`); for `Paid` it's optional and defaults to the
  full invoice amount; ignored for `Not Paid`.
- Importer is **strict-by-default** since 2026-05-19. Bad rows reject in
  preview, never silently coerce. Specifically:
  - `parseDate` only accepts canonical patterns (YYYY-MM-DD, DD-MM-YYYY,
    DD-MMM-YY/YYYY, Excel serial). No JS `new Date(val)` fallback.
  - Paid/Partial rows missing/unparseable Payment Date → rejected.
  - Payment Type validated against `Cash | Cheque | NEFT | RTGS | IMPS | UPI`.
  - Payment Date before Invoice date → rejected (impossible business state).
- Full column spec and AI-conversion prompt live in
  [INVOICE_BULK_UPLOAD_PROMPT.md](INVOICE_BULK_UPLOAD_PROMPT.md).

### Repair tooling (historic corruption from old importer)
The importer used to silently fall back to `invoice_date` /
`'2001-01-01'` / `'Import'` when source cells were unparseable. Migrations
033-036 cleaned up 200+ corrupted payment rows; pre-repair values are
preserved in `payments_repair_snapshot` (tags `034_F7_type_has_digits`,
`035_F1_date_fallback`, `036_F8_epoch_sentinel`) for rollback. A
diagnostic `GET /api/admin/import-audit` (HO-only, temporary) returns
the current corruption fingerprint; raw queries in
`server/src/db/diagnostics/2026-05-19_import_corruption_audit.sql`.

### Human edits are final — repairs must never overwrite them (since 2026-05-20)
A value a person typed/edited through the app is the **source of truth** and
outranks any automated repair, importer re-run, or backfill. Repair migrations
recover data heuristically (e.g. parsing a misfiled date out of `payment_ref`);
that guess must NOT clobber a field a human already set by hand.
- "Edited" means there is an `audit_logs` row whose `action` starts with
  `Edited payment` / `Edited invoice` for that record, with the human's value
  in `metadata->'after'`. Treat that as immutable from a repair's point of view.
- **Every repair/backfill migration that touches `payments` (or `invoices`)
  must exclude human-edited rows.** Add this guard to the `UPDATE … WHERE`:
  ```sql
  AND id NOT IN (
    SELECT (metadata->>'paymentId')::uuid     -- or 'invoiceId'
    FROM audit_logs
    WHERE action LIKE 'Edited payment%'        -- or 'Edited invoice%'
      AND metadata ? 'paymentId'
  )
  ```
- Repair migration `040`/`042`/`043` predate this rule and DID overwrite
  hand-entered dates; migration `046_restore_human_edited_payment_dates.sql`
  restores them from the latest `Edited payment` audit entry (pre-restore
  values snapshotted under tag `046_restore_human_dates` for rollback).

## Tech stack
- **Production URL**: `https://invoice.makutadevelopers.com` (everything
  served from AWS — no Vercel, no split hosts).
- Frontend: React 18 + TypeScript + Tailwind CSS + Vite. Built into a
  Docker image (`infra/prod/Dockerfile.web` → multi-stage Vite build →
  nginx:alpine static server) and run as the `makuta_portal_web_prod`
  container on the same EC2 box as the API. The Vercel preview link
  that still appears on PRs is a leftover GitHub integration — NOT
  the production frontend; do not treat it as authoritative.
- Backend: Node.js + Express + TypeScript, Dockerised, runs as the
  `makuta_portal_api_prod` container.
- Hosting: AWS EC2 (`52.3.199.149`, `/opt/makuta-portal`), co-tenant
  with the CRM stack on the `crm_makuta_prod_net` Docker network. The
  CRM's public nginx fronts both `portal-web` (UI) and `portal-api`
  (`/api/*`) at `invoice.makutadevelopers.com`.
- Database: PostgreSQL on AWS RDS (us-east-1, SSL required).
- File storage: AWS S3 (us-east-1).
- Auth: JWT (8h expiry), bcrypt for password hashing.

## Coding standards
- TypeScript strict mode — no 'any'
- All API handlers use async/await with try/catch
- Database queries go in server/src/db/ — never inline SQL in controllers
- Use parameterised queries always — never string interpolation in SQL
- All amounts stored as NUMERIC(14,2) in DB, displayed in ₹ with en-IN locale
- Dates stored as DATE in PostgreSQL (no time component for invoice dates)
- UUIDs for all primary keys
- Run npm run lint and npm run typecheck before every commit

## Naming conventions
- Folders:          lowercase-with-hyphens
- React components: PascalCase.tsx
- Hooks:            useXxx.ts
- Utilities:        camelCase.ts
- Services:         camelCase.service.ts
- Routes:           camelCase.routes.ts
- Controllers:      camelCase.controller.ts
- SQL migrations:   001_create_table_name.sql  (snake_case + number prefix)
- SQL seeds:        001_seed_table_name.sql    (snake_case + number prefix)

## Common commands
This repo deploys directly to AWS — there is no local-dev stack.
The commands below are only useful for static checks and on the EC2 host.

Static (run anywhere):
- npm run typecheck    — TypeScript check across client + server
- npm run lint         — ESLint across the entire repo
- npm run build        — production build of client + server

Deployment:
- **Push to `main` IS the deploy.** `.github/workflows/deploy-prod.yml`
  triggers on every push, SSHes into the EC2 box, runs `git pull` and
  `./infra/prod/deploy.sh`, then probes `/api/health`. Typical run takes
  2–3 minutes. Track with `gh run list --workflow=deploy-prod.yml` and
  re-run from the Actions tab via `workflow_dispatch` if needed.
- Manual run on EC2 box (`52.3.199.149`, `/opt/makuta-portal`) — only if
  the GitHub Action is unavailable or you need a build-skipping variant:
  - ./infra/prod/deploy.sh                — pull, rebuild api+web images, restart containers, run migrations
  - ./infra/prod/deploy.sh --no-build     — restart containers only (no rebuild)
  - ./infra/prod/deploy.sh --migrate-only — apply pending migrations to RDS

## Sites (projects)
Nirvana, Taranga, Horizon, Green Wood Villas, Aruna Arcade, Office

Since migration 053 these live in the `sites` table, **not** in code. HO adds,
renames and archives them at **/projects (Project Master)** — no deploy needed.
- `client/src/utils/constants.ts` `SITES` is now only the seed + offline
  fallback. Read projects with the `useSites()` hook; server-side use
  `normaliseSiteName` / `isCanonicalSite` / `activeSiteNames` from
  `server/src/utils/sites.ts`, which read an in-process cache (60s TTL,
  refreshed eagerly on every write) so they can stay synchronous in the
  importer's per-row loop.
- Deliberately NOT a foreign key: `invoices.site`, `credit_notes.site`,
  `petty_cash_*.site` and `users.sites[]` all store the project NAME as text.
  A **rename therefore cascades** across all five in one transaction
  (`renameSite` in `sites.service.ts`), audit-logged with per-table counts so
  it can be reversed by renaming back.
- Projects are never hard-deleted — archiving (`active = false`) retires one
  from new dropdowns while historical records keep resolving.
- Migration 053 registers any site name already present in live data but not
  canonical (e.g. `Villa No -140 Honer Homes`, 1 invoice) as **archived**, so
  typo/import phantoms are visible to HO instead of silently invisible.

## Do not modify without discussion
- server/src/middleware/rbac.ts
- server/src/db/migrations/ (create new files, never edit existing ones)
