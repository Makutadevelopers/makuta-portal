// import.controller.ts
// POST /api/import/invoices  — bulk import invoices from CSV/XLSX
// POST /api/import/vendors   — bulk import vendors from CSV/XLSX
// POST /api/import/payments  — bulk import payments from CSV/XLSX
// GET  /api/import/template/:type — download CSV template

import { Request, Response, NextFunction } from 'express';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { query, queryOne } from '../db/query';
import { logAudit } from '../services/audit.service';

interface CsvRow {
  [key: string]: string;
}

/**
 * Robustly parse any date format into YYYY-MM-DD.
 * Handles: YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, MM/DD/YYYY,
 *          Excel serial numbers (e.g. 46080), Date objects, "Mon YYYY", etc.
 */
function parseDate(raw: string): string | null {
  if (!raw || raw.trim() === '') return null;
  const val = raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;

  // YYYY-MM-DD with time (ISO)
  if (/^\d{4}-\d{2}-\d{2}T/.test(val)) return val.split('T')[0];

  // Excel serial number (pure digits). Accepts serials for 1990-01-01 through 2049-12-31
  // to be forgiving with older data while still catching junk values.
  if (/^\d{4,6}$/.test(val)) {
    const num = parseInt(val, 10);
    // 32874 = 1990-01-01 Excel serial (accounting for 1900 leap-year bug)
    // 54789 = 2049-12-31 Excel serial
    if (num >= 32874 && num <= 54789) {
      const excelEpoch = new Date(1899, 11, 30);
      const d = new Date(excelEpoch.getTime() + num * 86400000);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    }
  }

  // DD-MM-YYYY or DD/MM/YYYY or DD/MM/YY (2 or 4-digit year)
  const dmy = val.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const a = parseInt(dmy[1], 10);
    const b = parseInt(dmy[2], 10);
    let year = parseInt(dmy[3], 10);
    // Convert 2-digit year: 00-49 → 2000-2049, 50-99 → 1950-1999
    if (year < 100) year += year < 50 ? 2000 : 1900;
    // If first part > 12 it must be DD-MM-YYYY
    if (a > 12) {
      return `${year}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    }
    // If second part > 12 it must be MM-DD-YYYY
    if (b > 12) {
      return `${year}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    }
    // Ambiguous (both <= 12) — assume DD-MM-YYYY (Indian format)
    return `${year}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  }

  // YYYY/MM/DD
  const ymd = val.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${String(ymd[2]).padStart(2, '0')}-${String(ymd[3]).padStart(2, '0')}`;
  }

  // "Jan 2026", "January 2026", etc.
  const monthYear = new Date(val + ' 1');
  if (!isNaN(monthYear.getTime()) && monthYear.getFullYear() > 2000) {
    return monthYear.toISOString().split('T')[0];
  }

  // Last resort: let JS parse it
  const fallback = new Date(val);
  if (!isNaN(fallback.getTime()) && fallback.getFullYear() > 2000) {
    return fallback.toISOString().split('T')[0];
  }

  return null;
}

/**
 * Parse month column values like "Nov-2025", "Nov-25", "Jan-2026" into YYYY-MM-01.
 */
