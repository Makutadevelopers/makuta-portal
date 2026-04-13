# Makuta Accounts Module - Application Guide & Presentation

## 1. Overview

The **Makuta Accounts Module** is a multi-role invoice and payment portal built for **Makuta Developers**, a real estate company managing multiple construction sites across Hyderabad.

### Purpose
- Track invoices from vendors supplying materials to construction sites
- Process and record payments (Cheque/NEFT/Cash)
- Reconcile bank transactions against invoices
- Provide site-wise, vendor-wise, and category-wise financial reports
- Manage employees — add, edit, reset passwords, activate/deactivate
- Maintain a complete audit trail of all financial operations
- Works offline (PWA) — installable on mobile/desktop

### Key Numbers (Live Data)
| Metric | Value |
|--------|-------|
| Total Invoices | 1,213 |
| Paid Invoices | 250 |
| Unpaid Invoices | 963 |
| Total Vendors | 135 |
| Total Invoice Value | Rs.37,41,70,187 |
| Total Payments Made | Rs.8,69,79,980 |
| Bank Transactions | 71 |

---

## 2. User Roles & Permissions

### Role 1: Head Office Accountant (HO)
**Login:** raju@makuta.in / ho123

| Feature | Permission |
|---------|-----------|
| Dashboard | Full financial overview with interactive Recharts — all sites |
| All Invoices | Create, Edit, Delete, Import, Export |
| Payment Aging | View overdue invoices across all sites |
| Cashflow | View expenditure & payment cashflow |
| Vendor Master | Add, Edit, Delete vendors — click vendor name for detail page |
| Bank Reconciliation | Record bank transactions, allocate to invoices |
| Bulk Import | Import invoices/vendors from CSV/XLSX |
| Bulk Pay | Process payments for multiple invoices at once |
| Audit Trail | View all system activity logs |
| Bin (Soft Delete) | Restore or permanently delete invoices |
| Notifications | Bell icon with alerts for duplicate invoices |

### Role 2: Managing Director (MGMT)
**Login:** harsha@makuta.in / md123

| Feature | Permission |
|---------|-----------|
| Dashboard | Executive overview — all sites (READ ONLY) with interactive charts |
| Vendor Aging | Vendor-wise aging report |
| Cashflow | View expenditure & payment reports |
| Bank Reconciliation | View only |
| Employee Management | Add, Edit, Reset Password, Activate/Deactivate employees |

**Key feature:** MGMT can manage all employee accounts — create new users, assign roles/sites, reset passwords.

### Role 3: Site Accountant (SITE)
**Login:** ramana@makuta.in (Nirvana) / nv123, veerandhar@makuta.in (Taranga) / tr123, etc.

| Feature | Permission |
|---------|-----------|
| Site Dashboard | KPI cards, monthly trend, top categories/vendors, recent invoices |
| My Invoices | Create invoices for OWN SITE only |
| Expenditure | View category-wise and vendor-wise spending for own site |
| Minor Payments | Process payments <= Rs.50,000 |

**Key restrictions:**
- CANNOT see payment status, paid/unpaid amounts, or aging data
- CANNOT view or access other sites' data
- CANNOT process payments above Rs.50,000

---

## 3. Site Locations & Login Credentials

### Head Office & Management
| Role | Name | Email | Password |
|------|------|-------|----------|
| HO (Head Accountant) | Raju S | raju@makuta.in | ho123 |
| MD (Managing Director) | Harsha | harsha@makuta.in | md123 |

### Site Accountants
| Site | Name | Email | Password |
|------|------|-------|----------|
| Nirvana | Ramana | ramana@makuta.in | nv123 |
| Taranga | Veerandhar | veerandhar@makuta.in | tr123 |
| Horizon | Madhu | madhu@makuta.in | hz123 |
| Green Wood Villas | Madhu | madhu.gw@makuta.in | gw123 |
| Aruna Arcade | Ramana | ramana.aa@makuta.in | aa123 |
| Office | Thanug | thanug@makuta.in | of123 |

