// backfillPayments.ts
// One-off: read the original "Pending payments - Payments Data.csv" and create
// bank_transactions + payments rows for every invoice where Payment Status = Paid.
//
// Strategy — match the real business process:
//   1. Group CSV rows by (payment_ref, bank, payment_date).
//      Each group = one cheque / one NEFT covering N invoices.
//   2. Insert ONE bank_transactions row per group with txn_amount = Σ allocations.
//   3. Insert ONE payments row per invoice in the group, linked via bank_txn_id.
//   4. Rows with a blank payment_ref (cash, no details) get individual transactions.
//
// This makes the Bank Reconciliation tab populate with one row per cheque
// and the Cashflow (Payments) tab populate grouped by payment_date.
//
// Usage:  cd server && npx tsx src/db/backfillPayments.ts /absolute/path/to/payments.csv
//
// Safe to re-run:
//   - Wipes any existing payments/bank_transactions where payment_type = 'Imported'
//     so you don't double up. The rm-then-reinsert lets you re-run after CSV fixes.

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { query, queryOne, withTransaction } from './query.js';
import { paymentStatusCase } from '../services/payment.service.js';

interface CsvRow {
  'Sl.No'?: string;
  'Month'?: string;
  'Invoice date'?: string;
  'Vendor Name'?: string;
  'Invoice no'?: string;
  'Invoice amount'?: string;
  'Payment Status'?: string;
  'Payment Type'?: string;
  'Payment Details'?: string;
  'Payment Date'?: string;
  'Bank'?: string;
  'Payment Month'?: string;
}

interface NormalizedRow {
  vendorName: string;
  invoiceNo: string;
  amount: number;
  invoiceDate: string | null;
  paymentType: string;
  paymentRef: string | null;
  paymentDate: string;
  bank: string | null;
  paymentMonth: string;
}

