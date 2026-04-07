# Makuta Developers — Unified Business Portal
## Seed Document for Claude Code Agent

**Company:** Makuta Developers, Hyderabad — Real estate developer
**Portal:** Single unified system covering three integrated modules
**Stack:** React 19 + TypeScript + Vite 8 (frontend) · Node.js + Express 5 + TypeScript (API) · PostgreSQL 15 + Prisma 7
**Created:** April 2026

---

## IMPORTANT — READ THIS FIRST

This is a **three-module unified portal** sharing one database, one login system, and one deployment. Do NOT build them as separate apps. Every user logs in once and sees only the tabs their role permits.

```
MODULE 1: Sales & CRM          MODULE 2: Invoice Portal        MODULE 3: Admin Dashboard
─────────────────────          ────────────────────────        ──────────────────────────
Leads → Bookings               Vendor invoices                 Sees BOTH sides
Customer collections            Material payments               P&L per project
INFLOW (money coming in)        OUTFLOW (money going out)       NMR tracking & inputs
```

---

## PART 1 — PROJECT STRUCTURE

```
makuta-portal/
├── package.json                       ← monorepo root (npm workspaces)
├── docker-compose.yml                 ← PostgreSQL 15 + Redis 7
├── api/
│   ├── package.json                   ← Express 5, Prisma 7, bcrypt, JWT, zod
│   ├── tsconfig.json
│   ├── prisma.config.ts               ← Prisma 7 requires this for datasource URL
│   ├── .env
│   ├── prisma/
│   │   ├── schema.prisma              ← 10 models
│   │   ├── migrations/
│   │   └── seed/index.ts              ← 13 users + sample data
│   ├── scripts/
│   │   ├── generate-csv.ts            ← generates dummy vendor/invoice/payment CSVs
│   │   └── import-csv.ts             ← imports CSVs into database
│   ├── vendors.csv                    ← 128 vendors
│   ├── invoices.csv                   ← 1,052 invoices
│   ├── payments.csv                   ← 230 payments
│   └── src/
│       ├── app.ts                     ← Express entry point
│       ├── lib/
│       │   ├── prisma.ts              ← PrismaClient with PrismaPg adapter
│       │   └── audit.ts               ← audit log helper
│       ├── middleware/
│       │   ├── auth.ts                ← JWT verification from HttpOnly cookies
│       │   └── rbac.ts                ← role-based access + site scope enforcement
│       ├── routes/
│       │   ├── auth.ts                ← login, logout, /me
│       │   ├── vendors.ts             ← CRUD (ho only for write)
│       │   ├── invoices.ts            ← CRUD + push + payments
│       │   ├── payments.ts            ← list all payments
│       │   ├── leads.ts               ← CRUD (sales own, sales_mgr all)
│       │   ├── bookings.ts            ← CRUD + collections
│       │   ├── collections.ts         ← record payment received
│       │   ├── nmr.ts                 ← CRUD (admin only write)
│       │   ├── dashboard.ts           ← 7 dashboard endpoints
│       │   └── audit.ts               ← audit trail (ho only)
│       └── types/index.ts
└── web/
    ├── package.json                   ← React 19, React Router 7, TanStack Query, Axios
    ├── vite.config.ts                 ← proxy /api → localhost:4000
    ├── tailwind.config.js             ← Inter font, brand colors
    ├── postcss.config.js
    ├── index.html                     ← Google Fonts Inter loaded
    └── src/
        ├── main.tsx
        ├── App.tsx                    ← routing + auth provider + query client
        ├── index.css                  ← Tailwind + design system classes
        ├── types/index.ts             ← User, RoleCode, ROLE_TABS
        ├── utils/
        │   ├── api.ts                 ← axios instance with credentials + 401 redirect
        │   └── format.ts             ← formatCurrency, formatDate, statusColor
        ├── hooks/
        │   └── useAuth.tsx            ← AuthContext + provider
        ├── components/
        │   ├── Layout.tsx             ← header + tab nav + outlet
        │   └── StatCard.tsx           ← KPI stat card component
        └── pages/
            ├── auth/LoginPage.tsx     ← split-panel login
            ├── DashboardPage.tsx      ← HO dashboard with KPIs + site table
            ├── invoice/
            │   ├── InvoicesPage.tsx    ← table + search + filters + CRUD
            │   ├── InvoiceModal.tsx    ← create/edit/view modal
            │   ├── PaymentModal.tsx    ← record payment modal
            │   ├── VendorsPage.tsx     ← vendor master + CRUD modal
            │   ├── AgingPage.tsx       ← payment aging buckets
            │   ├── CashflowPage.tsx    ← monthly x site payment matrix
            │   └── AuditPage.tsx       ← audit trail with filters
            ├── crm/
            │   ├── LeadsPage.tsx       ← placeholder
            │   ├── BookingsPage.tsx    ← placeholder
            │   └── CrmDashboardPage.tsx ← placeholder
            └── admin/
                ├── AdminDashboardPage.tsx ← placeholder
                └── NmrPage.tsx         ← placeholder
```