---

## 4. Feature Descriptions & Workflows

### 4.1 Dashboard
- **HO/MGMT:** KPI cards, site-wise expenditure table, payments due next 15 days, overdue panel, spend by category (Recharts bar chart), monthly trend (Recharts bar chart), vendor deduplication alerts
- **Site:** KPI cards (invoices count, total amount, categories, vendors), monthly invoice trend, top 5 categories, top 5 vendors, recent 10 invoices — NO payment data shown

### 4.2 All Invoices
The main invoice listing with filters:
- **Date Range:** Filter by invoice date period
- **Site:** Filter by construction site
- **Payment Status:** All / Paid / Partial / Not Paid
- **Category:** Filter by material category (Cement, Steel, etc.)
- **Search:** Search by vendor name, invoice number, PO number

**Invoice Fields:**
| Field | Description |
|-------|------------|
| Date | Invoice date from vendor |
| Vendor | Vendor/supplier name |
| Inv. No | Vendor's invoice number |
| PO No | Makuta's purchase order number |
| Category | Material category (Cement, Steel, Bricks, etc.) |
| Site | Construction site location |
| Amount | Invoice amount in INR |
| Balance | Remaining unpaid amount |
| Days | Days since invoice date (overdue indicator) |
| Status | Paid / Partial / Not Paid |
| Docs | Attached documents count |

### 4.3 Bulk Import (CSV/XLSX)
**Who can use:** HO and Site accountants

**Expected CSV format:**
```
Sl.No, Month, Invoice date, Vendor Name, Invoice no, PO Number, Head, Site Location, Invoice amount, Payment Status, Pending Days, Payment Type, Payment Details, Payment Date, Bank, Payment Month
```

**How it works:**
1. Click "Bulk Import" button
2. Select CSV or XLSX file
3. Click "Preview Import" to review
4. System shows: rows to import, duplicates detected, skipped rows
5. Confirm to commit the import

**Smart features:**
- Auto-detects date formats (DD-MM-YYYY, DD/MM/YYYY, Excel serial numbers)
- Auto-creates vendors if they don't exist
- Detects duplicate invoices (same invoice_no + vendor)
- Creates payment records and bank transactions for paid invoices
- Accepts both CSV and XLSX files

### 4.4 Payment Aging
Shows invoices sorted by how long they've been unpaid.

**Calculation:**
- **Due Date** = Invoice Date + Vendor Payment Terms (default 30 days)
- **Overdue** = Today > Due Date AND Balance > 0
- **Aging Buckets:** 0-30 days, 31-60 days, 61-90 days, 90+ days

### 4.5 Cashflow & Expenditure
Two views of financial data:

**Expenditure Tab:**
- Groups invoices by **accounting month** (month column in CSV)
- Rows = Categories (or Vendors if a category is selected)
- Columns = Months
- Shows total invoice amounts raised per month

**Cashflow (Payments) Tab:**
- Groups payments by **payment month**
- Shows actual money paid out per month
- Useful for tracking cash outflow vs invoice commitments

**Filters:** Site, Category

### 4.6 Vendor Master & Vendor Detail
**Vendor Master:** Complete vendor directory with name, category, payment terms, contact info, outstanding balance.

**Vendor Detail Page (click vendor name):**
- Vendor info header with category and payment terms
- KPI cards: Total Invoices, Total Amount, Paid, Outstanding
- Invoice table filtered by vendor with status filter
- Accessible by HO and MGMT

### 4.7 Bank Reconciliation
Tracks actual bank transactions and their allocation to invoices.

**How it works:**
1. When invoices are imported with payment data (Cheque no, Bank, Payment Date), bank transactions are auto-created
2. Each bank transaction shows: Type (Cheque/NEFT/Cash), Ref No, Bank, Amount, Date
3. Allocations show which invoices were paid from each transaction
4. **Tally status** indicates if the transaction is fully allocated

