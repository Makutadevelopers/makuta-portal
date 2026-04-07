// import.controller.ts
// POST /api/import/invoices  — bulk import invoices from CSV/XLSX
// POST /api/import/vendors   — bulk import vendors from CSV/XLSX
// POST /api/import/payments  — bulk import payments from CSV/XLSX
// GET  /api/import/template/:type — download CSV template

import { Request, Response, NextFunction } from 'express';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
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

  // Excel serial number (pure digits, typically 40000-50000 range for 2009-2036)
  if (/^\d{4,5}$/.test(val)) {
    const num = parseInt(val, 10);
    if (num > 30000 && num < 60000) {
      // Excel epoch: Jan 1 1900, but Excel has a leap year bug for 1900
      const excelEpoch = new Date(1899, 11, 30);
      const d = new Date(excelEpoch.getTime() + num * 86400000);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    }
  }

  // DD-MM-YYYY or DD/MM/YYYY (day > 12 confirms DD-MM, otherwise try both)
  const dmy = val.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const a = parseInt(dmy[1], 10);
    const b = parseInt(dmy[2], 10);
    const year = parseInt(dmy[3], 10);
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

/** Parse CSV or XLSX buffer into rows with string values */
function parseFile(buffer: Buffer, mimetype: string): CsvRow[] {
  const isExcel = mimetype.includes('spreadsheet') ||
    mimetype.includes('excel') ||
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimetype === 'application/vnd.ms-excel';

  if (isExcel) {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    // Convert all values to strings
    return rows.map(row => {
      const strRow: CsvRow = {};
      for (const [key, val] of Object.entries(row)) {
        if (val instanceof Date) {
          strRow[key] = val.toISOString().split('T')[0];
        } else {
          strRow[key] = String(val ?? '');
        }
      }
      return strRow;
    });
  }

  // CSV
  return parse(buffer.toString('utf-8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
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

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2; // header is row 1

      try {
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

        // Skip completely empty rows (no useful data at all)
        if (!vendorName && !invoiceNo && !site && !amountStr.replace(/[₹,\s0]/g, '')) {
          skipped++;
          continue;
        }

        const amount = parseFloat(amountStr.replace(/[₹,\s]/g, '') || '0');
        const today = new Date().toISOString().split('T')[0];

        const parsedInvoiceDate = parseDate(invoiceDate);
        const parsedMonth = parseDate(month);
        const monthDate = parsedMonth || parsedInvoiceDate || today;

        // Auto-generate invoice number if missing
        const finalInvoiceNo = invoiceNo || `DRAFT-${Date.now()}-${i}`;

        // Look up vendor_id if vendor name provided
        const vendor = vendorName
          ? await queryOne<{ id: string }>('SELECT id FROM vendors WHERE LOWER(name) = LOWER($1)', [vendorName])
          : null;

        // Check for duplicate invoice_no (only if original invoice_no was provided)
        if (invoiceNo) {
          const existing = await queryOne<{ id: string }>(
            'SELECT id FROM invoices WHERE invoice_no = $1 AND vendor_name = $2',
            [invoiceNo, vendorName]
          );
          if (existing) {
            skipped++;
            continue;
          }
        }

        // Generate internal tracking number
        const seqResult = await queryOne<{ nextval: string }>("SELECT nextval('invoice_internal_seq')");
        const internalNo = `MKT-${String(seqResult!.nextval).padStart(5, '0')}`;

        await queryOne(
          `INSERT INTO invoices (
            month, invoice_date, vendor_id, vendor_name, invoice_no, po_number,
            purpose, site, invoice_amount, payment_status, remarks, created_by, internal_no
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            monthDate,
            parsedInvoiceDate || monthDate,
            vendor?.id ?? null,
            vendorName || '',
            finalInvoiceNo,
            poNumber || null,
            purpose || '',
            site || '',
            isNaN(amount) ? 0 : amount,
            paymentStatus,
            remarks || null,
            req.user!.id,
            internalNo,
          ]
        );

        imported++;
      } catch (err) {
        errors.push(`Row ${rowNum}: ${err instanceof Error ? err.message : 'unknown error'}`);
        skipped++;
      }
    }

    await logAudit({
      userId: req.user!.id,
      action: `Bulk imported ${imported} invoices from CSV (${skipped} skipped)`,
    });

    res.json({
      message: `Imported ${imported} invoices, skipped ${skipped}`,
      imported,
      skipped,
      total: records.length,
      errors: errors.slice(0, 20), // limit error output
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
        `INSERT INTO vendors (name, payment_terms, category, gstin, contact_name, phone, email, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [name, terms || 30, category, gstin, contactName, phone, email, req.user!.id]
      );
      imported++;
    }

    await logAudit({
      userId: req.user!.id,
      action: `Bulk imported ${imported} vendors from CSV (${skipped} skipped)`,
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
        const rawMonth = row['month'] || row['Month'] || row['Payment Month'] || '';
        const poNumber = row['po_number'] || row['PO Number'] || row['PO No'] || '';
        const purpose = row['purpose'] || row['Purpose'] || row['Head'] || row['Category'] || '';
        const site = row['site'] || row['Site'] || row['Site Location'] || '';

        // Parse dates robustly
        const paymentDate = parseDate(rawPaymentDate) || parseDate(rawInvoiceDate) || new Date().toISOString().split('T')[0];
        const invoiceDate = parseDate(rawInvoiceDate) || paymentDate;
        const monthDate = parseDate(rawMonth) || invoiceDate;

        // Skip rows with no payment info (Not Paid / empty status with no payment type)
        if (!paymentType && (paymentStatus === 'Not Paid' || paymentStatus === '')) {
          skipped++;
          continue;
        }

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

        // Find or auto-create the invoice
        const finalInvoiceNo = invoiceNo || `DRAFT-${Date.now()}-${i}`;
        let invoice = invoiceNo
          ? await queryOne<{ id: string }>('SELECT id FROM invoices WHERE invoice_no = $1', [invoiceNo])
          : null;

        if (!invoice) {
          // Auto-create the invoice from whatever row data we have
          const vendor = vendorName
            ? await queryOne<{ id: string }>('SELECT id FROM vendors WHERE LOWER(name) = LOWER($1)', [vendorName])
            : null;
          const seqResult = await queryOne<{ nextval: string }>("SELECT nextval('invoice_internal_seq')");
          const internalNo = `MKT-${String(seqResult!.nextval).padStart(5, '0')}`;

          invoice = await queryOne<{ id: string }>(
            `INSERT INTO invoices (
              month, invoice_date, vendor_id, vendor_name, invoice_no, po_number,
              purpose, site, invoice_amount, payment_status, remarks, created_by, internal_no
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Not Paid', NULL, $10, $11)
            RETURNING id`,
            [
              monthDate, invoiceDate, vendor?.id ?? null, vendorName || '',
              finalInvoiceNo, poNumber || null, purpose || '', site || '', amount,
              req.user!.id, internalNo,
            ]
          );
          invoicesCreated++;
        }

        if (!invoice) {
          errors.push(`Row ${rowNum}: could not find or create invoice`);
          skipped++;
          continue;
        }

        await queryOne(
          `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [invoice.id, amount, paymentType || 'NEFT', paymentRef || null, paymentDate, bank || null, req.user!.id]
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

        imported++;
      } catch (err) {
        errors.push(`Row ${rowNum}: ${err instanceof Error ? err.message : 'unknown error'}`);
        skipped++;
      }
    }

    await logAudit({
      userId: req.user!.id,
      action: `Bulk imported ${imported} payments from CSV (${skipped} skipped)`,
    });

    const msg = invoicesCreated > 0
      ? `Imported ${imported} payments (auto-created ${invoicesCreated} invoices), skipped ${skipped}`
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
      content: 'Sl.No,Month,Invoice date,Vendor Name,Invoice no,PO Number,Head,Site Location,Invoice amount,Payment Status,Pending Days,Payment Type,Payment Details,Payment Date,Bank,Payment Month\n1,2026-04-01,2026-04-01,Vendor Name,INV-001,PO-001,Steel,Nirvana,100000,Paid,0,Cheque,000856,2026-04-01,HDFC,2026-04-01\n',
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