function parseMonthColumn(raw: string): string | null {
  if (!raw || raw.trim() === '') return null;
  const val = raw.trim();

  const monthNames: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  // "Nov-2025", "Nov-25", "January-2025", "Jan 2026"
  const match = val.match(/^([A-Za-z]+)[- ]?(\d{2,4})$/);
  if (match) {
    const mon = monthNames[match[1].slice(0, 3).toLowerCase()];
    if (!mon) return null;
    let year = parseInt(match[2], 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    return `${year}-${mon}-01`;
  }

  return null;
}

/** Known header columns to detect the real header row */
const KNOWN_HEADERS = ['Sl.No', 'Invoice date', 'Vendor Name', 'Invoice no', 'Invoice amount'];

/** Parse CSV or XLSX buffer into rows with string values */
function parseFile(buffer: Buffer, mimetype: string): CsvRow[] {
  const isExcel = mimetype.includes('spreadsheet') ||
    mimetype.includes('excel') ||
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimetype === 'application/vnd.ms-excel';

  let rawRows: string[][];

  if (isExcel) {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];
  } else {
    rawRows = parse(buffer.toString('utf-8'), {
      columns: false,
      skip_empty_lines: false,
      trim: true,
      bom: true,
    });
  }

  // Find the real header row (the one containing known column names)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const rowStr = rawRows[i].map(c => String(c ?? '').trim());
    const matches = KNOWN_HEADERS.filter(h => rowStr.includes(h));
    if (matches.length >= 2) {
      headerIdx = i;
      break;
    }
  }

  const headers = rawRows[headerIdx].map(c => String(c ?? '').trim());
  const dataRows = rawRows.slice(headerIdx + 1);

  // Convert to keyed objects, only using columns up to the header count
  const result: CsvRow[] = [];
  for (const row of dataRows) {
    const obj: CsvRow = {};
    for (let j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      const val = row[j] as unknown;
      if (val instanceof Date) {
        obj[headers[j]] = val.toISOString().split('T')[0];
      } else {
        obj[headers[j]] = String(val ?? '').trim();
      }
    }
    result.push(obj);
  }

  return result;
}

/**
 * Normalize a single CSV row into the shape we'll insert, plus the row number for reporting.
 * Returns null for completely empty rows.
 */
interface NormalizedRow {
  rowNum: number;
  month: string;
  invoiceDate: string;
  vendorName: string;
  invoiceNo: string;
  poNumber: string;
  purpose: string;
  site: string;
  amount: number;
  remarks: string;
  paymentStatus: string;
  paymentType: string;
  paymentRef: string;
  paymentDate: string | null;
  paymentBank: string;
  paymentMonth: string;
}

function normalizeInvoiceRow(row: CsvRow, rowNum: number): NormalizedRow | { skip: true; reason: string } {
  const month = row['month'] || row['Month'] || row['Payment Month'] || '';
  const invoiceDate = row['invoice_date'] || row['Invoice date'] || row['Invoice Date'] || row['Date'] || '';
  const vendorName = row['vendor_name'] || row['Vendor Name'] || row['Vendor'] || '';
  const invoiceNo = row['invoice_no'] || row['Invoice no'] || row['Invoice No'] || row['Invoice Number'] || '';
  const poNumber = row['po_number'] || row['PO Number'] || row['PO No'] || '';
  const purpose = row['purpose'] || row['Purpose'] || row['Head'] || row['Category'] || '';
  const site = row['site'] || row['Site'] || row['Site Location'] || '';
  const amountStr = row['invoice_amount'] || row['Invoice amount'] || row['Invoice Amount'] || row['Amount'] || '0';
  const remarks = row['remarks'] || row['Remarks'] || '';
  const paymentStatus = row['payment_status'] || row['Payment Status'] || row['Status'] || 'Not Paid';
  const paymentType = row['payment_type'] || row['Payment Type'] || row['Pay Type'] || '';
  const paymentRef = row['payment_details'] || row['Payment Details'] || row['Cheque No'] || row['Txn ID'] || '';
  const paymentDateRaw = row['payment_date'] || row['Payment Date'] || '';
  const paymentBank = row['bank'] || row['Bank'] || '';
  const paymentMonthRaw = row['payment_month'] || row['Payment Month'] || '';

  // Skip completely empty rows
  if (!vendorName && !invoiceNo && !site && !amountStr.replace(/[₹,\s0]/g, '')) {
    return { skip: true, reason: 'empty row' };
  }

  // M4: reject negative or non-numeric amounts
  const amountRaw = parseFloat(amountStr.replace(/[₹,\s]/g, '') || '0');
  if (isNaN(amountRaw) || amountRaw < 0) {
    return { skip: true, reason: `invalid amount "${amountStr}"` };
  }
  const amount = amountRaw;

  const parsedInvoiceDate = parseDate(invoiceDate);
  const parsedMonth = parseMonthColumn(month);
  const today = new Date().toISOString().split('T')[0];
  const monthDate = parsedMonth || (parsedInvoiceDate ? `${parsedInvoiceDate.slice(0, 7)}-01` : today);

  const parsedPaymentDate = parseDate(paymentDateRaw);
  const parsedPaymentMonth = parseMonthColumn(paymentMonthRaw);

  return {
    rowNum,
    month: monthDate,
    invoiceDate: parsedInvoiceDate || monthDate,
    vendorName,
    invoiceNo,
    poNumber,
    purpose,
    site,
    amount,
    remarks,
    paymentStatus,
    paymentType,
    paymentRef,
    paymentDate: parsedPaymentDate,
    paymentBank,
    paymentMonth: parsedPaymentMonth || monthDate,
  };
}

