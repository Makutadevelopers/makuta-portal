# Browser UI Walkthrough — Makuta Portal

Run through this script end-to-end after every significant change. Expected time: ~15 minutes.
Each scenario lists the **role**, **steps**, and the **expected result**.

Assumes the app is running at `http://localhost:3000` (client) and `http://localhost:4000` (server).

---

## 🔐 Login flow

### Test credentials
| Role | Email | Password |
|---|---|---|
| HO | `rajesh@makuta.in` | `ho123` |
| MD | `arun@makuta.in` | `md123` |
| Nirvana site | `suresh@makuta.in` | `nv123` |

### 1. Session expiry (H6)
1. Log in as HO.
2. Open DevTools → Application → Local Storage → delete `makuta_token`.
3. Click any tab (Dashboard / All Invoices / …).
4. **Expected:** browser alert "Your session has expired. Please log in again." and you're back on the login page.

---

## 👤 Head Accountant (HO) scenarios

### 2. Create an invoice with a new vendor
1. All Invoices → **+ New Invoice**.
2. Vendor: type `Temp Test Vendor` (not in master).
3. Invoice no: `UI-001`, amount: `1500`, purpose: Steel, site: Nirvana.
4. Click **Save Invoice**.
5. **Expected:** success toast, invoice appears at top of the list, attachment_count = 0.

### 3. Duplicate invoice rejection (H5)
1. + New Invoice → same vendor `Temp Test Vendor`, same invoice no `UI-001`, amount `1500`.
2. Click **Save Invoice**.
3. **Expected:** red error banner mentioning "duplicate" with the existing invoice info (no duplicate created).

### 4. Attach a file and preview (attachment flow)
1. Click **Edit** on `UI-001`.
2. In the attachments section, select a PDF or PNG.
3. **Expected:** file uploads immediately (no need to click Save), appears below the dropzone with **View / Download / Share / Delete** buttons.
4. Click **View** — the file opens in a new tab.
5. Click **Share** — copies a link to the clipboard.
6. Click **Delete** — confirm, file disappears from the list.

### 5. Mark Paid → Partial → Full
1. Open the Actions dropdown on `UI-001` → **Mark Paid**.
2. Enter amount `500` (partial), NEFT, reference `T5-PART`, today's date.
3. **Expected:** invoice status changes to **Partial** in the list; balance becomes ₹1,000.
4. Open Actions → **Add Payment** → amount `1000`, reference `T5-FULL`.
5. **Expected:** status changes to **Paid**, balance ₹0.
6. Actions → **Payment History** — both payments shown.

### 6. Overpayment blocked (C4)
1. Create a fresh invoice `UI-002` amount `500`.
2. Mark Paid → amount `1000`.
3. **Expected:** red error "Payment of ₹1,000 exceeds outstanding balance of ₹500".

### 7. Soft delete and restore (C1)
1. On `UI-002` click Actions → **Delete**.
2. **Expected:** invoice disappears from All Invoices.
3. Go to Dashboard — confirm the Total Invoiced / Outstanding / Overdue cards no longer include this invoice.
4. Go to Cashflow — confirm the deleted invoice doesn't appear in either Expenditure or Cashflow tabs.
5. Go to **Bin** tab → click **Restore** on `UI-002`.
6. **Expected:** invoice reappears on All Invoices, KPIs update.

### 8. Finalize (push) → Undo
1. Actions on any draft invoice → **Finalize**.
2. **Expected:** Draft badge changes to "Master", Edit/Delete/Mark Paid gone, only **Undo Finalize** + **Payment History** + **Info / Audit** remain.
3. Click **Undo Finalize**.
4. **Expected:** back to draft state.

### 9. Bulk import with duplicate review
1. All Invoices → **Bulk Import**.
2. Pick the "Invoices & Payments" type.
3. Select a CSV that includes **at least one row** matching an existing invoice (same vendor + invoice_no).
4. Click **Preview Import**.
5. **Expected:** you see the amber duplicates card with per-row **Confirm / Dismiss** buttons and an existing-vs-new comparison. Also a green summary "Will import: N" and a gray skipped list if any.
6. Confirm one duplicate, dismiss the others.
7. Click **Confirm & Import N Rows**.
8. **Expected:** success message including "including 1 confirmed duplicate". Navigate to Bin and check that no old data was touched, then go to All Invoices — new rows visible.
9. Open Alerts (bell icon) — see **Duplicate invoice … (force-imported)** alert.

