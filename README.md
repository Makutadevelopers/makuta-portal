# Makuta Accounts Module

Multi-role invoice and payment portal for **Makuta Developers** — a real estate company managing construction sites across Hyderabad.

## Roles & Logins

| Role | Name | Email | Password | Access |
|------|------|-------|----------|--------|
| Head Accountant | Raju S | raju@makuta.in | ho123 | Full access — invoices, payments, vendors, audit, bulk import |
| Managing Director | Harsha | harsha@makuta.in | md123 | Executive dashboards + Employee Management |
| Site Accountant | Ramana | ramana@makuta.in | nv123 | Nirvana — enter invoices, view expenditure |
| Site Accountant | Veerandhar | veerandhar@makuta.in | tr123 | Taranga |
| Site Accountant | Madhu | madhu@makuta.in | hz123 | Horizon |
| Site Accountant | Madhu | madhu.gw@makuta.in | gw123 | Green Wood Villas |
| Site Accountant | Ramana | ramana.aa@makuta.in | aa123 | Aruna Arcade |
| Site Accountant | Thanug | thanug@makuta.in | of123 | Office |

## Features

- **HO Dashboard** — KPIs, site-wise breakdown, interactive Recharts, overdue alerts
- **Site Dashboard** — KPI cards, monthly trends, top categories/vendors (no payment data)
- **Invoices** — Create, edit, delete, bulk import (CSV/XLSX), export PDF
- **Payments** — Individual + bulk pay, bank reconciliation, cheque/NEFT tracking
- **Cashflow** — Expenditure vs payments pivot table by month
- **Vendor Master** — Click vendor name for detail page with invoice history
- **Payment Aging** — Overdue tracking with aging buckets (0-30, 31-60, 61-90, 90+)
- **Employee Management** — MD can add/edit/deactivate users, reset passwords
- **Audit Trail** — Complete log of all actions
- **Notifications** — Bell icon with duplicate invoice alerts (HO)
- **Tally Integration** — Export payment vouchers as Tally-compatible XML
- **PWA** — Installable on mobile/desktop, offline support with cached data
- **Cron** — Daily overdue email alerts at 8 AM IST

## Quick Start (Local Dev)

```bash
# 1. Start PostgreSQL
docker compose up -d postgres

# 2. Install dependencies
cd client && npm install && cd ../server && npm install && cd ..

# 3. Set up environment
cp .env.example .env
# Edit .env if needed (defaults work with docker compose)

# 4. Run migrations & seed data
npm run db:reset

# 5. Start dev servers
npm run dev
# Client: http://localhost:3000
# Server: http://localhost:4000
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 18 + TypeScript + Tailwind CSS + Recharts |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL |
| Build Tool | Vite + PWA plugin |
| Auth | JWT (8h expiry) + bcrypt |
| Charts | Recharts (interactive with tooltips) |
| Cron | node-cron (overdue alerts) |
| Storage | AWS S3 (or local disk for dev) |

## Deployment

| Component | Platform |
|-----------|----------|
| Frontend | Vercel (auto-deploys from GitHub) |
| Backend | Render / Railway |
| Database | Supabase / Neon (managed PostgreSQL) |

```bash
# Required environment variables for production:
DATABASE_URL=postgresql://...     # From Supabase/Neon
JWT_SECRET=<openssl rand -hex 48> # Min 48 chars
ALLOWED_ORIGINS=*                 # Or frontend URL
NODE_ENV=production
CRON_SECRET=<any random string>   # For scheduled jobs
```

## Sites

Nirvana, Taranga, Horizon, Green Wood Villas, Aruna Arcade, Office

## Documentation

- [PRESENTATION.md](PRESENTATION.md) — Full application guide with roles, workflows, calculations, and user manual
- [CLAUDE.md](CLAUDE.md) — Coding standards and business rules
