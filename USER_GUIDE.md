# Makuta Accounts Portal — User Guide

A step-by-step walkthrough for first-time users. Open the portal in your browser and follow along.

> **Note:** You'll be sharing this portal with other testers. Please don't change passwords or delete the seeded vendors — that breaks things for everyone else. Add your own data freely.

---

## Before you start

- **Browser:** Chrome, Edge, or Safari — latest version. Installable as a PWA, but data-entry screens are best on a laptop/desktop.
- **Your login:** ask the admin which account to use. You'll receive an email, a password, and a role (HO / MD / Site).
- **Session length:** 8 hours. After that you'll be asked to log in again.

---

## 1. Logging in (everyone)

1. Open the portal URL in your browser.
2. You'll see a login screen with the Makuta logo.
3. Enter your email and password exactly as given to you.
4. Click **Sign in**.
5. You'll land on a dashboard. What you see depends on your role — skip to the section below that matches yours.

**If login fails:**
- "Invalid credentials" → the password is wrong. Ask the admin to reset it.
- "Account inactive" → the admin hasn't activated your account yet.
- Blank screen / loading forever → refresh the page. If still stuck, note the time and report it.

---

## 2. If you are a **Site Accountant**

You can enter invoices and record small payments for **your site only**. You will not see any payment status information — that's by design, not a bug.

### 2a. Your first invoice — step by step