function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const val = raw.trim();
  if (!val) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const dmy = val.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const a = parseInt(dmy[1], 10);
    const b = parseInt(dmy[2], 10);
    let year = parseInt(dmy[3], 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (a > 12) return `${year}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    if (b > 12) return `${year}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    return `${year}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  }
  return null;
}

function parseMonth(raw: string | undefined): string | null {
  if (!raw) return null;
  const val = raw.trim();
  if (!val) return null;
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const m = val.match(/^([A-Za-z]+)[- ]?(\d{2,4})$/);
  if (!m) return null;
  const mon = months[m[1].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  let year = parseInt(m[2], 10);
  if (year < 100) year += year < 50 ? 2000 : 1900;
  return `${year}-${mon}-01`;
}

function parseAmount(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[₹,\s"]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

async function findInvoiceId(
  vendorName: string,
  invoiceNo: string,
  amount: number,
  invoiceDate: string | null
): Promise<string | null> {
  if (invoiceNo) {
    const row = await queryOne<{ id: string }>(
      `SELECT id FROM invoices
       WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM($1))
         AND invoice_no = $2 AND deleted_at IS NULL LIMIT 1`,
      [vendorName, invoiceNo]
    );
    if (row) return row.id;
  }
  if (invoiceDate) {
    const row = await queryOne<{ id: string }>(
      `SELECT id FROM invoices
       WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM($1))
         AND invoice_amount = $2 AND invoice_date = $3 AND deleted_at IS NULL LIMIT 1`,
      [vendorName, amount, invoiceDate]
    );
    if (row) return row.id;
  }
  return null;
}

async function main(): Promise<void> {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: npx tsx src/db/backfillPayments.ts /path/to/payments.csv');
    process.exit(1);
  }
  const abs = path.resolve(csvPath);
  if (!fs.existsSync(abs)) {
    console.error(`File not found: ${abs}`);
    process.exit(1);
  }

  // Step 0 — wipe any previous backfill so we can re-run idempotently.
  // We only touch rows tagged with our import markers (payment_type = 'Imported'
  // or bank_transactions with remarks='backfill:csv').
  console.log('Wiping previous backfill rows (if any)...');
  await query(`DELETE FROM payments WHERE payment_type = 'Imported' OR bank_txn_id IN (SELECT id FROM bank_transactions WHERE remarks = 'backfill:csv')`);
  await query(`DELETE FROM bank_transactions WHERE remarks = 'backfill:csv'`);

  // Step 1 — parse CSV
  const raw = fs.readFileSync(abs, 'utf-8');
  const lines = raw.split(/\r?\n/);
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (lines[i].includes('Vendor Name') && lines[i].includes('Invoice amount')) {
      headerIdx = i;
      break;
    }
  }
  const cleaned = lines.slice(headerIdx).join('\n');
  const rows = parse(cleaned, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
  }) as CsvRow[];
  console.log(`Parsed ${rows.length} CSV rows.`);

  // Step 2 — normalize and collect Paid rows
  const paidRows: NormalizedRow[] = [];
  let skippedNotPaid = 0;
  let skippedBadDate = 0;

  for (const row of rows) {
    const status = (row['Payment Status'] || '').trim();
    if (status !== 'Paid') { skippedNotPaid++; continue; }

    const vendorName = (row['Vendor Name'] || '').trim();
    const amount = parseAmount(row['Invoice amount']);
    if (!vendorName || amount <= 0) continue;

    const invoiceDate = parseDate(row['Invoice date']);
    const paymentDate = parseDate(row['Payment Date']) || invoiceDate;
    if (!paymentDate) { skippedBadDate++; continue; }

    paidRows.push({
      vendorName,
      invoiceNo: (row['Invoice no'] || '').trim(),
      amount,
      invoiceDate,
      paymentType: (row['Payment Type'] || '').trim() || 'Cash',
      paymentRef: (row['Payment Details'] || '').trim() || null,
      paymentDate,
      bank: (row['Bank'] || '').trim() || null,
      paymentMonth: parseMonth(row['Payment Month']) || `${paymentDate.slice(0, 7)}-01`,
    });
  }
  console.log(`Found ${paidRows.length} Paid rows to backfill (${skippedNotPaid} not-paid skipped, ${skippedBadDate} no-date skipped).`);

  // Step 3 — group by cheque key = (paymentRef, bank, paymentDate)
  // Rows with no paymentRef get their own singleton group keyed by sl no.
  const groups = new Map<string, NormalizedRow[]>();
  let singletonIdx = 0;
  for (const r of paidRows) {
    const key = r.paymentRef
      ? `${r.paymentRef}|${r.bank ?? ''}|${r.paymentDate}`
      : `__solo_${singletonIdx++}`;
    (groups.get(key) || groups.set(key, []).get(key)!).push(r);
  }
  console.log(`Grouped into ${groups.size} bank transaction(s).`);

  // Step 4 — per group, look up invoice ids and insert transaction + payments in one tx
  let txnsCreated = 0;
  let paymentsInserted = 0;
  let noMatchCount = 0;
  const noMatches: string[] = [];

  for (const [key, grp] of groups) {
    // Resolve invoice ids for every row in the group
    const resolved: Array<NormalizedRow & { invoiceId: string }> = [];
    for (const r of grp) {
      const id = await findInvoiceId(r.vendorName, r.invoiceNo, r.amount, r.invoiceDate);
      if (!id) {
        noMatchCount++;
        if (noMatches.length < 20) {
          noMatches.push(`vendor="${r.vendorName}" inv="${r.invoiceNo}" amt=${r.amount}`);
        }
        continue;
      }
      resolved.push({ ...r, invoiceId: id });
    }
    if (resolved.length === 0) continue;

    // All allocations in a group share the same txn metadata
    const first = resolved[0];
    const txnAmount = resolved.reduce((s, r) => s + r.amount, 0);

    await withTransaction(async (tx) => {
      const bt = await tx.queryOne<{ id: string }>(
        `INSERT INTO bank_transactions (txn_type, txn_ref, txn_amount, txn_date, bank, remarks)
         VALUES ($1, $2, $3, $4, $5, 'backfill:csv')
         RETURNING id`,
        [first.paymentType, first.paymentRef ?? `SOLO-${key}`, txnAmount, first.paymentDate, first.bank]
      );
      txnsCreated++;

      for (const r of resolved) {
        await tx.query(
          `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, payment_month, bank_txn_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [r.invoiceId, r.amount, r.paymentType, r.paymentRef, r.paymentDate, r.bank, r.paymentMonth, bt!.id]
        );
        paymentsInserted++;
      }

      // Recompute payment_status on each affected invoice (accounts for CN allocations)
      for (const r of resolved) {
        await tx.query(
          `UPDATE invoices SET payment_status = ${paymentStatusCase('invoices')}, updated_at = NOW()
           WHERE id = $1`,
          [r.invoiceId]
        );
      }
    });
  }

  console.log('\n── Backfill complete ──');
  console.log(`Bank transactions created:  ${txnsCreated}`);
  console.log(`Payments inserted:          ${paymentsInserted}`);
  console.log(`Invoices that didn't match: ${noMatchCount}`);
  if (noMatches.length > 0) {
    console.log('\nFirst 20 unmatched rows:');
    for (const m of noMatches) console.log(`  ${m}`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