**Key columns:**
| Column | Description |
|--------|------------|
| Payment Type | Cheque / NEFT / RTGS / Cash |
| Cheque/Txn ID | Reference number |
| Bank | Bank name (ICICI, HDFC, Canara, etc.) |
| Cheque Amount | Total transaction amount |
| Allocated | Amount allocated to invoices |
| Balance | Unallocated amount |
| Invoices | Number of invoices paid |
| Tally | Check if fully reconciled |

### 4.8 Employee Management (MD only)
**Who can use:** Managing Director (Harsha)

| Action | Description |
|--------|------------|
| View employees | Table with name, email, role, site, active status |
| Add employee | Create new user with name, email, password, role, site |
| Edit employee | Change name, email, role, site, title |
| Reset password | Set a new password for any user |
| Activate/Deactivate | Toggle user account on/off |
| Filter by role | All / HO / MD / Site tabs |

All employee management actions are logged in the Audit Trail.

### 4.9 Audit Trail
Complete log of all actions performed in the system:
- Invoice creation, editing, deletion
- Payment recording
- Bulk imports
- Employee management (create, edit, reset password)

### 4.10 Bin (Soft Delete)
- Deleted invoices go to the Bin instead of being permanently removed
- HO can restore invoices from the Bin
- Provides safety against accidental deletion

### 4.11 Notification Bell (HO only)
- Bell icon in header with unresolved alert count badge
- Dropdown shows alerts with type, title, message, timestamp
- Click "View Duplicates" to filter invoices by vendor
- Dismiss individual alerts

### 4.12 Tally Integration
- Export payment vouchers in Tally-compatible XML format
- Date range filtering
- One-way sync: Makuta to Tally

---

## 5. Business Rules & Calculations

### Payment Status Calculation
```
IF sum(payments) = invoice_amount       -> "Paid"
IF sum(payments) > 0 AND < invoice_amount -> "Partial"
IF no payments recorded                  -> "Not Paid"
```

### Vendor Due Date
```
Due Date = Invoice Date + Vendor Payment Terms (days)
Default payment terms = 30 days
```

### Overdue Calculation
```
Overdue = Today > Due Date AND Balance > 0
```

### Minor Payment Threshold
```
Site accountants can process payments <= Rs.50,000
Payments > Rs.50,000 require HO processing
```

### Bank Reconciliation Tally
```
Balance = Transaction Amount - Sum(Allocated Payments)
Tally OK = Balance < Rs.0.01 (fully allocated)
```

---

## 6. Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 18 + TypeScript + Tailwind CSS + Recharts |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL |
| Build Tool | Vite |
| Authentication | JWT (8-hour expiry) |
| Password Security | bcrypt hashing |
| File Storage | AWS S3 (or local disk for dev) |
| Charts | Recharts (interactive bar charts with tooltips) |
| PWA | Vite PWA plugin + Workbox (offline support, installable) |
| Cron | node-cron (daily overdue email alerts at 8 AM IST) |
| Deployment | Vercel (frontend) + Render/Railway (backend) + Supabase (database) |

---

## 7. User Manual

### For Head Office Accountant (Raju S)

**Daily tasks:**
1. **Check Dashboard** - Review pending invoices, overdue counts, interactive charts
2. **Process Payments** - Go to Bank Reconciliation > Bulk Pay to record cheque/NEFT payments
3. **Import Invoices** - Use Bulk Import when receiving invoice sheets from sites
4. **Check Notifications** - Bell icon shows duplicate invoice alerts

**Monthly tasks:**
1. **Review Cashflow** - Check expenditure vs payments by month
2. **Vendor Review** - Click vendor names in Vendor Master for detailed invoice history
3. **Aging Report** - Review overdue invoices in Payment Aging
4. **Export PDF** - Generate invoice reports for management
5. **Tally Export** - Export payment vouchers for Tally integration

### For Managing Director (Harsha)

**What to check:**
1. **Dashboard** - Overall financial health with interactive charts across all sites
2. **Cashflow** - Monthly expenditure trends, category-wise spending
3. **Vendor Aging** - Vendor-wise overdue invoices requiring attention
4. **Bank Reconciliation** - Cheque/NEFT transaction tracking