1. From the sidebar, click **My Invoices**.
2. Click **+ New Invoice** at the top right.
3. Fill in the form:
   - **Vendor** — start typing; pick from the dropdown. (If the vendor doesn't exist, jump to 2c first to add them, then come back.)
   - **Invoice number** — what the vendor wrote on their invoice (e.g. `INV-2041`).
   - **Invoice date** — when the vendor issued it.
   - **Base Amount (₹) \*** — the pre-tax amount on the vendor's invoice.
   - **CGST %** / **SGST %** / **IGST %** — enter the tax rates shown on the invoice. Leave as 0 if no tax. The total amount is computed automatically from base + taxes — double-check that the computed total matches the invoice.
   - **Category** — pick what the spend was for (Cement, Steel, Labour, etc.).
   - **Purpose / remarks** — a short line describing what this was for.
   - **PO number** — if your site uses purchase orders, enter it. Otherwise leave blank.
   - **Attachment** — click **Upload** and attach a PDF/JPG of the vendor's invoice. Strongly recommended.
4. Click **Save**. You'll see the new invoice at the top of the list.

### 2b. Recording a minor payment

Only for payments **up to ₹50,000**. Larger payments must be sent to HO.

1. Open the invoice by clicking its row in **My Invoices**.
2. Click **Record Payment**.
3. Pick a mode:
   - **Full Payment** — pays off the entire remaining balance. Amount is filled in for you.
   - **Part Payment** — pays some of the balance. Enter the amount.
4. Fill in the rest:
   - **Payment Type** — one of **Cheque / NEFT / RTGS / UPI / Cash**.
   - **Reference / TXN No** — *required for everything except Cash*. UPI txn ID, cheque number, UTR, etc. The field is hidden when you select Cash.
   - **Payment Date** — when money actually moved.
   - **Bank** — one of **HDFC / SBI / ICICI / Axis / Kotak / Yes Bank / Other**. Also hidden for Cash.
5. Click **Record Full Payment** or **Record Part Payment**.

**What will go wrong (and what the error means):**
- *"Site accountants can only process payments up to ₹50,000"* — amount is too high, pass it to HO.
- *"Payment of ₹X exceeds outstanding balance of ₹Y"* — you tried to pay more than what's left unpaid.
- *"Finalized invoices can only be paid by Head Office"* — HO has already pushed this invoice; ask them to handle the payment.
- *"You can only record payments for invoices in your own site"* — you're trying to pay for another site.

### 2c. Adding a new vendor

1. Sidebar → **Vendor Master** → **+ New Vendor**.
2. Fill in:
   - **Name** — use the registered business name. The system will warn if a similar vendor already exists — check that list first to avoid duplicates.
   - **GSTIN** — optional but recommended.
   - **Payment terms (days)** — how many days after invoice date the vendor expects payment (default 30).
   - **Contact, phone, email** — optional.
3. Click **Save**.

You can edit or delete a vendor **only if you created it**. Vendors added by HO or other sites are read-only for you.

### 2d. Your dashboard and expenditure

- **Dashboard** (sidebar) — quick KPIs for your site: total invoiced this month, top categories, top vendors, monthly trend.
- **Expenditure** — a breakdown of spending by category and by vendor for your site. Change the month filter at the top to compare periods.

### 2e. Bulk import (optional)

If you have many invoices to enter:

1. Sidebar → **My Invoices** → **Import**.
2. Download the CSV/XLSX template.
3. Fill it in (one row per invoice). Leave blank what doesn't apply.
4. Upload it back. The system will show a preview of valid and invalid rows. Fix errors and re-upload, or import only the valid rows.

---

## 3. If you are the **Head Accountant (HO)**

You have full access. Everything a site accountant can do, plus pushing invoices, recording large payments, managing all vendors, bank reconciliation, and audit.

### 3a. Your day one

1. Log in. You'll land on **Dashboard** — totals across all sites.
2. Glance at **Payment Aging** to see what's overdue.
3. Open **All Invoices** to see the full invoice list across all sites.

Your sidebar: **Dashboard · All Invoices · Payment Aging · Cashflow · Vendor Master · Bank Reconciliation · Audit Trail · Bin**.

### 3b. Recording any payment (large or small)

1. Open the invoice.
2. Click **Record Payment**.
3. Pick **Full Payment** (auto-fills balance) or **Part Payment** (enter amount).
4. Pick **Payment Type**: Cheque / NEFT / RTGS / UPI / Cash.
   - For Cash, the Reference and Bank fields disappear — not needed.
   - For the rest, fill **Reference / TXN No** and **Bank**.
5. Set **Payment Date** and click **Record Full / Part Payment**. No cap.

You can also pay a **finalized (pushed)** invoice — site accountants cannot.

### 3c. Pushing (finalizing) an invoice

Pushing = declaring the invoice "closed for edits". Site accountants can't modify or pay it after this.

1. Open the invoice.
2. Click **Push / Finalize**.
3. Confirm.

If you need to undo: open the invoice and click **Unpush**.

### 3d. Bank reconciliation

Use this when one bank transaction covers multiple invoices (e.g. one ₹5,00,000 cheque to a vendor that clears 3 invoices).

1. Sidebar → **Bank Reconciliation**.
2. Click **+ New Transaction**.
3. Enter cheque/UTR details and total amount.
4. Allocate portions of that amount to specific invoices — the allocations must sum to the transaction amount.
5. Save. Each invoice will now have a payment record linked to this transaction.

### 3e. Merging duplicate vendors

1. Sidebar → **Vendors**.
2. The system flags similar-looking names (e.g. "ABC Traders" vs "ABC Trader").
3. Pick one to keep (the "master"), pick duplicates to merge in.
4. Confirm. All invoices from the duplicates will be re-pointed at the master, and the duplicates deleted.

### 3f. Audit trail and undo

1. Sidebar → **Audit** to see every action by every user — timestamp, user, invoice, what changed.
2. For batch imports, you can **undo** the entire batch — useful if someone uploaded a bad CSV.

### 3g. Bin (recycle bin)

Deleted invoices are soft-deleted for 30 days. Sidebar → **Bin** → restore or permanently purge.

### 3h. Exports

- **Aging PDF** — overdue vendors snapshot.
- **Invoices PDF** — filtered invoice list as a printable report.
- **Cashflow PDF** — monthly category pivot.

Available on the respective pages via the **Export** button.

---

## 4. If you are the **Managing Director (MD)**

You have full visibility but cannot enter or edit transactional data. You can manage users.

Your sidebar: **Overview · Vendor Aging · Cashflow · Bank Reconciliation · Employees**.

### 4a. Reading the Overview

Sidebar → **Overview**. The tiles at the top show:
- **Total invoiced** — all-time total value of invoices entered.
- **Paid** — sum of payments recorded.
- **Outstanding** — what's still owed.
- **Overdue** — outstanding where today is past the due date.
- **Site-wise** — the same four numbers per site, with a payment %.

Everything is read-only. Numbers refresh every time you open the page.

### 4b. Vendor aging

Sidebar → **Vendor Aging**. Shows per vendor:
- Invoices with them, total value, within-terms vs overdue split, maximum days past due.
- Useful for picking which vendors to prioritize for payment.

### 4c. Cashflow and reconciliation

- **Cashflow** — same pivot HO sees: category × month.
- **Bank Reconciliation** — read-only view of HO's reconciliations.

### 4d. Managing users

1. Sidebar → **Employees**.
2. Click **+ New User** to create an account. Assign:
   - **Name, email**
   - **Role** — HO / MD / Site
   - **Site** — required if Site, ignored for HO/MD
   - **Title** — display label (e.g. "Head Accountant")
3. Send the temporary password to the user out-of-band.
4. To **reset** someone's password, click **Reset password** on their row.
5. To **deactivate**, toggle Active off — they'll no longer be able to log in.

### 4e. Exports

Same PDFs as HO: Aging, Invoices, Cashflow. Use these for reports to leadership or for filing.

---

## 5. Common questions

**Q: Why can't I see any "Paid"/"Outstanding" labels on my screens?**
A: You're logged in as a Site Accountant. That data is hidden from your role by design.

**Q: I entered a payment but the invoice still shows as unpaid.**
A: Refresh the page. If the payment was ₹X but the balance was larger, the status will be **Partial**, not Paid. The status only flips to **Paid** when the sum of payments equals the full invoice amount.

**Q: A vendor's name is slightly different on the new invoice — should I create a new vendor?**
A: No. Pick the existing vendor from the dropdown. Creating duplicates makes HO's job harder.

**Q: I tried to edit a vendor and got an error.**
A: Site accountants can only edit vendors they themselves created. Ask HO to make the change.

**Q: My dashboard totals look wrong.**
A: Check the date filter at the top of the page — you may be looking at a specific month. Reset it to "All time" to compare.

**Q: I accidentally deleted an invoice.**
A: It's in the Bin for 30 days. Ask HO to restore it (site accountants don't have Bin access).