---

## PART 2 — TECH STACK DETAILS

### Root package.json
```json
{
  "name": "makuta-portal",
  "private": true,
  "workspaces": ["api", "web"],
  "scripts": {
    "dev:api": "npm run dev --workspace=api",
    "dev:web": "npm run dev --workspace=web",
    "dev": "concurrently \"npm run dev:api\" \"npm run dev:web\"",
    "db:migrate": "npm run migrate --workspace=api",
    "db:seed": "npm run seed --workspace=api"
  },
  "devDependencies": { "concurrently": "^9.2.1" }
}
```

### API Dependencies
```
express@5.2.1, @prisma/client@7.6.0, prisma@7.6.0, @prisma/adapter-pg@7.6.0,
pg@8.20.0, bcrypt@6.0.0, jsonwebtoken@9.0.3, cookie-parser@1.4.7,
cors@2.8.6, helmet@8.1.0, dotenv@17.4.1, zod@4.3.6
```
Dev: `typescript@6.0.2, ts-node@10.9.2, nodemon@3.1.14, @types/*`

### Web Dependencies
```
react@19.2.4, react-dom@19.2.4, react-router-dom@7.14.0,
@tanstack/react-query@5.96.2, axios@1.14.0
```
Dev: `vite@8.0.4, typescript@6.0.2, tailwindcss@3.4.19, postcss, autoprefixer`

### Docker
```yaml
services:
  postgres:
    image: postgres:15
    environment: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: makuta_portal }
    ports: ["5434:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7
    ports: ["6379:6379"]
```

