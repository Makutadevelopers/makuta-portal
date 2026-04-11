# Makuta Accounts Module - Application Guide & Presentation

## 1. Overview

The **Makuta Accounts Module** is a multi-role invoice and payment portal built for **Makuta Developers**, a real estate company managing multiple construction sites across Hyderabad.

### Purpose
- Track invoices from vendors supplying materials to construction sites
- Process and record payments (Cheque/NEFT/Cash)
- Reconcile bank transactions against invoices
- Provide site-wise, vendor-wise, and category-wise financial reports
- Maintain a complete audit trail of all financial operations

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
**Login:** rajesh@makuta.in / ho123

| Feature | Permission |
|---------|-----------|
| Dashboard | Full financial overview - all sites |
| All Invoices | Create, Edit, Delete, Import, Export |
| Payment Aging | View overdue invoices across all sites |
| Cashflow | View expenditure & payment cashflow |
| Vendor Master | Add, Edit, Delete vendors |
| Bank Reconciliation | Record bank transactions, allocate to invoices |
| Bulk Import | Import invoices/vendors from CSV |
| Bulk Pay | Process payments for multiple invoices at once |
| Audit Trail | View all system activity logs |
| Bin (Soft Delete) | Restore or permanently delete invoices |

### Role 2: Managing Director (MGMT)
**Login:** arun@makuta.in / md123

| Feature | Permission |
|---------|-----------|
| Dashboard | Executive overview - all sites (READ ONLY) |
| All Invoices | View only - no create/edit/delete |
| Payment Aging | View overdue invoices |
| Cashflow | View expenditure & payment reports |
| Vendor Master | View only |
| Bank Reconciliation | View only |
| Audit Trail | View only |

**Key restriction:** MGMT cannot modify any data. This role is designed for oversight and decision-making.

### Role 3: Site Accountant (SITE)
**Login:** suresh@makuta.in (Nirvana) / nv123, priya@makuta.in (Taranga) / tr123, etc.

| Feature | Permission |
|---------|-----------|
| Dashboard | Site-specific overview only |
| Invoices | Create invoices for OWN SITE only |
| Category Expenditure | View spending by category for own site |
| Vendor Expenditure | View spending by vendor for own site |
| Minor Payments | Process payments <= Rs.50,000 |

**Key restrictions:**
- CANNOT see payment status, paid/unpaid amounts, or aging data
- CANNOT view or access other sites' data
- CANNOT process payments above Rs.50,000

---

## 3. Site Locations

| Site | Accountant | Login | Password |
|------|-----------|-------|----------|
| Nirvana | Suresh Reddy | suresh@makuta.in | nv123 |
| Taranga | Priya Sharma | priya@makuta.in | tr123 |
| Horizon | Mahesh Babu | mahesh@makuta.in | hz123 |
| Green Wood Villas | Kavitha Rao | kavitha@makuta.in | gw123 |
| Aruna Arcade | Venkat Naidu | venkat@makuta.in | aa123 |
| Office | Lakshmi Devi | lakshmi@makuta.in | of123 |

---

## 4. Feature Descriptions & Workflows

### 4.1 Dashboard
- **HO/MGMT:** Shows KPIs across all sites - total invoices, paid amount, pending amount, overdue count, site-wise breakdown
- **Site:** Shows site-specific KPIs only - no payment status info

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

### 4.3 Bulk Import (CSV)
**Who can use:** HO only

**Expected CSV format:**
```
Sl.No, Month, Invoice date, Vendor Name, Invoice no, PO Number, Head, Site Location, Invoice amount, Payment Status, Pending Days, Payment Type, Payment Details, Payment Date, Bank, Payment Month
```

**How it works:**
1. Click "Bulk Import" button
2. Select CSV file
3. Click "Preview Import" to review
4. System shows: rows to import, duplicates detected, skipped rows
5. Confirm to commit the import

**Smart features:**
- Auto-detects date formats (DD-MM-YYYY, DD/MM/YYYY, Excel serial numbers)
- Auto-creates vendors if they don't exist
- Detects duplicate invoices (same invoice_no + vendor)
- Creates payment records and bank transactions for paid invoices

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

### 4.6 Vendor Master
Complete vendor directory with:
- Vendor name
- Category (Cement, Steel, Bricks, etc.)
- Payment terms (default 30 days)
- Contact information
- Total invoices and outstanding balance

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

### 4.8 Audit Trail
Complete log of all actions performed in the system:
- Invoice creation, editing, deletion
- Payment recording
- Bulk imports
- User login/logout

### 4.9 Bin (Soft Delete)
- Deleted invoices go to the Bin instead of being permanently removed
- HO can restore invoices from the Bin
- Provides safety against accidental deletion

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
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL |
| Build Tool | Vite |
| Authentication | JWT (8-hour expiry) |
| Password Security | bcrypt hashing |
| File Storage | AWS S3 (or local disk for dev) |

---

## 7. User Manual

### For Head Office Accountant (Rajesh)

**Daily tasks:**
1. **Check Dashboard** - Review pending invoices, overdue counts
2. **Process Payments** - Go to Bank Reconciliation > Bulk Pay to record cheque/NEFT payments
3. **Import Invoices** - Use Bulk Import when receiving invoice sheets from sites

**Monthly tasks:**
1. **Review Cashflow** - Check expenditure vs payments by month
2. **Vendor Review** - Check vendor-wise outstanding in Vendor Master
3. **Aging Report** - Review overdue invoices in Payment Aging
4. **Export PDF** - Generate invoice reports for management

### For Managing Director (Arun)

**What to check:**
1. **Dashboard** - Overall financial health across all sites
2. **Cashflow** - Monthly expenditure trends, category-wise spending
3. **Payment Aging** - Overdue invoices requiring attention
4. **Audit Trail** - Monitor team activity and approvals

### For Site Accountants

**Daily tasks:**
1. **Enter Invoices** - Create new invoices as vendors deliver materials
2. **Check Expenditure** - Review category-wise and vendor-wise spending for your site
3. **Process Minor Payments** - Record cash payments up to Rs.50,000

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

### Production (Railway)
```bash
# Railway auto-deploys from GitHub
# Required environment variables:
# - DATABASE_URL (auto from Railway Postgres)
# - JWT_SECRET (generate with: openssl rand -hex 48)
# - ALLOWED_ORIGINS (frontend URL)
# - NODE_ENV=production
```

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
| GET | /api/cashflow | HO, MGMT | Cashflow report |
| GET | /api/aging | HO, MGMT | Payment aging report |
| GET | /api/reconciliation | HO, MGMT | Bank reconciliation |
| POST | /api/reconciliation/bulk-pay | HO | Bulk payment processing |
| POST | /api/import/invoices | HO | CSV invoice import |
| POST | /api/import/vendors | HO | CSV vendor import |
| GET | /api/export/pdf | HO | Export invoices as PDF |
| GET | /api/audit | HO, MGMT | Audit trail |

*Site accountants limited to payments <= Rs.50,000

---

*Document generated for Makuta Developers - Accounting Module Presentation*
