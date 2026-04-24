# Makuta Accounts Module

## What this project is
A multi-role invoice and payment portal for a real estate company.
Vendors supply materials to construction sites. Site accountants enter
invoices. Head Office processes payments. MD views executive dashboards.

## Roles and what they can do
- **ho** (Head Accountant): full CRUD on invoices, payments, vendors, audit
- **mgmt** (Managing Director): read-only dashboards — no data entry
- **site** (Site Accountant): enter invoices for their site only,
  view category/vendor expenditure for their site, NO payment status data

## Key business rules (enforce these rigorously)
- Site accountants CANNOT see payment status, paid/unpaid amounts, or aging
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
- Frontend: React 18 + TypeScript + Tailwind CSS + Vite
- Backend: Node.js + Express + TypeScript
- Database: PostgreSQL (AWS RDS, ap-south-1)
- File storage: AWS S3 (ap-south-1)
- Auth: JWT (8h expiry), bcrypt for password hashing

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
- npm run dev          — start client (:5173) and server (:4000)
- npm run db:migrate   — run pending SQL migrations
- npm run db:seed      — run all seed files
- npm run db:reset     — drop tables, re-migrate, re-seed
- npm run typecheck    — TypeScript check across client + server
- npm run lint         — ESLint across the entire repo

## Sites
Nirvana, Taranga, Horizon, Green Wood Villas, Aruna Arcade, Office

## Do not modify without discussion
- server/src/middleware/rbac.ts
- server/src/db/migrations/ (create new files, never edit existing ones)