/**
 * Find duplicates for a batch of normalized rows.
 * Returns the subset that collides with existing non-deleted invoices.
 */
async function findDuplicates(rows: NormalizedRow[]): Promise<Array<{
  row: number;
  invoiceNo: string;
  vendorName: string;
  site: string;
  amount: number;
  invoiceDate: string;
  existingId: string;
  existingInvoiceNo: string | null;
  existingAmount: string;
  existingDate: string;
}>> {
  const dups: Array<{
    row: number; invoiceNo: string; vendorName: string; site: string; amount: number; invoiceDate: string;
    existingId: string; existingInvoiceNo: string | null; existingAmount: string; existingDate: string;
  }> = [];

  for (const r of rows) {
    let existing: { id: string; invoice_no: string | null; invoice_amount: string; invoice_date: string } | null = null;
    if (r.invoiceNo) {
      existing = await queryOne(
        `SELECT id, invoice_no, invoice_amount, invoice_date FROM invoices
         WHERE invoice_no = $1 AND LOWER(TRIM(vendor_name)) = LOWER(TRIM($2)) AND deleted_at IS NULL`,
        [r.invoiceNo, r.vendorName]
      );
    } else if (r.vendorName) {
      existing = await queryOne(
        `SELECT id, invoice_no, invoice_amount, invoice_date FROM invoices
         WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM($1))
           AND invoice_amount = $2 AND invoice_date = $3 AND deleted_at IS NULL`,
        [r.vendorName, r.amount, r.invoiceDate]
      );
    }
    if (existing) {
      dups.push({
        row: r.rowNum,
        invoiceNo: r.invoiceNo || '(no invoice no)',
        vendorName: r.vendorName,
        site: r.site,
        amount: r.amount,
        invoiceDate: r.invoiceDate,
        existingId: existing.id,
        existingInvoiceNo: existing.invoice_no,
        existingAmount: existing.invoice_amount,
        existingDate: existing.invoice_date,
      });
    }
  }

  return dups;
}

