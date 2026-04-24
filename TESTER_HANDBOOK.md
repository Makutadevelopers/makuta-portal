# Makuta Accounts Portal — Tester Handbook

A short guide for the testing round. The DB has been wiped of test data; vendor catalog and user logins are preserved. Log in, poke around, enter real-looking data, and report anything odd.

---

## 1. Logins

| Role | Name | Email | Password | Site |
|---|---|---|---|---|
| Head Accountant (HO) | Raju S | `raju@makuta.in` | `ho123` | — |
| Managing Director (MD) | Harsha | `harsha@makuta.in` | `md123` | — |
| Site Accountant | Ramana | `ramana@makuta.in` | `nv123` | Nirvana |
| Site Accountant | Veerandhar | `veerandhar@makuta.in` | `tr123` | Taranga |
| Site Accountant | Madhu | `madhu@makuta.in` | `hz123` | Horizon |
| Site Accountant | Madhu | `madhu.gw@makuta.in` | `gw123` | Green Wood Villas |
| Site Accountant | Ramana | `ramana.aa@makuta.in` | `aa123` | Aruna Arcade |
| Site Accountant | Thanug | `thanug@makuta.in` | `of123` | Office |

Sessions last 8 hours. Change your password only if asked — otherwise leave defaults so other testers can share the account.

---

## 2. Rules everyone should know

- **Amount split:** payments **≤ ₹50,000** can be entered by the site accountant; anything **> ₹50,000** is HO-only.
- **Part payments:** one invoice can have multiple payments. Status auto-computes:
  - no payment → **Not Paid**
  - partial sum → **Partial**
  - full sum → **Paid**
- **Due date** = invoice date + vendor's payment terms (7–90 days).
- **Overdue** = today is past due date *and* balance > 0.
- **Sites:** Nirvana, Taranga, Horizon, Green Wood Villas, Aruna Arcade, Office.

---

## 3. HO (Head Accountant) — full access

Login: `raju@makuta.in` / `ho123`

### Pages you'll use

| Page | What you do there |
|---|---|
| **Dashboard** | All-sites summary with timeline filters |
| **Invoices** | Create / edit / delete invoices, attach files, finalize ("push"), undo pushes |
| **Payment Aging** | Which vendors are overdue and by how many days |
| **Cashflow** | Pivot of spend by category / month |
| **Vendors** | Add vendors, edit any vendor, merge duplicates, see similar-name suggestions |
| **Vendor detail** | Per-vendor invoices, outstanding balance, payment history |
| **Bank Reconciliation** | Allocate a single bank transaction / cheque across multiple invoices |
| **Audit Trail** | Every action by every user — with undo for batch imports |
| **Recycle Bin** | Restore soft-deleted records (auto-purged after 30 days) |

### Things only HO can do
- **Push (finalize)** an invoice → locks it from further edits until explicitly un-pushed.
- **Record any payment amount** (no ₹50k cap).
- **Bulk-import payments** from CSV/XLSX (site accountants cannot).
- **Merge vendors** when duplicates creep in.
- **Undo a batch import** from the Audit Trail.
- **Export** Aging / Invoices / Cashflow PDFs.

### What to test
- Create a vendor → create invoices against it across different sites → record part-payments → watch the status flip from Not Paid → Partial → Paid.
- Bulk-import a CSV of 20–50 invoices, then undo the batch from Audit Trail.
- Push an invoice, then try to edit it (should be blocked until un-pushed).
- In Bank Reconciliation, allocate one ₹5,00,000 cheque across 3 invoices.

---

## 4. MD (Managing Director) — read-only + user management

Login: `harsha@makuta.in` / `md123`

### Pages you'll use

| Page | What you do there |
|---|---|
| **Overview** | Totals: invoiced / paid / outstanding / overdue, per-site payment % |
| **Vendor Aging** | Per-vendor: invoice count, within-terms vs overdue, max days past |
| **Cashflow** | Same category/month pivot as HO |
| **Bank Reconciliation** | Read-only view of reconciliation ledger |
| **Employees** | Create / edit users, reset passwords, change roles and site assignments |

### What you can do
- **View everything financial** — same numbers HO sees, but you cannot edit.
- **Export** Aging / Invoices / Cashflow PDFs.
- **Manage users:** create new site accountants, reset forgotten passwords, change someone's assigned site.

### What you cannot do
- Create or edit invoices, payments, or vendors.
- Push / finalize invoices.
- Delete anything.

### What to test
- Create a new site accountant via Employees → give them a site → log in as them in a private window → confirm they only see their own site's data.
- Reset another user's password, log in as them with the new one.
- Compare totals on Overview with what HO sees on Dashboard — they should match.

---

## 5. Site Accountant — your site only

Logins: see credentials table. Each site accountant sees **only their own site**.

### Pages you'll use

| Page | What you do there |
|---|---|
| **My Dashboard** | Your site's KPIs, recent invoices, top categories/vendors, monthly trend |
| **My Invoices** | Create / edit invoices for your site; bulk-import CSV for your site |
| **Expenditure** | Category and vendor breakdown for your site (no payment data) |
| **Vendors** | See all vendors, add new ones, edit/delete **only the ones you created** |

### What you can do
- Enter invoices for **your** site only (the site field is locked to yours).
- Record **minor payments (≤ ₹50,000)** against your site's invoices.
- Add new vendors. Edit/delete vendors only if **you** added them.
- Bulk-import invoices or vendors from CSV/XLSX (your site only).

### What you cannot see or do
- **No payment status**, paid/outstanding amounts, or aging anywhere in the UI. This is intentional — escalations and follow-ups are HO/MD's job.
- Cannot record payments **> ₹50,000** or touch payments on **pushed** invoices.
- Cannot edit vendors created by HO or another site.
- Cannot push / finalize invoices.
- Cannot import payments.
- Cannot see the Audit Trail, Recycle Bin, or Bank Reconciliation.

### What to test
- Try to create an invoice and pick a site that isn't yours — it should be blocked (or the dropdown shouldn't show other sites).
- Enter a ₹49,000 payment → should succeed. Enter a ₹51,000 payment → should be blocked with a clear error.
- Try editing a vendor you didn't create → should show a "you can only edit vendors you added" error.
- After HO pushes one of your invoices, try recording a payment → should be blocked.
- Confirm nothing on your screens says "Paid", "Unpaid", "Outstanding" or "Overdue".

---

## 6. Reporting issues

For each issue please capture:
1. **Who you were logged in as** (email + role).
2. **What page / action** (URL + button clicked).
3. **What you expected** vs **what happened**.
4. **Screenshot** if visual; **exact error text** if a message appeared.
5. **Approx. time** so we can match against server logs.

Priority flags:
- **P0** — data visible to the wrong role (e.g. site sees payment status), data loss, can't log in.
- **P1** — blocked from a legitimate action, wrong totals, export fails.
- **P2** — UI glitches, wording, minor UX.

---

## 7. Known limits in this test build

- Demo mode must be **off** on the deployed build — if you see pre-populated mock data before logging in, the flag is still on; tell the dev team.
- Attachments: file uploads go to S3 — large PDFs may take a few seconds.
- Numbering (invoice sl_no, internal_no) restarted from 1 for this testing round.
- Orphan files from the previous test round may exist in S3 but aren't visible in the app.

Happy testing.
