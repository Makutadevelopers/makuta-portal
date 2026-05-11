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

## Where it runs

The application runs **only on AWS** — there is no local dev stack.

| Component | Where |
|-----------|-------|
| Frontend (React + Vite + PWA) | Built into the API container, served via nginx on EC2 |
| Backend (Node + Express) | Docker container `makuta_portal_api_prod` on EC2 `52.3.199.149` (`/opt/makuta-portal`) |
| Database | AWS RDS PostgreSQL 16 (us-east-1, SSL required) — DB_HOST/DB_USER/DB_PASSWORD in `/opt/makuta-portal/infra/prod/.env` |
| File storage | AWS S3 (`makuta-invoice-attachments`, us-east-1) |
| HTTPS / domain | Cloudflare DNS → CRM nginx fronts `invoice.makutadevelopers.com` |
| Daily DB backup | GitHub Actions workflow `daily-db-backup.yml` (artifact retention 90 days) |

Tech stack:

| Component | Technology |
|-----------|-----------|
| Frontend | React 18 + TypeScript + Tailwind CSS + Recharts |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL (AWS RDS) |
| Build Tool | Vite + PWA plugin |
| Auth | JWT (8h expiry) + bcrypt |
| Charts | Recharts |
| Cron | node-cron (daily overdue email alerts at 8 AM IST) |

## Deploy / redeploy

The deploy script is idempotent — safe to re-run after a `git pull`.

```bash
# from your laptop, push code via PR → merge to main:
git push origin <feature-branch>
# open PR at https://github.com/Makutadevelopers/makuta-portal
# merge after CI passes

# from the EC2 box (52.3.199.149) as the deploy user:
cd /opt/makuta-portal
git pull
./infra/prod/deploy.sh                    # build + up + migrate
./infra/prod/deploy.sh --no-build         # skip rebuild, just up
./infra/prod/deploy.sh --migrate-only     # just run pending migrations
```

The script runs `npx tsx src/db/migrate.ts` inside `makuta_portal_api_prod`, which applies any new SQL files in `server/src/db/migrations/` to the RDS database.

Required environment variables (already set in `/opt/makuta-portal/infra/prod/.env` — see `infra/prod/.env.prod.example` for the full list):

```bash
# Database — AWS RDS Postgres
DB_HOST=...rds.amazonaws.com
DB_USER=makuta_admin
DB_PASSWORD=<strong>
DB_NAME=makuta_portal
DB_SSL=true

# Auth
JWT_SECRET=<at least 48 chars>
ALLOWED_ORIGINS=https://invoice.makutadevelopers.com

# Runtime
NODE_ENV=production
CRON_SECRET=<openssl rand -hex 32>
APP_URL=https://invoice.makutadevelopers.com
CRM_FRAME_ORIGINS=https://crm.makutadevelopers.com

# Email (optional — leave blank to disable notifications)
SMTP_HOST=...
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=noreply@makutadevelopers.com
HO_NOTIFY_TO=raju@makuta.in     # who gets overdue / push / payment alerts

# S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=makuta-invoice-attachments
```

## Sites

Nirvana, Taranga, Horizon, Green Wood Villas, Aruna Arcade, Office

## Documentation

- [PRESENTATION.md](PRESENTATION.md) — Full application guide with roles, workflows, calculations, and user manual
- [CLAUDE.md](CLAUDE.md) — Coding standards and business rules