### API .env
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/makuta_portal"
JWT_SECRET="makuta_secret_change_in_production"
JWT_EXPIRES_IN="8h"
CLIENT_URL="http://localhost:5174"
PORT=4000
```

---

## PART 3 — DATABASE SCHEMA (Prisma)

### IMPORTANT: Prisma 7 Setup
Prisma 7 removed `url` from `datasource` block in schema.prisma. You need:

1. `prisma.config.ts` at api root:
```typescript
import path from 'node:path';
import { defineConfig } from 'prisma/config';
import dotenv from 'dotenv';
dotenv.config();
export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  datasource: { url: process.env.DATABASE_URL! },
  migrate: { url: process.env.DATABASE_URL! },
});
```

2. PrismaClient needs adapter:
```typescript
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });
```

### Models (10 tables)

**Users** — id (UUID), name, email (unique, optional), passwordHash, role (enum: ho/site/mgmt/sales/sales_mgr/admin), site, title, isActive

**Vendors** — id, name (unique), paymentTerms (default 30), category, gstin, contactName, phone, email, notes

**Invoices** — id, slNo (autoincrement), month (date), invoiceDate, vendorId (FK), vendorName, invoiceNo, poNumber, purpose, site, invoiceAmount (decimal 14,2), paymentStatus (enum: Not Paid/Partial/Paid), remarks, pushed (bool), minorPayment (bool), createdBy, approvedBy, approvedAt. Unique constraint on (invoiceNo, vendorName). Indexes on site, paymentStatus, month.

**Payments** — id, invoiceId (FK cascade), amount (decimal 14,2), paymentType (enum: Cheque/NEFT/RTGS/UPI/Cash), paymentDate, paymentRef, bank, recordedBy

**Attachments** — id, invoiceId (FK cascade), fileName, fileSize, mimeType, s3Key, uploadedBy

**AuditLogs** — id, userId (FK), action, module (default 'invoice'), entityId, metadata (JSON), createdAt (desc index)

**Leads** — id, customerName, mobile, email, visitDate, executive, source (enum: Walk-in/Presales/Meta/Google/Reference/Hoarding/Event/WhatsApp/Other), status (enum: Interested/Follow-up/Site Visit Scheduled/Site Visit Done/Negotiation/Booked/Not Interested/Lost), location, remarks, createdBy

**Bookings** — id, leadId (FK), customerName, mobile, email, site, unitNo, unitType, totalValue (decimal 14,2), bookingDate, executive, status (enum: Active/Cancelled/Completed), remarks, createdBy

**Collections** — id, bookingId (FK cascade), milestone, scheduledDate, scheduledAmount (decimal 14,2), receivedAmount (decimal 14,2 default 0), receivedDate, paymentType, paymentRef, bank, status (enum: Pending/Partial/Received/Overdue), recordedBy

**NmrEntries** — id, bookingId (FK), customerName, unitNo, site, demandDate, demandAmount (decimal 14,2), collectedAmount (decimal 14,2 default 0), dueDate, status (enum: Outstanding/Partially Collected/Collected/Waived/Cancelled), remarks, enteredBy

---

## PART 4 — USER SEED DATA (13 users)

| Name | Role | Site | Password | Title |
|---|---|---|---|---|
| Rajesh Kumar | ho | — | ho123 | Head Accountant |
| Arun Makuta | mgmt | — | md123 | Managing Director |
| Preethi Makuta | admin | — | ad123 | Admin — Accounts |
| Suresh Reddy | site | Nirvana | nv123 | Site Accountant |
| Priya Sharma | site | Taranga | tr123 | Site Accountant |
| Mahesh Babu | site | Horizon | hz123 | Site Accountant |
| Kavitha Rao | site | Green Wood Villas | gw123 | Site Accountant |
| Venkat Naidu | site | Aruna Arcade | aa123 | Site Accountant |
| Lakshmi Devi | site | Office | of123 | Site Accountant |
| Vijay Kumar | sales | — | sl123 | Sales Executive |
| Anitha Sharma | sales | — | sl456 | Sales Executive |
| Kavitha Menon | sales | — | sl789 | Sales Executive |
| Srinivas Rao | sales_mgr | — | sm123 | Sales Manager |

Passwords hashed with bcrypt cost 12. Login by name (not email).

---

## PART 5 — ROLE-BASED ACCESS CONTROL

```
Tab                    | ho  | site | mgmt | sales | sales_mgr | admin
───────────────────────────────────────────────────────────────────────
Dashboard (HO)         | ✓   |      |      |       |           |
All Invoices           | ✓   |      |      |       |           |
Payment Aging          | ✓   |      | ✓    |       |           |
Cashflow               | ✓   |      | ✓    |       |           | ✓(r)
Vendor Master          | ✓   |      |      |       |           |
Audit Trail            | ✓   |      |      |       |           |
My Invoices            |     | ✓    |      |       |           |
Site Expenditure       |     | ✓    |      |       |           |
Overview (Mgmt)        |     |      | ✓    |       |           |
My Leads               |     |      |      | ✓     |           |
All Leads              |     |      |      |       | ✓         |
CRM Dashboard          |     |      | ✓(r) |       | ✓         |
Bookings               |     |      |      | ✓     | ✓         |
Admin Dashboard        |     |      | ✓(r) |       | ✓(r)      | ✓
NMR                    |     |      |      |       |           | ✓
```

### Key rules
- JWT stored in **HttpOnly cookies** (never localStorage)
- RBAC enforced **server-side** on every route (middleware)
- Site accountants see **only their own site** (enforced via query filter)
- Site accountants **cannot see payment columns** at all
- Payment status **auto-computed** from SUM(payments), never manually set
- Pushed invoices are **immutable**
- Minor payment = invoice <= ₹50,000 (site accountants can pay directly)
- Return **403** (not 404) when access denied

---

## PART 6 — API ROUTES

### Auth
```
POST   /api/auth/login       ← { name, password } → sets HttpOnly cookie
POST   /api/auth/logout      ← clears cookie
GET    /api/auth/me           ← returns current user from cookie
```

### Invoice Module
```
GET    /api/vendors                     ← search, paginated
POST   /api/vendors                     ← ho only
PATCH  /api/vendors/:id                 ← ho only
DELETE /api/vendors/:id                 ← ho only

