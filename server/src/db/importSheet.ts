/**
 * importSheet.ts
 * One-time script to import the Google Sheet CSV into the database.
 * Run: cd server && npx tsx src/db/importSheet.ts <path-to-csv>
 */

import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { query, queryOne } from './query.js';
import { randomUUID } from 'crypto';

interface CsvRow {
  [key: string]: string;
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function parseDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const val = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;

  // DD-MM-YYYY or DD/MM/YYYY or DD-MM-YY
  const dmy = val.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const a = parseInt(dmy[1], 10);
    const b = parseInt(dmy[2], 10);
    let year = parseInt(dmy[3], 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (a > 12) return `${year}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    if (b > 12) return `${year}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    // Assume DD-MM-YYYY (Indian format)
    return `${year}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  }
  return null;
}

function parseMonth(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const match = raw.trim().match(/^([A-Za-z]+)[- ]?(\d{2,4})$/);
  if (match) {
    const mon = MONTH_MAP[match[1].slice(0, 3).toLowerCase()];
    if (!mon) return null;
    let year = parseInt(match[2], 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    return `${year}-${mon}-01`;
  }
  return null;
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[₹,\s"]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

const HO_USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: npx tsx src/db/importSheet.ts <path-to-csv>');
    process.exit(1);
  }

  const csvData = readFileSync(csvPath, 'utf-8');
  const allRows: string[][] = parse(csvData, { columns: false, skip_empty_lines: false, trim: true, bom: true });

  // Find header row
  let headerIdx = 0;
  for (let i = 0; i < Math.min(allRows.length, 10); i++) {
    if (allRows[i].some(c => c === 'Sl.No') && allRows[i].some(c => c === 'Vendor Name')) {
      headerIdx = i;
      break;
    }
  }

  const headers = allRows[headerIdx];
  const dataRows = allRows.slice(headerIdx + 1);

  // Map to objects
  const records: CsvRow[] = dataRows.map(row => {
    const obj: CsvRow = {};
    headers.forEach((h, j) => { if (h) obj[h] = (row[j] ?? '').trim(); });
    return obj;
  });

  const batchId = randomUUID();
  const vendorCache = new Map<string, string>(); // name -> id
  let imported = 0;
  let skipped = 0;
  let vendorsCreated = 0;
  let paymentsCreated = 0;

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const slNo = row['Sl.No'] || '';
    const vendorName = row['Vendor Name'] || '';
    const invoiceNo = row['Invoice no'] || '';
    const site = row['Site Location'] || '';
    const amountStr = row['Invoice amount'] || '0';

    // Skip empty rows
    if (!slNo && !vendorName && !invoiceNo) {
      skipped++;
      continue;
    }
    if (!vendorName && !site) {
      skipped++;
      continue;
    }

    const amount = parseAmount(amountStr);
    if (amount <= 0) { skipped++; continue; }

    const monthRaw = row['Month'] || '';
    const invoiceDateRaw = row['Invoice date'] || '';
    const poNumber = row['PO Number'] || '';
    const purpose = row['Head'] || '';
    const paymentStatus = row['Payment Status'] || 'Not Paid';
    const paymentType = row['Payment Type'] || '';
    const paymentRef = row['Payment Details'] || '';
    const paymentDateRaw = row['Payment Date'] || '';
    const bank = row['Bank'] || '';
    const paymentMonthRaw = row['Payment Month'] || '';

    const invoiceDate = parseDate(invoiceDateRaw);
    const monthDate = parseMonth(monthRaw) || (invoiceDate ? `${invoiceDate.slice(0, 7)}-01` : null);

    if (!invoiceDate || !monthDate) {
      console.warn(`Row ${i + 2}: Could not parse dates (invoice_date=${invoiceDateRaw}, month=${monthRaw}), skipping`);
      skipped++;
      continue;
    }

    // Get or create vendor
    let vendorId: string | null = null;
    const vendorKey = vendorName.toLowerCase().trim();
    if (vendorKey) {
      if (vendorCache.has(vendorKey)) {
        vendorId = vendorCache.get(vendorKey)!;
      } else {
        const existing = await queryOne<{ id: string }>('SELECT id FROM vendors WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))', [vendorName]);
        if (existing) {
          vendorId = existing.id;
        } else {
          const created = await queryOne<{ id: string }>(
            `INSERT INTO vendors (name, payment_terms, category, created_by, batch_id)
             VALUES (TRIM($1), 30, $2, $3, $4)
             ON CONFLICT (name) DO UPDATE SET name = vendors.name RETURNING id`,
            [vendorName, purpose || null, HO_USER_ID, batchId]
          );
          vendorId = created!.id;
          vendorsCreated++;
        }
        vendorCache.set(vendorKey, vendorId);
      }
    }

    // Generate internal number
    const seqResult = await queryOne<{ nextval: string }>("SELECT nextval('invoice_internal_seq')");
    const internalNo = `MKT-${String(seqResult!.nextval).padStart(5, '0')}`;

    // Normalize site name (capitalize properly)
    const siteNormalized = site.charAt(0).toUpperCase() + site.slice(1);

    // Insert invoice
    const inv = await queryOne<{ id: string }>(
      `INSERT INTO invoices (
        month, invoice_date, vendor_id, vendor_name, invoice_no, po_number,
        purpose, site, invoice_amount, payment_status, created_by, internal_no, batch_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id`,
      [
        monthDate, invoiceDate, vendorId, vendorName,
        invoiceNo || null, poNumber || null,
        purpose, siteNormalized, amount,
        paymentStatus === 'Paid' ? 'Paid' : 'Not Paid',
        HO_USER_ID, internalNo, batchId,
      ]
    );

    // If paid, create payment record
    if (paymentStatus === 'Paid' && inv) {
      const paymentDate = parseDate(paymentDateRaw) || invoiceDate;
      const paymentMonth = parseMonth(paymentMonthRaw) || monthDate;

      await query(
        `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by, batch_id, payment_month)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          inv.id, amount,
          paymentType || 'Cheque',
          paymentRef || null,
          paymentDate,
          bank || null,
          HO_USER_ID, batchId, paymentMonth,
        ]
      );
      paymentsCreated++;
    }

    // Handle partial payment rows (Not Paid but has payment data)
    if (paymentStatus === 'Not Paid' && paymentType && paymentDateRaw) {
      const paymentDate = parseDate(paymentDateRaw) || invoiceDate;
      const paymentMonth = parseMonth(paymentMonthRaw) || monthDate;

      await query(
        `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by, batch_id, payment_month)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          inv!.id, amount,
          paymentType,
          paymentRef || null,
          paymentDate,
          bank || null,
          HO_USER_ID, batchId, paymentMonth,
        ]
      );
      paymentsCreated++;
      // Recompute status
      await query(
        `UPDATE invoices SET payment_status = (
          CASE
            WHEN (SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id = $1) >= invoice_amount THEN 'Paid'
            WHEN (SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id = $1) > 0 THEN 'Partial'
            ELSE 'Not Paid'
          END
        ), updated_at = NOW() WHERE id = $1`,
        [inv!.id]
      );
    }

    imported++;
    if (imported % 100 === 0) console.log(`  ... ${imported} rows imported`);
  }

  console.log(`\nDone!`);
  console.log(`  Invoices imported: ${imported}`);
  console.log(`  Payments created:  ${paymentsCreated}`);
  console.log(`  Vendors created:   ${vendorsCreated}`);
  console.log(`  Skipped:           ${skipped}`);
  console.log(`  Batch ID:          ${batchId}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