**Employee Management:**
1. **Add Employee** - Create new site accountants or HO users
2. **Edit Details** - Update name, email, role, site assignment
3. **Reset Password** - Set new password for any employee
4. **Deactivate** - Disable accounts for employees who have left

### For Site Accountants (Ramana, Veerandhar, Madhu, Thanug)

**Daily tasks:**
1. **Check Site Dashboard** - Review KPIs, monthly trends, top categories for your site
2. **Enter Invoices** - Create new invoices as vendors deliver materials
3. **Check Expenditure** - Review category-wise and vendor-wise spending for your site
4. **Process Minor Payments** - Record cash payments up to Rs.50,000

**What you CANNOT do:**
- View payment status of invoices
- See paid/unpaid amounts or aging data
- Access other sites' data
- Process payments above Rs.50,000

---

## 8. Setup & Deployment

### Local Development
```bash
# Install dependencies
npm run install:all

# Start database (Docker)
docker compose up -d postgres

# Run migrations & seed data
npm run db:reset

# Start development server
npm run dev
# Client: http://localhost:3000
# Server: http://localhost:4000
```

### Production Deployment
```
Frontend: Vercel (auto-deploys from GitHub)
Backend:  Render / Railway (auto-deploys from GitHub)
Database: Supabase / Neon (managed PostgreSQL)

Required environment variables:
- DATABASE_URL (from Supabase/managed Postgres)
- JWT_SECRET (generate with: openssl rand -hex 48)
- ALLOWED_ORIGINS (* or frontend URL)
- NODE_ENV=production
- CRON_SECRET (for scheduled overdue alerts)
```

### PWA (Progressive Web App)
- App is installable on mobile/desktop from the browser
- Offline support: cached pages load without internet
- API responses cached with NetworkFirst strategy
- Offline invoice creation queued in IndexedDB, syncs when back online

---

## 9. API Endpoints

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | /api/auth/login | All | User login |
| GET | /api/invoices | HO, MGMT, Site | List invoices |
| POST | /api/invoices | HO, Site | Create invoice |
| PUT | /api/invoices/:id | HO | Update invoice |
| DELETE | /api/invoices/:id | HO | Soft-delete invoice |
| GET | /api/payments | HO, MGMT | List payments |
| POST | /api/payments | HO, Site* | Record payment |
| GET | /api/vendors | HO, MGMT, Site | List vendors |
| POST | /api/vendors | HO | Create vendor |
| GET | /api/vendors/:id/detail | HO, MGMT | Vendor detail with invoices |
| GET | /api/cashflow | HO, MGMT | Cashflow report |
| GET | /api/aging | HO, MGMT | Payment aging report |
| GET | /api/reconciliation | HO, MGMT | Bank reconciliation |
| POST | /api/reconciliation/bulk-pay | HO | Bulk payment processing |
| POST | /api/import/invoices | HO, Site | CSV/XLSX invoice import |
| POST | /api/import/vendors | HO | CSV vendor import |
| GET | /api/export/aging | HO, MGMT | Export aging as PDF |
| GET | /api/export/invoices | HO | Export invoices as PDF |
| GET | /api/export/cashflow | HO | Export cashflow as PDF |
| GET | /api/audit | HO, MGMT | Audit trail |
| GET | /api/alerts | HO | List unresolved alerts |
| POST | /api/alerts/:id/resolve | HO | Dismiss alert |
| GET | /api/users | MGMT, HO | List all employees |
| POST | /api/users | MGMT | Create employee |
| PUT | /api/users/:id | MGMT | Update employee |
| POST | /api/users/:id/reset-password | MGMT | Reset employee password |
| GET | /api/tally/vouchers | HO | Tally XML export |
| POST | /api/cron/overdue-alert | Internal | Daily overdue email (cron) |

*Site accountants limited to payments <= Rs.50,000

---

*Document generated for Makuta Developers - Accounting Module*