### 10. Vendor master CRUD + merge
1. Vendor Master → **+ New Vendor** `Dup Test A`.
2. Create another `Dup Test A Pvt Ltd`.
3. If the page shows a duplicate-detection card for these two, click **Merge**.
4. **Expected:** one vendor survives; any linked invoices re-point automatically. Audit Trail shows "Merged vendor … (N invoices re-pointed)".

### 11. Audit Trail readability
1. Audit Trail tab.
2. **Expected:** newest entry first, every row shows user + action (e.g. "Created invoice #UI-001 — Temp Test Vendor ₹1,500"), and the timestamp is in IST.

### 12. Cashflow & Expenditure pivot
1. Cashflow tab → **Expenditure** sub-tab.
2. Scan the table — no deleted invoices should be counted.
3. Change Site filter to `Nirvana`. **Expected:** totals drop.
4. Change Category filter to `Steel`. **Expected:** pivot switches to vendor-name rows for Steel only.
5. Switch to **Cashflow (Payments)** sub-tab and verify it groups by `payment_month` (not invoice month).

### 13. Export PDF
1. All Invoices → **Export PDF**.
2. **Expected:** PDF downloads, listing only non-deleted invoices, totals match the screen.

---

## 💼 MD (Managing Director) scenarios — read-only

### 14. MD dashboard = full read access, no edit
1. Log out, log in as `arun@makuta.in`.
2. Dashboard: all KPI cards visible.
3. **Expected:** no **+ New Invoice** button anywhere, no **Edit / Delete / Mark Paid** on any row.
4. Try navigating to `/vendors` and `/audit` — both should render but read-only.

---

## 🏗️ Site accountant scenarios

### 15. Site-only visibility
1. Log in as `suresh@makuta.in` (Nirvana).
2. All Invoices — only Nirvana rows visible, no Status column showing paid/unpaid, no Balance / Days columns.
3. Payment Aging tab — should NOT be accessible (or blank).
4. Cashflow tab — should NOT be accessible.

### 16. Site creates invoice for their own site
1. + New Invoice → site field is locked to `Nirvana`.
2. Save with vendor `Site Test`, invoice no `SITE-001`, amount `20000`.
3. **Expected:** saved successfully.

### 17. Site cannot escape their site (H1)
1. Open DevTools → Network tab.
2. Edit the invoice you just created.
3. Before clicking save, use DevTools → edit the PATCH request body to `{"site": "Horizon"}` and submit.
4. **Expected:** server returns 403 "Site accountants cannot change the site of an invoice". UI shows the error.

### 18. Site pays minor (≤ ₹50k) OK, major forbidden
1. Create invoice `SITE-002` amount `80000`.
2. Try Mark Paid with amount `51000`.
3. **Expected:** 403 "Site accountants can only process payments up to ₹50,000".
4. Retry with `40000`.
5. **Expected:** Partial payment recorded.

### 19. Site cannot pay finalized invoices (H4)
1. Log out, log in as HO, finalize `SITE-002` (Actions → Finalize).
2. Log out, log back in as site.
3. Try Mark Paid on `SITE-002`.
4. **Expected:** 403 "Finalized invoices can only be paid by Head Office".

### 20. Site bulk-import is scoped to their site (C2)
1. Bulk Import → Invoices & Payments → upload a CSV with rows for Nirvana **and** Horizon.
2. Click **Preview Import**.
3. **Expected:** Horizon rows appear in the skipped list with reason `site "Horizon" not owned by current user`.

---

## 🧹 Cleanup after the walkthrough

Log back in as HO, Bin tab → **Permanently delete** every `UI-*` and `SITE-*` invoice. Vendor Master → remove `Temp Test Vendor` / `Site Test` / `Dup Test A`.

---

## ✅ Pass criteria

- All 20 scenarios behave as described.
- No red console errors in DevTools.
- No `Unhandled error:` lines in the server log.
- Time from login to scenario 20 under 15 minutes.

If any scenario fails, capture a screenshot + the DevTools → Network request that failed and share it.