export async function importInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Bad Request', message: 'No file uploaded' });
      return;
    }

    const records = parseFile(file.buffer, file.mimetype);
    if (records.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'File is empty' });
      return;
    }

    // Mode: preview (dry-run, detect dupes), commit (actually write)
    // Default = preview so accidental uploads don't clobber data.
    const mode = (req.body?.mode as string) || 'preview';
    // Row numbers (from the preview) that HO has explicitly confirmed as "yes, create these duplicates"
    // Multer form-data gives us an array when the field appears multiple times, a string when it appears once.
    const confirmedDuplicateRowsRaw = req.body?.confirmedDuplicates;
    const confirmedAsArray: unknown[] = Array.isArray(confirmedDuplicateRowsRaw)
      ? confirmedDuplicateRowsRaw
      : confirmedDuplicateRowsRaw != null
        ? [confirmedDuplicateRowsRaw]
        : [];
    const confirmedDuplicateRows = new Set<number>(
      confirmedAsArray.map(n => Number(n)).filter(Number.isFinite)
    );

    const callerRole = req.user!.role;
    const callerSite = req.user!.site;

    // Phase 1: normalize all rows
    const normalized: NormalizedRow[] = [];
    const skippedRows: Array<{ row: number; reason: string }> = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2; // header is row 1

      const norm = normalizeInvoiceRow(row, rowNum);
      if ('skip' in norm) {
        skippedRows.push({ row: rowNum, reason: norm.reason });
        continue;
      }

      // Site accountants can only import rows for their own site
      if (callerRole === 'site' && norm.site && norm.site !== callerSite) {
        skippedRows.push({ row: rowNum, reason: `site "${norm.site}" not owned by current user` });
        continue;
      }

      normalized.push(norm);
    }

    // Phase 2: detect duplicates against current DB state
    const duplicates = await findDuplicates(normalized);
    const duplicateRowNums = new Set(duplicates.map(d => d.row));

    // Preview mode — return the plan without writing anything
    if (mode === 'preview') {
      res.json({
        mode: 'preview',
        total: records.length,
        toImport: normalized.length - duplicates.length,
        duplicates,
        skipped: skippedRows,
      });
      return;
    }

    // Commit mode — write to DB
    const batchId = randomUUID();
    let imported = 0;
    let vendorsCreated = 0;
    const errors: string[] = [];
    const forcedDuplicates: Array<{ row: number; invoiceNo: string; vendorName: string }> = [];

    for (const r of normalized) {
      try {
        const isDup = duplicateRowNums.has(r.rowNum);
        if (isDup && !confirmedDuplicateRows.has(r.rowNum)) {
          // Duplicate that HO did NOT confirm → skip silently in commit mode
          continue;
        }

        // Look up or auto-create vendor
        let vendor: { id: string } | null = r.vendorName
          ? await queryOne<{ id: string }>('SELECT id FROM vendors WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))', [r.vendorName])
          : null;

        if (!vendor && r.vendorName) {
          vendor = await queryOne<{ id: string }>(
            `INSERT INTO vendors (name, payment_terms, category, created_by, batch_id)
             VALUES (TRIM($1), 30, $2, $3, $4)
             ON CONFLICT (name) DO UPDATE SET name = vendors.name
             RETURNING id`,
            [r.vendorName, r.purpose || null, req.user!.id, batchId]
          );
          vendorsCreated++;
        }

        const seqResult = await queryOne<{ nextval: string }>("SELECT nextval('invoice_internal_seq')");
        const internalNo = `MKT-${String(seqResult!.nextval).padStart(5, '0')}`;

        const insertedInvoice = await queryOne<{ id: string }>(
          `INSERT INTO invoices (
            month, invoice_date, vendor_id, vendor_name, invoice_no, po_number,
            purpose, site, invoice_amount, payment_status, remarks, created_by, internal_no, batch_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING id`,
          [
            r.month,
            r.invoiceDate,
            vendor?.id ?? null,
            r.vendorName || '',
            r.invoiceNo || null,
            r.poNumber || null,
            r.purpose || '',
            r.site || '',
            r.amount,
            r.paymentStatus,
            r.remarks || null,
            req.user!.id,
            internalNo,
            batchId,
          ]
        );

        // Auto-create payment + bank transaction for Paid invoices
        if (insertedInvoice && r.paymentStatus === 'Paid' && r.amount > 0) {
          let bankTxnId: string | null = null;
          const isBankPayment = r.paymentType && r.paymentType.toLowerCase() !== 'cash';

          // Create bank_transaction for Cheque/NEFT/RTGS payments
          if (isBankPayment && r.paymentRef) {
            const existingTxn = await queryOne<{ id: string }>(
              `SELECT id FROM bank_transactions WHERE txn_ref = $1 AND bank = $2`,
              [r.paymentRef, r.paymentBank]
            );
            if (existingTxn) {
              bankTxnId = existingTxn.id;
              // Add this amount to the existing transaction
              await queryOne(
                `UPDATE bank_transactions SET txn_amount = txn_amount + $1 WHERE id = $2`,
                [r.amount, bankTxnId]
              );
            } else {
              const newTxn = await queryOne<{ id: string }>(
                `INSERT INTO bank_transactions (txn_type, txn_ref, txn_amount, txn_date, bank, remarks, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [
                  r.paymentType,
                  r.paymentRef,
                  r.amount,
                  r.paymentDate || r.invoiceDate,
                  r.paymentBank || '',
                  `Imported batch ${batchId.slice(0, 8)}`,
                  req.user!.id,
                ]
              );
              bankTxnId = newTxn?.id ?? null;
            }
          }

          await queryOne(
            `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by, payment_month, bank_txn_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              insertedInvoice.id,
              r.amount,
              r.paymentType || 'Import',
              r.paymentRef || `IMPORT-${batchId.slice(0, 8)}`,
              r.paymentDate || r.invoiceDate,
              r.paymentBank || null,
              req.user!.id,
              r.paymentMonth,
              bankTxnId,
            ]
          );
        }

        if (isDup) {
          forcedDuplicates.push({ row: r.rowNum, invoiceNo: r.invoiceNo || '(no invoice no)', vendorName: r.vendorName });
          // Log to alerts so the duplicate is visible later
          await queryOne(
            `INSERT INTO alerts (alert_type, title, message, metadata)
             VALUES ('duplicate_invoice', $1, $2, $3)`,
            [
              `Duplicate invoice #${r.invoiceNo || '(none)'} (force-imported)`,
              `HO explicitly confirmed importing duplicate invoice #${r.invoiceNo || '(no invoice no)'} from "${r.vendorName}" during bulk upload.`,
              JSON.stringify({ row: r.rowNum, batchId, vendorName: r.vendorName }),
            ]
          ).catch(() => { /* alerts are best-effort */ });
        }

        imported++;
      } catch (err) {
        errors.push(`Row ${r.rowNum}: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }

    await logAudit({
      userId: req.user!.id,
      action: `Bulk imported ${imported} invoices (${forcedDuplicates.length} confirmed duplicates, ${skippedRows.length} skipped)`,
      metadata: { batchId, type: 'invoices', imported, forcedDuplicates: forcedDuplicates.length, skipped: skippedRows.length },
    });

    res.json({
      mode: 'commit',
      message: `Imported ${imported} invoice${imported === 1 ? '' : 's'}${vendorsCreated > 0 ? ` (auto-created ${vendorsCreated} vendors)` : ''}${forcedDuplicates.length > 0 ? `, including ${forcedDuplicates.length} confirmed duplicate${forcedDuplicates.length === 1 ? '' : 's'}` : ''}`,
      imported,
      total: records.length,
      batchId,
      forcedDuplicates,
      skipped: skippedRows,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    next(err);
  }
}

export async function importVendors(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Bad Request', message: 'No file uploaded' });
      return;
    }

    const records = parseFile(file.buffer, file.mimetype);

    let imported = 0;
    let skipped = 0;
    const batchId = randomUUID();

    for (const row of records) {
      const name = row['name'] || row['Vendor Name'] || row['Name'] || '';
      const terms = parseInt(row['payment_terms'] || row['Terms'] || '30', 10);
      const category = row['category'] || row['Category'] || null;
      const gstin = row['gstin'] || row['GSTIN'] || null;
      const contactName = row['contact_name'] || row['Contact'] || null;
      const phone = row['phone'] || row['Phone'] || null;
      const email = row['email'] || row['Email'] || null;

      if (!name) { skipped++; continue; }

      const existing = await queryOne<{ id: string }>(
        'SELECT id FROM vendors WHERE LOWER(name) = LOWER($1)', [name]
      );
      if (existing) { skipped++; continue; }

      await queryOne(
        `INSERT INTO vendors (name, payment_terms, category, gstin, contact_name, phone, email, created_by, batch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [name, terms || 30, category, gstin, contactName, phone, email, req.user!.id, batchId]
      );
      imported++;
    }

    await logAudit({
      userId: req.user!.id,
      action: `Bulk imported ${imported} vendors from CSV (${skipped} skipped)`,
      metadata: { batchId, type: 'vendors', imported, skipped },
    });

    res.json({ message: `Imported ${imported} vendors, skipped ${skipped}`, imported, skipped, total: records.length });
  } catch (err) {
    next(err);
  }
}

export async function importPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Bad Request', message: 'No file uploaded' });
      return;
    }

    const records = parseFile(file.buffer, file.mimetype);

    let imported = 0;
    let skipped = 0;
    const batchId = randomUUID();

    const errors: string[] = [];

    let invoicesCreated = 0;

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2;

      try {
        const invoiceNo = row['invoice_no'] || row['Invoice no'] || row['Invoice No'] || row['Invoice Number'] || '';
        const amountStr = row['amount'] || row['Invoice amount'] || row['Invoice Amount'] || row['Amount'] || '0';
        const paymentType = row['payment_type'] || row['Payment Type'] || row['Type'] || '';
        const paymentRef = row['payment_ref'] || row['Payment Details'] || row['Payment Ref'] || row['Reference'] || '';
        const rawPaymentDate = row['payment_date'] || row['Payment Date'] || '';
        const bank = row['bank'] || row['Bank'] || '';
        const paymentStatus = row['payment_status'] || row['Payment Status'] || row['Status'] || '';

        // Also read invoice-level fields (used to auto-create invoice if missing)
        const vendorName = row['vendor_name'] || row['Vendor Name'] || row['Vendor'] || '';
        const rawInvoiceDate = row['invoice_date'] || row['Invoice date'] || row['Invoice Date'] || '';
        const rawMonth = row['month'] || row['Month'] || '';
        const rawPaymentMonth = row['Payment Month'] || row['payment_month'] || '';
        const poNumber = row['po_number'] || row['PO Number'] || row['PO No'] || '';
        const purpose = row['purpose'] || row['Purpose'] || row['Head'] || row['Category'] || '';
        const site = row['site'] || row['Site'] || row['Site Location'] || '';

        // Parse dates robustly
        const paymentDate = parseDate(rawPaymentDate) || parseDate(rawInvoiceDate) || new Date().toISOString().split('T')[0];
        const invoiceDate = parseDate(rawInvoiceDate) || paymentDate;
        // Use the Month column as-is (accounting month), fall back to invoice_date month
        const parsedMonth = parseMonthColumn(rawMonth);
        const monthDate = parsedMonth
          || (invoiceDate ? `${invoiceDate.slice(0, 7)}-01` : invoiceDate);

        // Skip completely empty rows
        if (!invoiceNo && !vendorName && !amountStr.replace(/[₹,\s0]/g, '')) {
          skipped++;
          continue;
        }

        const amount = parseFloat(String(amountStr).replace(/[₹,\s]/g, '') || '0');
        if (isNaN(amount) || amount <= 0) {
          skipped++;
          continue;
        }

        const hasPaymentData = !!(paymentType || (paymentStatus && paymentStatus !== 'Not Paid'));

        // Find or auto-create the invoice
        let invoice = invoiceNo
          ? await queryOne<{ id: string }>('SELECT id FROM invoices WHERE invoice_no = $1', [invoiceNo])
          : null;

        // For rows without invoice_no, check for duplicate by vendor + amount + date
        if (!invoice && !invoiceNo && vendorName) {
          invoice = await queryOne<{ id: string }>(
            `SELECT id FROM invoices WHERE LOWER(vendor_name) = LOWER($1)
             AND invoice_amount = $2 AND invoice_date = $3 AND deleted_at IS NULL`,
            [vendorName, amount, invoiceDate]
          );
        }

        if (!invoice) {
          // Auto-create vendor + invoice from whatever row data we have
          let vendor: { id: string } | null = vendorName
            ? await queryOne<{ id: string }>('SELECT id FROM vendors WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))', [vendorName])
            : null;
          if (!vendor && vendorName) {
            vendor = await queryOne<{ id: string }>(
              `INSERT INTO vendors (name, payment_terms, category, created_by)
               VALUES (TRIM($1), 30, $2, $3)
               ON CONFLICT (name) DO UPDATE SET name = vendors.name
               RETURNING id`,
              [vendorName, purpose || null, req.user!.id]
            );
          }
          const seqResult = await queryOne<{ nextval: string }>("SELECT nextval('invoice_internal_seq')");
          const internalNo = `MKT-${String(seqResult!.nextval).padStart(5, '0')}`;

          invoice = await queryOne<{ id: string }>(
            `INSERT INTO invoices (
              month, invoice_date, vendor_id, vendor_name, invoice_no, po_number,
              purpose, site, invoice_amount, payment_status, remarks, created_by, internal_no, batch_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Not Paid', NULL, $10, $11, $12)
            RETURNING id`,
            [
              monthDate, invoiceDate, vendor?.id ?? null, vendorName || '',
              invoiceNo || null, poNumber || null, purpose || '', site || '', amount,
              req.user!.id, internalNo, batchId,
            ]
          );
          invoicesCreated++;
        }

        if (!invoice) {
          errors.push(`Row ${rowNum}: could not find or create invoice`);
          skipped++;
          continue;
        }

        // Only insert a payment record if row has actual payment data
        if (hasPaymentData) {
          // Duplicate payment check: same invoice, amount, date, and ref
          const existingPayment = await queryOne<{ id: string }>(
            `SELECT id FROM payments WHERE invoice_id = $1 AND amount = $2 AND payment_date = $3
             AND COALESCE(payment_ref, '') = COALESCE($4, '')`,
            [invoice.id, amount, paymentDate, paymentRef || null]
          );
          if (existingPayment) {
            skipped++;
            continue;
          }

          await queryOne(
            `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by, batch_id, payment_month)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [invoice.id, amount, paymentType || 'NEFT', paymentRef || null, paymentDate, bank || null, req.user!.id, batchId,
             parseMonthColumn(rawPaymentMonth) || monthDate]
          );

          // Recompute status
          await query(
            `UPDATE invoices SET payment_status = (
              CASE
                WHEN (SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id = $1) >= invoice_amount THEN 'Paid'
                WHEN (SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id = $1) > 0 THEN 'Partial'
                ELSE 'Not Paid'
              END
            ), updated_at = NOW() WHERE id = $1`,
            [invoice.id]
          );
        }

        imported++;
      } catch (err) {
        errors.push(`Row ${rowNum}: ${err instanceof Error ? err.message : 'unknown error'}`);
        skipped++;
      }
    }

    await logAudit({
      userId: req.user!.id,
      action: `Bulk imported ${imported} payments from CSV (${skipped} skipped)`,
      metadata: { batchId, type: 'payments', imported, skipped, invoicesCreated },
    });

    const paymentsRecorded = imported - invoicesCreated + (invoicesCreated > 0 ? invoicesCreated : 0);
    const msg = invoicesCreated > 0
      ? `Imported ${imported} rows (${invoicesCreated} invoices created, payments recorded where applicable), skipped ${skipped}`
      : `Imported ${imported} payments, skipped ${skipped}`;

    res.json({
      message: msg,
      imported,
      skipped,
      total: records.length,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    next(err);
  }
}

export async function clearImportedData(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = req.params.type as string;

    if (type === 'payments') {
      const result = await query<{ count: string }>('SELECT COUNT(*)::TEXT AS count FROM payments');
      const count = parseInt(result[0].count, 10);
      await query('DELETE FROM payments');
      // Reset all invoice statuses to Not Paid
      await query("UPDATE invoices SET payment_status = 'Not Paid', updated_at = NOW()");
      await logAudit({ userId: req.user!.id, action: `Cleared all ${count} payments` });
      res.json({ message: `Deleted ${count} payments. All invoices reset to Not Paid.`, deleted: count });
    } else if (type === 'invoices') {
      // Delete dependents first (FK constraints)
      await query('DELETE FROM payments');
      await query('DELETE FROM attachments');
      await query('UPDATE audit_logs SET invoice_id = NULL WHERE invoice_id IS NOT NULL');
      const result = await query<{ count: string }>('SELECT COUNT(*)::TEXT AS count FROM invoices');
      const count = parseInt(result[0].count, 10);
      await query('DELETE FROM invoices');
      await logAudit({ userId: req.user!.id, action: `Cleared all ${count} invoices and related payments` });
      res.json({ message: `Deleted ${count} invoices and all related payments.`, deleted: count });
    } else if (type === 'vendors') {
      // Null out FK references in invoices first (FK constraint)
      await query('UPDATE invoices SET vendor_id = NULL WHERE vendor_id IS NOT NULL');
      const result = await query<{ count: string }>('SELECT COUNT(*)::TEXT AS count FROM vendors');
      const count = parseInt(result[0].count, 10);
      await query('DELETE FROM vendors');
      await logAudit({ userId: req.user!.id, action: `Cleared all ${count} vendors` });
      res.json({ message: `Deleted ${count} vendors.`, deleted: count });
    } else {
      res.status(400).json({ error: 'Bad Request', message: 'Type must be payments, invoices, or vendors' });
    }
  } catch (err) {
    next(err);
  }
}

export function downloadTemplate(req: Request, res: Response): void {
  const type = req.params.type as string;

  const templates: Record<string, { filename: string; content: string }> = {
    invoices: {
      filename: 'invoice_import_template.csv',
      content: 'Sl.No,Month,Invoice date,Vendor Name,Invoice no,PO Number,Head,Site Location,Invoice amount,Payment Status,Pending Days,Payment Type,Payment Details,Payment Date,Bank,Payment Month\n1,2026-04-01,2026-04-01,Vendor Name,INV-001,PO-001,Steel,Nirvana,100000,Not Paid,,,,,,\n',
    },
    vendors: {
      filename: 'vendor_import_template.csv',
      content: 'name,payment_terms,category,gstin,contact_name,phone,email\nVendor Name,30,Steel,29AABCS1429B1ZB,Contact Person,9848012345,vendor@email.com\n',
    },
    payments: {
      filename: 'payment_import_template.csv',
      content: 'Sl.No,Month,Invoice date,Vendor Name,Invoice no,PO Number,Head,Site Location,Invoice amount,Payment Status,Pending Days,Payment Type,Payment Details,Payment Date,Bank,,Payment Month\n' +
        '1,Apr-2026,01-04-2026,Vendor Name,INV-001,MPLLP/NV/25-26/PO/001,Steel,Nirvana,100000,Paid,0,Cheque,000856,01-04-2026,HDFC,,Apr-2026\n' +
        '2,Apr-2026,01-04-2026,Vendor Name,INV-002,MPLLP/NV/25-26/WO/002,Cement,Nirvana,50000,Not Paid,30,,,,,,\n',
    },
  };

  const tmpl = templates[type];
  if (!tmpl) {
    res.status(404).json({ error: 'Not Found', message: 'Unknown template type' });
    return;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${tmpl.filename}"`);
  res.send(tmpl.content);
}

export async function undoBatchImport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { batchId } = req.params;

    // Count what will be deleted
    const paymentCount = await queryOne<{ count: string }>(
      "SELECT COUNT(*)::TEXT AS count FROM payments WHERE batch_id = $1", [batchId]
    );
    const invoiceCount = await queryOne<{ count: string }>(
      "SELECT COUNT(*)::TEXT AS count FROM invoices WHERE batch_id = $1", [batchId]
    );
    const vendorCount = await queryOne<{ count: string }>(
      "SELECT COUNT(*)::TEXT AS count FROM vendors WHERE batch_id = $1", [batchId]
    );

    const payments = parseInt(paymentCount?.count ?? '0', 10);
    const invoices = parseInt(invoiceCount?.count ?? '0', 10);
    const vendors = parseInt(vendorCount?.count ?? '0', 10);

    if (payments === 0 && invoices === 0 && vendors === 0) {
      res.status(404).json({ error: 'Not Found', message: 'No records found for this batch' });
      return;
    }

    // Delete in order: payments → attachments → invoices → vendors
    await query('DELETE FROM payments WHERE batch_id = $1', [batchId]);
    await query('DELETE FROM attachments WHERE invoice_id IN (SELECT id FROM invoices WHERE batch_id = $1)', [batchId]);
    await query('DELETE FROM invoices WHERE batch_id = $1', [batchId]);
    await query('DELETE FROM vendors WHERE batch_id = $1', [batchId]);

    // Recompute payment status for invoices that had payments removed
    // (in case payments from this batch were linked to invoices from another batch)
    await query(
      `UPDATE invoices SET payment_status = (
        CASE
          WHEN (SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id = invoices.id) >= invoice_amount THEN 'Paid'
          WHEN (SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id = invoices.id) > 0 THEN 'Partial'
          ELSE 'Not Paid'
        END
      ), updated_at = NOW()
      WHERE id IN (SELECT DISTINCT invoice_id FROM payments WHERE batch_id IS NULL OR batch_id != $1)`,
      [batchId]
    );

    await logAudit({
      userId: req.user!.id,
      action: `Undid bulk import batch: deleted ${invoices} invoices, ${payments} payments, ${vendors} vendors`,
      metadata: { batchId },
    });

    res.json({
      message: `Deleted ${invoices} invoices, ${payments} payments, ${vendors} vendors from this batch.`,
      deleted: { invoices, payments, vendors },
    });
  } catch (err) {
    next(err);
  }
}