GET    /api/invoices                    ← filtered by role/site, search, paginated
GET    /api/invoices/:id                ← with payments (hidden for site role)
POST   /api/invoices                    ← ho, site (own site only)
PATCH  /api/invoices/:id                ← unpushed only
POST   /api/invoices/:id/push           ← ho only, irreversible
POST   /api/invoices/:id/payments       ← ho, or site if <=50k
GET    /api/invoices/:id/payments       ← not available to site role

GET    /api/payments                    ← ho, admin, mgmt

GET    /api/audit-logs                  ← ho only, filterable by module
```

### CRM Module
```
GET    /api/leads                       ← sales own, sales_mgr all
POST   /api/leads                       ← sales, sales_mgr
PATCH  /api/leads/:id                   ← sales own, sales_mgr all
DELETE /api/leads/:id                   ← sales_mgr only

GET    /api/bookings                    ← with collections
POST   /api/bookings                    ← auto-updates lead to Booked
PATCH  /api/bookings/:id
GET    /api/bookings/:id/collections
POST   /api/bookings/:id/collections

PATCH  /api/collections/:id             ← record payment, auto-compute status
```

### Admin / NMR Module
```
GET    /api/nmr                         ← admin, mgmt, sales_mgr
POST   /api/nmr                         ← admin only
PATCH  /api/nmr/:id                     ← admin only, auto-compute status
DELETE /api/nmr/:id                     ← admin only
```

### Dashboards
```
GET    /api/dashboard/ho                ← totals, by status, by site
GET    /api/dashboard/aging             ← 5 aging buckets
GET    /api/dashboard/cashflow          ← monthly x site payment matrix
GET    /api/dashboard/crm               ← leads by status/source, conversion rate
GET    /api/dashboard/admin             ← inflow + outflow + cash position
GET    /api/dashboard/pl                ← P&L per site
GET    /api/dashboard/cash-position     ← cash in vs cash out
GET    /api/dashboard/inflow            ← booking value, collections, by status
```

---

## PART 7 — UI DESIGN SYSTEM

### Font
Inter (Google Fonts) loaded in index.html:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

### Tailwind Config — Brand Colors
```js
brand: {
  50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
  400: '#60a5fa', 500: '#2563eb', 600: '#1d4ed8', 700: '#1e40af',
  800: '#1e3a8a', 900: '#172554',
}
```

### CSS Component Classes (defined in index.css via @layer components)
```css
.btn-primary    ← blue-600, white text, rounded-lg, shadow-sm, hover/focus/disabled states
.btn-secondary  ← white bg, gray border, rounded-lg, hover/focus states
.card           ← white, rounded-xl, border gray-200, shadow-sm
.input-field    ← full width, border, rounded-lg, focus ring brand-500
.input-label    ← text-sm, font-medium, gray-700, mb-1.5
.badge          ← inline-flex, rounded-full, text-xs, font-medium
.table-header   ← text-xs, font-semibold, uppercase, tracking-wider, gray-500
.table-cell     ← px-4, py-3.5, text-sm
```

### Login Page Design
Split layout:
- **Left panel (lg+):** Brand gradient (brand-600 → brand-900), grid pattern overlay, building icon, company name, 3 feature bullets, footer
- **Right panel:** Clean form with "Welcome back" heading, name + password fields, primary button with loading spinner
- **Mobile:** Single column, compact branding above form

### Layout (post-login)
- **Header:** White bg, brand logo icon (rounded-lg), "Makuta Portal" text, role badge, user avatar initials circle, sign out button with icon
- **Tab nav:** Sticky, white bg, border-b, NavLink with bottom border active state (brand-600), "view" micro-badge for read-only tabs
- **Content:** max-w-7xl, px-4/6/8 responsive, py-6

### StatCard Component
Props: label, value, subtitle, color (blue/green/red/yellow/gray), icon
Renders: rounded-xl card with colored bg/border, uppercase label, large value, optional icon in colored bg circle

### Table Pattern
- Card container with overflow-x-auto
- thead: bg-gray-50/80, table-header class (uppercase, xs, semibold)
- tbody: divide-y divide-gray-100, hover:bg-gray-50/50 transition
- Amounts right-aligned, font-semibold
- Status badges with statusColor() util
- Action buttons: px-2 py-1, colored text, hover colored bg, rounded

### Modal Pattern
- Backdrop: fixed inset-0, bg-black/40, backdrop-blur-sm, click-to-close
- Container: rounded-2xl, shadow-2xl, click stopPropagation
- Header: border-b border-gray-100, font-bold title, close button (rounded-lg hover:bg-gray-100)
- Footer: flex justify-end gap-3, btn-secondary + btn-primary

### Currency Formatting
```typescript
if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)} Cr`;
if (num >= 100000) return `₹${(num / 100000).toFixed(2)} L`;
return `₹${num.toLocaleString('en-IN')}`;
```

