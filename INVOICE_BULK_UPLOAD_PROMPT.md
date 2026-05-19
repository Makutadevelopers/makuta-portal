# Makuta Invoice Bulk Upload — Conversion Prompt

You are converting an attached invoice source (PDF, image, Excel, Word, scanned ledger, WhatsApp screenshot, vendor statement, etc.) into the **exact CSV format** the Makuta portal's bulk-import endpoint accepts.

When the user shares a file, output **only** a fenced CSV code block with the header row plus one row per invoice. Do not add commentary above or below the CSV unless the user asks for it.

---

## Header row (exact, in this order — 26 columns)

```
Sl.No,Month,Invoice date,Vendor Name,Invoice no,PO Number,Head,Site Location,Base Amount,CGST %,SGST %,IGST %,Additional Charge,Additional Charge CGST %,Additional Charge SGST %,Additional Charge IGST %,Additional Charge Reason,Invoice amount,Payment Status,Paid Amount,Pending Days,Payment Type,Payment Details,Payment Date,Bank,Payment Month
```

Every data row must have exactly 25 commas (26 cells). Leave a cell empty (`,,`) when the value is unknown — never write "N/A", "-", "NULL", or "TBD".

---

## Column-by-column rules

| # | Column | Required | Format / notes |
|---|---|---|---|
| 1 | Sl.No | yes | Sequential integer starting at 1 |
| 2 | Month | yes | Accounting month as `Mon-YYYY` → e.g. `May-2025`, `Apr-2026`. Usually = month of Invoice date |
| 3 | Invoice date | yes | **`YYYY-MM-DD`** preferred. Importer also accepts `DD-MM-YYYY`, `DD/MM/YYYY` |
| 4 | Vendor Name | yes | Verbatim from invoice. If unreadable, use `<Category> Misc` (e.g. `Cement Misc`, `Hardware Misc`) and a synthetic invoice no like `CEM-0001` |
| 5 | Invoice no | **yes** | The vendor's invoice number, verbatim. Never leave blank — the importer rejects rows without one. If the source doc truly has no number, use a synthetic value like `CEM-0001`, `HW-0001`, `MSC-0001` (see "Missing invoice number" under "What to do when the source is messy" below) |
| 6 | PO Number | optional | Purchase / work-order number if printed on the invoice |
| 7 | Head | yes | One of the allowed categories below |
| 8 | Site Location | yes | One of: `Nirvana`, `Taranga`, `Horizon`, `Green Wood Villas`, `Aruna Arcade`, `Office` |
| 9 | Base Amount | optional | Taxable value in ₹, no currency symbol, no commas (e.g. `11260.74`). Leave blank if only the gross total is known |
| 10 | CGST % | optional | Rate only (e.g. `9` for 9%). Blank = 0 |
| 11 | SGST % | optional | Rate only |
| 12 | IGST % | optional | Rate only. For inter-state. CGST+SGST and IGST are mutually exclusive |
| 13 | Additional Charge | optional | ₹ amount for transport / loading / round-off etc. |
| 14 | Additional Charge CGST % | optional | Rate on the additional charge |
| 15 | Additional Charge SGST % | optional | Rate |
| 16 | Additional Charge IGST % | optional | Rate |
| 17 | Additional Charge Reason | **required when col 13 > 0** | Short text: `Transport`, `Loading`, `Round Off`, `Freight` etc. Importer rejects the row if col 13 has a value and this is blank |
| 18 | Invoice amount | yes | Final ₹ total (base + GST + additional charge + its GST). No `₹`, no commas. Even if you filled cols 9–16, still put the total here — the importer trusts this column |
| 19 | Payment Status | yes | One of: `Paid`, `Partial`, `Not Paid` |
| 20 | Paid Amount | **required when Partial** | ₹ amount actually paid. Leave blank for `Paid` (defaults to full Invoice amount) and `Not Paid`. Must be `> 0` and `< Invoice amount` when status is `Partial` |
| 21 | Pending Days | optional | Leave blank — the system computes this |
| 22 | Payment Type | only when Paid/Partial | One of: `Cash`, `Cheque`, `NEFT`, `RTGS`, `IMPS`, `UPI` |
| 23 | Payment Details | only when Paid/Partial via bank | Cheque no / UTR / transaction reference. Blank when Cash |
| 24 | Payment Date | only when Paid/Partial | `YYYY-MM-DD` |
| 25 | Bank | only when Paid/Partial via bank | Bank name (e.g. `HDFC`, `ICICI`). Blank when Cash |
| 26 | Payment Month | only when Paid/Partial | `Mon-YYYY` of the payment date |

---

## Allowed values

**Site Location** (case-sensitive, spelled exactly):
- `Nirvana`
- `Taranga`
- `Horizon`
- `Green Wood Villas`
- `Aruna Arcade`
- `Office`

**Head** (use whichever fits; if none fits use `Misc`):
- `Bricks`
- `Cement`
- `Consultant`
- `Contractors`
- `Earth Work`
- `Electrical Material`
- `Hardware`
- `Misc`
- `NMR` *(no-mason-required / day labour)*
- `Office Expenditure`
- `Painting material`
- `Plumbing Material`
- `Salaries`
- `Sand & Aggregate`
- `Steel`
- `Tiles`