**Q: Can I use this on my phone?**
A: The portal is a PWA and will load on mobile browsers, but entry screens (invoice form, payment form) are designed for a laptop/desktop. Use a bigger screen for data entry; mobile is OK for reviewing dashboards.

**Q: The computed total doesn't match my vendor's invoice.**
A: Double-check CGST / SGST / IGST percentages. Most intra-state invoices use CGST + SGST (e.g. 9 + 9). Inter-state invoices use IGST (e.g. 18). Don't enter both.

---

## 6. Glossary

| Term | What it means |
|---|---|
| **Push / Finalize** | HO-only action that locks an invoice from further edits. Treat it as "approved for payment". |
| **Minor payment** | A payment of ≤ ₹50,000. Site accountants can record these. |
| **Pushed** | State of an invoice after HO has finalized it. |
| **Partial** | Status when some payments exist but the invoice isn't fully paid. |
| **Not Paid** | Status when no payments have been recorded. |
| **Aging** | How many days past the due date an invoice is, if unpaid. |
| **Due date** | Invoice date + vendor's payment terms (in days). |
| **Overdue** | Today is past the due date AND balance is > 0. |
| **Batch / Batch import** | A group of invoices or vendors uploaded together from a CSV/XLSX file. |
| **Soft delete** | Deleted record that sits in the Recycle Bin for 30 days before permanent removal. |

---

## 7. Reporting issues

When something doesn't work as expected, please capture:

1. **Your login email** (so we can match it to your role).
2. **Which page** you were on (URL or page name).
3. **What you did** (the exact button or field).
4. **What you expected** to happen.
5. **What actually happened** — full error text if a message appeared, or a screenshot.
6. **Time** (approximate is fine) — so we can cross-reference the server logs.

Send these to the admin email provided to you, or put them in the shared issues tracker.

Thank you for testing — your feedback directly shapes the first production release.