---

## PART 8 — BUSINESS RULES

### Invoice Portal (Module 2 — Outflow)
- payment_status = auto from SUM(payments): >= invoice_amount → Paid, > 0 → Partial, = 0 → Not Paid
- due_date = invoice_date + vendor.paymentTerms (default 30 days)
- minor_payment = invoice_amount <= 50000
- pushed = irreversible, blocks all edits
- site accountants: own site only, no payment columns visible
- aging buckets: Current, 1-30, 31-60, 61-90, 90+ days overdue

### CRM (Module 1 — Inflow)
- Lead → Booked creates a Booking automatically
- Collection status auto-computes: received >= scheduled → Received, > 0 → Partial, overdue if past date
- Sales execs see only own leads (filtered by executive = user.name)
- Conversion rate = booked / total leads

### Admin (Module 3 — NMR)
- NMR = Net Money Receivable (customer outstanding)
- balance_nmr = demand_amount - collected_amount (auto-computed)
- Only admin can CRUD NMR entries
- Admin dashboard shows: inflow + outflow + net cash position + P&L per site

### Sites
```
Nirvana | Taranga | Horizon | Green Wood Villas | Aruna Arcade | Office
```

### Invoice Categories (29)
```
Steel | Cement | Bricks | Aggregates | Hardware | Tiles | Plumbing Material |
Electrical Material | Scaffolding | Admixtures | Granite | Misc | RMC Service |
Painting Materials | Doors | Advertisement | Water Proofing | Consultant |
Fire Fighting | Contractor | Machinery | Loan | Miwan Shuttering | Tax |
Sales Refund | Lifts | Security Service | Diesel | Ms Sections & Tubes & Pipes
```

---

## PART 9 — BUILD SEQUENCE

1. Scaffold monorepo (api + web workspaces)
2. Docker compose (Postgres + Redis)
3. Prisma schema (10 models) + prisma.config.ts + migrate
4. Seed users (13) + sample leads/bookings/NMR
5. Generate dummy CSVs (128 vendors, 1052 invoices, 230 payments)
6. Import CSVs
7. Auth (login/logout/me with HttpOnly cookies)
8. RBAC middleware
9. All API routes
10. Frontend: Login → Layout → Dashboard → Invoice pages → CRM pages → Admin pages

### Commands
```bash
# Start infrastructure
docker-compose up -d

# Run migrations
cd api && npx prisma migrate dev --name init

# Generate Prisma client
npx prisma generate

# Seed database
npm run seed

# Generate + import CSV data
npm run generate-csv
npm run import-csv

# Dev servers (from root)
npm run dev
# Or separately:
cd api && npm run dev    # port 4000
cd web && npm run dev    # port 5174
```

---

*Makuta Developers — Unified Business Portal Seed Document — April 2026*