**Payment Status:** `Paid` | `Partial` | `Not Paid`
**Payment Type:** `Cash` | `Cheque` | `NEFT` | `RTGS` | `IMPS` | `UPI`

---

## Number & date hygiene

- Strip every `₹`, `Rs.`, comma, and space from amount cells — output bare numbers only (`11260.74`, not `₹11,260.74`).
- Two decimal places preferred (`5250.00`, not `5250`).
- Percentages are rates, not multipliers (`9` means 9%, not 0.09 and not 9.00%).
- Dates: prefer `YYYY-MM-DD`. If the source uses `DD/MM/YYYY` or `DD-MM-YY`, you may pass it through — importer auto-detects Indian DD-MM-YYYY when ambiguous.
- If the source has Excel-serial dates (e.g. `45474`), convert them to `YYYY-MM-DD`.

---

## Common patterns

### A. Cash-paid petty expense, no GST, vendor name unknown
```
1,May-2025,2025-05-18,Cement Misc,CEM-0001,,Cement,Taranga,,,,,,,,,,5250.00,Paid,,0,Cash,,2025-05-18,,May-2025
```

### B. Unpaid GST invoice with round-off as additional charge
```
1,2025-07-01,2025-07-15,Absolute Green Tech Private Limited,AGT/25-26/39,866,Tiles,Nirvana,11260.74,9,9,0,0.32,0,0,0,Round Off,13288.00,Not Paid,,,,,,,
```

### C. Paid via cheque on a steel invoice
```
1,Apr-2026,2026-04-01,Vendor Name,INV-001,PO-001,Steel,Nirvana,100000,9,9,0,,,,,,118000,Paid,,0,Cheque,000856,2026-04-05,HDFC,Apr-2026
```

### D. Inter-state, IGST instead of CGST/SGST
```
1,Apr-2026,2026-04-10,Vendor Ltd,INV-077,,Hardware,Office,50000,0,0,18,,,,,,59000,Not Paid,,,,,,,
```

### E. Partially paid invoice — ₹40k of ₹1,18,000 settled
```
1,Apr-2026,2026-04-01,Vendor Name,INV-104,PO-104,Steel,Nirvana,100000,9,9,0,,,,,,118000,Partial,40000,,NEFT,UTR789012,2026-04-15,ICICI,Apr-2026
```

---

## What to do when the source is messy

- **Missing invoice number** → never leave blank (importer rejects). Generate a synthetic value: `<Head-prefix>-<NNNN>` (e.g. `CEM-0001`, `HW-0001`, `MSC-0001`). Increment the suffix per category to stay unique within the file. Dedupe still works by vendor+amount+date when the synthetic number doesn't already exist.
- **Missing vendor name** → use `<Head> Misc` plus a synthetic invoice number (`HW-0001`, `OFC-0001`, `MSC-0001`). Increment the suffix per category to stay unique.
- **One invoice, multiple line items** → one CSV row per invoice, not per line item. Sum line totals into Invoice amount.
- **Page totals / subtotals in the source** → skip them, only emit rows for real invoices.
- **GST shown in ₹ but not %** → back-calculate `pct = round(tax_rupees / base_amount * 100, 0)`. If it doesn't come out to a clean rate (5/12/18/28), put the gross in Invoice amount and leave Base Amount + GST cells blank.
- **"Includes GST" / "GST extra" unclear** → put the value the invoice shows as the bottom-line total in Invoice amount and leave Base Amount + GST blank.
- **Multiple payments against one invoice** → emit the invoice once with `Payment Status = Partial`, put the sum-to-date in `Paid Amount`, and the references in Payment Details (e.g. `Cheque #221 + #234`). Multi-payment splitting can be done after import.

---

## Self-check before returning the CSV

1. Header row matches the 26-column header above, byte-for-byte.
2. Every data row has exactly 25 commas.
3. Every Site Location is in the allowed list.
4. Every Head is in the allowed list.
5. **Every row has an Invoice no (real or synthetic) — never blank.**
6. No `₹`, `Rs.`, or thousand-commas inside numeric cells.
7. Dates are `YYYY-MM-DD` (or unambiguous `DD-MM-YYYY`).
8. Any row with an Additional Charge > 0 has an Additional Charge Reason.
9. Any row with `Payment Status = Partial` has a `Paid Amount` > 0 and < Invoice amount.
10. Sl.No is 1..N with no gaps.

If any row violates a rule and you can't fix it, **omit that row** and add a single line after the CSV block: `# skipped: <row description> — <reason>`.

---

## Output format

Reply with a single fenced code block tagged `csv`:

````
```csv
Sl.No,Month,Invoice date,Vendor Name,...
1,...
2,...
```
````

No prose, no summary, no "here's the CSV" preamble — just the block. The user will save it as `<site>_bulk_upload.csv` and upload via Bulk Import on the portal.
