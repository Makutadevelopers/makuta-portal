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
  for their own site's invoices, but NOT paid/unpaid amounts or aging data
  (total_paid, balance, days_past_due, overdue stay HO+mgmt only)
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

Deployment (run on EC2 box `52.3.199.149`, `/opt/makuta-portal`):
- ./infra/prod/deploy.sh                — pull, rebuild api+web images, restart containers, run migrations
- ./infra/prod/deploy.sh --no-build     — restart containers only (no rebuild)
- ./infra/prod/deploy.sh --migrate-only — apply pending migrations to RDS

**A merge to `main` does NOT auto-deploy** — both the React SPA and the
Express API are baked into Docker images on the EC2 box, so every
client OR server change requires `deploy.sh` to be re-run on the host.

## Sites
Nirvana, Taranga, Horizon, Green Wood Villas, Aruna Arcade, Office

## Do not modify without discussion
- server/src/middleware/rbac.ts
- server/src/db/migrations/ (create new files, never edit existing ones)
