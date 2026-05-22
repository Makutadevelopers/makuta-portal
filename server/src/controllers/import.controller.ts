// import.controller.ts
// POST /api/import/invoices  — bulk import invoices from CSV/XLSX
// POST /api/import/vendors   — bulk import vendors from CSV/XLSX
// POST /api/import/payments  — bulk import payments from CSV/XLSX
// GET  /api/import/template/:type — download CSV template

import { Request, Response, NextFunction } from 'express';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { query, queryOne, withTransaction } from '../db/query';
import { logAudit } from '../services/audit.service';
import { paymentStatusCase, recomputeInvoiceStatus, syncBankTxnForPayment } from '../services/payment.service';
import { normaliseSiteName, isCanonicalSite, CANONICAL_SITES } from '../utils/sites';

interface CsvRow {
  [key: string]: string;
}

/**
 * Normalise a cheque/transaction reference so the same physical cheque matches
 * regardless of how it was typed — strips a leading "Chq"/"Cheque"/"Chq no:"
 * token and surrounding punctuation, keeping the bare number/UTR. This keeps the
 * importer's cheque identity aligned with the interactive flow ("Chq 000968" →
 * "000968"), so a re-import doesn't spawn a duplicate bank_transactions row.
 */
function normalizeChequeRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const cleaned = ref.trim().replace(/^(cheque|chq|chk|ch)\.?\s*(no\.?|number|#)?\s*[:#\-]?\s*/i, '').trim();
  return cleaned || null;
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

  // DD-MMM-YYYY or DD-MMM-YY (e.g. "03-Jul-24", "21 Mar 2025"). This format
  // is common in Indian accounting spreadsheets and was previously parsed by
  // the JS Date fallback below — but that fallback also accepted garbage
  // like "Apr-26" and "Mon-YY"-shaped strings, which is the root cause of
  // the F1/F8 corruption fixed in migrations 035 + 036. So we now match the
  // pattern explicitly and reject anything else.
  const dMy = val.match(/^(\d{1,2})[- /]([A-Za-z]{3,9})[- /](\d{2,4})$/);
  if (dMy) {
    const day = parseInt(dMy[1], 10);
    const monKey = dMy[2].slice(0, 3).toLowerCase();
    const monthNames: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mon = monthNames[monKey];
    if (mon && day >= 1 && day <= 31) {
      let year = parseInt(dMy[3], 10);
      if (year < 100) year += year < 50 ? 2000 : 1900;
      return `${year}-${mon}-${String(day).padStart(2, '0')}`;
    }
  }

  // Deliberately no permissive fallback. Strings the canonical patterns
  // don't match are returned as null — the caller is responsible for
  // surfacing that as a row-level error in the preview screen.
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

/**
 * Parse CSV or XLSX buffer into rows with string values, plus the header
 * names we recognised — the preview screen reports unrecognised/missing
 * headers so the uploader can fix column mis-naming (the upstream cause
 * of F1/F8 corruption was the importer reading values from columns whose
 * header didn't match what it was looking up).
 */
function parseFile(buffer: Buffer, mimetype: string): { rows: CsvRow[]; headers: string[] } {
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
      // Excel exports frequently emit a trailing comma so some rows have one
      // more column than the header. Without this flag csv-parse aborts the
      // whole file with CSV_RECORD_INCONSISTENT_FIELDS_LENGTH and nothing
      // imports. Extra columns past the header are ignored downstream because
      // parseFile maps by header index.
      relax_column_count: true,
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
        // SheetJS aligns date-cell Date objects to LOCAL midnight of the
        // intended calendar date — toISOString().split('T')[0] would then
        // shift dates by -1 day on any host running east of UTC (this is
        // what corrupted batch 90209c92 on 2026-04-11). Read local getters
        // to recover the intended day, independent of host timezone.
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        obj[headers[j]] = `${y}-${m}-${d}`;
      } else {
        obj[headers[j]] = String(val ?? '').trim();
      }
    }
    result.push(obj);
  }

  return { rows: result, headers: headers.filter(h => h.length > 0) };
}

/**
 * Header set the invoice importer knows how to consume (matches the
 * synonym lookups in normalizeInvoiceRow). Used by the preview screen
 * to flag unrecognised columns in the uploaded file so the user can
 * rename them before commit, instead of the importer silently dropping
 * the value.
 */
const RECOGNISED_INVOICE_HEADERS = new Set([
  // invoice identity
  'sl.no', 'slno', 'serial', 'serial no',
  'month',
  'invoice date', 'invoice_date', 'date',
  'vendor name', 'vendor_name', 'vendor',
  'invoice no', 'invoice_no', 'invoice number',
  'po number', 'po_number', 'po no',
  'head', 'category', 'purpose',
  'site location', 'site', 'site_location',
  // money
  'invoice amount', 'invoice_amount', 'amount',
  'base amount', 'base_amount', 'taxable value', 'taxable value (₹)',
  'cgst %', 'cgst', 'cgst_pct', 'cgst pct',
  'sgst %', 'sgst', 'sgst_pct', 'sgst pct',
  'igst %', 'igst', 'igst_pct', 'igst pct',
  'additional charge', 'additional_charge',
  'additional charge cgst %', 'add charge cgst %', 'additional_charge_cgst_pct',
  'additional charge sgst %', 'add charge sgst %', 'additional_charge_sgst_pct',
  'additional charge igst %', 'add charge igst %', 'additional_charge_igst_pct',
  'additional charge reason', 'add charge reason', 'additional_charge_reason',
  'remarks',
  // payment
  'payment status', 'payment_status', 'status',
  'paid amount', 'paid_amount', 'amount paid',
  'pending days',
  'payment type', 'payment_type', 'pay type', 'type',
  'payment details', 'payment_details', 'cheque no', 'txn id', 'reference', 'payment ref',
  'payment date', 'payment_date',
  'bank',
  'payment month', 'payment_month',
]);

/** Canonical core headers that must be present for the import to mean anything. */
const REQUIRED_INVOICE_HEADERS = ['Invoice date', 'Vendor Name', 'Invoice amount', 'Site Location'];

interface HeaderReport {
  recognised: string[];
  unrecognised: string[];
  missing_required: string[];
}

function analyseHeaders(headers: string[]): HeaderReport {
  const recognised: string[] = [];
  const unrecognised: string[] = [];
  for (const h of headers) {
    if (!h) continue;
    if (RECOGNISED_INVOICE_HEADERS.has(h.toLowerCase().trim())) {
      recognised.push(h);
    } else {
      unrecognised.push(h);
    }
  }
  const lowerSet = new Set(headers.map(h => h.toLowerCase().trim()));
  const missing_required = REQUIRED_INVOICE_HEADERS.filter(req => !lowerSet.has(req.toLowerCase()));
  return { recognised, unrecognised, missing_required };
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
  baseAmount: number;
  cgstPct: number;
  sgstPct: number;
  igstPct: number;
  additionalCharge: number;
  additionalChargeCgstPct: number;
  additionalChargeSgstPct: number;
  additionalChargeIgstPct: number;
  additionalChargeReason: string;
  remarks: string;
  paymentStatus: string;
  paidAmount: number;
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
  const site = normaliseSiteName(row['site'] || row['Site'] || row['Site Location'] || '');
  const amountStr = row['invoice_amount'] || row['Invoice amount'] || row['Invoice Amount'] || row['Amount'] || '0';
  // Optional tax split — if any of these are present we use them; otherwise fall
  // back to amount-as-base with zero taxes (legacy behaviour).
  const baseAmountStr = row['base_amount'] || row['Base Amount'] || row['Taxable Value'] || row['Taxable Value (₹)'] || '';
  const cgstPctStr = row['cgst_pct'] || row['CGST %'] || row['CGST Pct'] || row['CGST'] || '';
  const sgstPctStr = row['sgst_pct'] || row['SGST %'] || row['SGST Pct'] || row['SGST'] || '';
  const igstPctStr = row['igst_pct'] || row['IGST %'] || row['IGST Pct'] || row['IGST'] || '';
  // Additional charge (transport, loading, etc.) — optional, with its own tax rates and a reason
  // string that becomes mandatory when the charge is > 0 (matches the manual entry form).
  const addChargeStr = row['additional_charge'] || row['Additional Charge'] || row['Additional charge'] || '';
  const addCgstPctStr = row['additional_charge_cgst_pct'] || row['Additional Charge CGST %'] || row['Add Charge CGST %'] || '';
  const addSgstPctStr = row['additional_charge_sgst_pct'] || row['Additional Charge SGST %'] || row['Add Charge SGST %'] || '';
  const addIgstPctStr = row['additional_charge_igst_pct'] || row['Additional Charge IGST %'] || row['Add Charge IGST %'] || '';
  const addReasonStr = row['additional_charge_reason'] || row['Additional Charge Reason'] || row['Add Charge Reason'] || '';
  const remarks = row['remarks'] || row['Remarks'] || '';
  const paymentStatus = row['payment_status'] || row['Payment Status'] || row['Status'] || 'Not Paid';
  const paidAmountStr = row['paid_amount'] || row['Paid Amount'] || row['Amount Paid'] || '';
  const paymentType = row['payment_type'] || row['Payment Type'] || row['Pay Type'] || '';
  const paymentRef = row['payment_details'] || row['Payment Details'] || row['Cheque No'] || row['Txn ID'] || '';
  const paymentDateRaw = row['payment_date'] || row['Payment Date'] || '';
  const paymentBank = row['bank'] || row['Bank'] || '';
  const paymentMonthRaw = row['payment_month'] || row['Payment Month'] || '';

  // Skip completely empty rows
  if (!vendorName && !invoiceNo && !site && !amountStr.replace(/[₹,\s0]/g, '')) {
    return { skip: true, reason: 'empty row' };
  }

  // Invoice number is mandatory at the data-entry boundary — every entry must
  // carry a vendor-supplied number. Matches the schema rule in
  // invoice.controller.ts createInvoiceSchema and the client-side form check.
  if (!invoiceNo.trim()) {
    return { skip: true, reason: 'missing Invoice no — every row must have a vendor invoice number' };
  }

  // M4: reject negative or non-numeric amounts
  const amountRaw = parseFloat(amountStr.replace(/[₹,\s]/g, '') || '0');
  if (isNaN(amountRaw) || amountRaw < 0) {
    return { skip: true, reason: `invalid amount "${amountStr}"` };
  }

  // Tax split: use the optional columns when present; otherwise default to
  // (base = total, all percentages = 0) so legacy templates keep working.
  const parsePct = (s: string): number => {
    if (!s) return 0;
    let cleaned = s.replace(/[%,\s]/g, '');
    if (!cleaned) return 0;
    let n = parseFloat(cleaned);
    if (!isFinite(n) || n < 0) return 0;
    // Tolerate "0.18" meaning 18% — same convention the source spreadsheet uses
    if (n > 0 && n < 1) n = n * 100;
    if (n > 100) n = 0;
    return Math.round(n * 100) / 100;
  };
  const baseAmount = baseAmountStr
    ? parseFloat(baseAmountStr.replace(/[₹,\s]/g, '') || '0')
    : amountRaw;
  const cgstPct = parsePct(cgstPctStr);
  const sgstPct = parsePct(sgstPctStr);
  const igstPct = parsePct(igstPctStr);

  const additionalCharge = addChargeStr
    ? Math.max(0, parseFloat(addChargeStr.replace(/[₹,\s]/g, '') || '0'))
    : 0;
  const additionalChargeCgstPct = parsePct(addCgstPctStr);
  const additionalChargeSgstPct = parsePct(addSgstPctStr);
  const additionalChargeIgstPct = parsePct(addIgstPctStr);
  const additionalChargeReason = addReasonStr.trim();

  // Reason is mandatory when an additional charge is present
  if (additionalCharge > 0 && !additionalChargeReason) {
    return { skip: true, reason: 'additional charge requires a reason' };
  }

  // If only the base + tax percentages were given (no Invoice amount), compute
  // the total. Otherwise trust the explicit Invoice amount column.
  const baseTotal = baseAmount * (1 + (cgstPct + sgstPct + igstPct) / 100);
  const addTotal = additionalCharge * (1 + (additionalChargeCgstPct + additionalChargeSgstPct + additionalChargeIgstPct) / 100);
  const computedTotal = +(baseTotal + addTotal).toFixed(2);
  const amount = amountRaw > 0
    ? amountRaw
    : computedTotal > 0 ? computedTotal : 0;

  const parsedInvoiceDate = parseDate(invoiceDate);
  const parsedMonth = parseMonthColumn(month);
  const today = new Date().toISOString().split('T')[0];
  const monthDate = parsedMonth || (parsedInvoiceDate ? `${parsedInvoiceDate.slice(0, 7)}-01` : today);

  const parsedPaymentDate = parseDate(paymentDateRaw);
  const parsedPaymentMonth = parseMonthColumn(paymentMonthRaw);

  // Paid Amount lets a Partial row carry how much was actually paid; for Paid
  // rows it's optional and defaults to the full invoice amount.
  const normalizedStatus = paymentStatus.trim().toLowerCase();
  let paidAmount = 0;
  if (paidAmountStr) {
    paidAmount = parseFloat(paidAmountStr.replace(/[₹,\s]/g, '') || '0');
    if (isNaN(paidAmount) || paidAmount < 0) {
      return { skip: true, reason: `invalid Paid Amount "${paidAmountStr}"` };
    }
  }
  if (normalizedStatus === 'paid') {
    if (paidAmount === 0) paidAmount = amount;
  } else if (normalizedStatus === 'partial') {
    if (paidAmount <= 0) {
      return { skip: true, reason: 'Partial payment requires a Paid Amount > 0' };
    }
    if (paidAmount >= amount) {
      return { skip: true, reason: `Paid Amount ${paidAmount} is >= invoice amount ${amount} — set Payment Status to "Paid" instead of "Partial"` };
    }
  }

  // Validate payment metadata for Paid/Partial rows. Previously a missing or
  // unparseable Payment Date silently inherited the invoice_date, and a
  // missing Payment Type was silently stored as the literal string "Import".
  // Both produced data that looked plausible in reports but was wrong, so we
  // now reject these rows up-front in the preview rather than coercing them.
  const ALLOWED_PAYMENT_TYPES = ['Cash', 'Cheque', 'NEFT', 'RTGS', 'IMPS', 'UPI'];
  let normalizedPaymentType = paymentType.trim();
  if (normalizedStatus === 'paid' || normalizedStatus === 'partial') {
    if (!paymentDateRaw.trim()) {
      return { skip: true, reason: `${paymentStatus} row is missing Payment Date` };
    }
    if (!parsedPaymentDate) {
      return { skip: true, reason: `unparseable Payment Date "${paymentDateRaw}"` };
    }
    if (!normalizedPaymentType) {
      return { skip: true, reason: `${paymentStatus} row is missing Payment Type (Cash/Cheque/NEFT/RTGS/IMPS/UPI)` };
    }
    const matchedType = ALLOWED_PAYMENT_TYPES.find(t => t.toLowerCase() === normalizedPaymentType.toLowerCase());
    if (!matchedType) {
      return { skip: true, reason: `invalid Payment Type "${paymentType}" — expected one of ${ALLOWED_PAYMENT_TYPES.join(', ')}` };
    }
    normalizedPaymentType = matchedType;
    // Non-Cash payments need a reference (cheque no / UTR) so bank
    // reconciliation has something to match against.
    if (matchedType !== 'Cash' && !paymentRef.trim()) {
      return { skip: true, reason: `${matchedType} payment requires Payment Details (cheque no or UTR)` };
    }
    // Sanity: a payment can't have happened before the invoice it settles.
    // Earlier silent-fallback bugs sometimes put payment_date == invoice_date
    // or anchored to a 2001-01-01 sentinel — both of which were plausible-
    // looking but wrong. Reject any row that violates the basic temporal
    // ordering so the uploader sees the issue in preview.
    if (parsedInvoiceDate && parsedPaymentDate && parsedPaymentDate < parsedInvoiceDate) {
      return {
        skip: true,
        reason: `Payment Date ${parsedPaymentDate} is before Invoice date ${parsedInvoiceDate}`,
      };
    }
  }

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
    baseAmount,
    cgstPct,
    sgstPct,
    igstPct,
    additionalCharge,
    additionalChargeCgstPct,
    additionalChargeSgstPct,
    additionalChargeIgstPct,
    additionalChargeReason,
    remarks,
    paymentStatus,
    paidAmount,
    paymentType: normalizedPaymentType,
    paymentRef,
    paymentDate: parsedPaymentDate,
    paymentBank,
    paymentMonth: parsedPaymentMonth || (parsedPaymentDate ? `${parsedPaymentDate.slice(0, 7)}-01` : monthDate),
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
      // Match by vendor_id (canonical) OR vendor_name (covers legacy rows
      // where the invoice was never linked to a master vendor).
      existing = await queryOne(
        `SELECT i.id, i.invoice_no, i.invoice_amount, i.invoice_date FROM invoices i
         LEFT JOIN vendors v ON v.id = i.vendor_id
         WHERE LOWER(TRIM(i.invoice_no)) = LOWER(TRIM($1))
           AND (LOWER(TRIM(v.name)) = LOWER(TRIM($2)) OR LOWER(TRIM(i.vendor_name)) = LOWER(TRIM($2)))
           AND i.deleted_at IS NULL
         LIMIT 1`,
        [r.invoiceNo, r.vendorName]
      );
    } else if (r.vendorName) {
      existing = await queryOne(
        `SELECT i.id, i.invoice_no, i.invoice_amount, i.invoice_date FROM invoices i
         LEFT JOIN vendors v ON v.id = i.vendor_id
         WHERE i.invoice_no IS NULL
           AND (LOWER(TRIM(v.name)) = LOWER(TRIM($1)) OR LOWER(TRIM(i.vendor_name)) = LOWER(TRIM($1)))
           AND i.invoice_amount = $2 AND i.invoice_date = $3 AND i.deleted_at IS NULL
         LIMIT 1`,
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

    const { rows: records, headers } = parseFile(file.buffer, file.mimetype);
    if (records.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'File is empty' });
      return;
    }

    const headerReport = analyseHeaders(headers);
    // Hard-stop the upload if a core column is missing — without one of these
    // we can't produce a usable invoice. We do this even on preview so the
    // uploader sees the problem before staring at thousands of skipped rows.
    if (headerReport.missing_required.length > 0) {
      res.status(400).json({
        error: 'Bad Request',
        message: `File is missing required column(s): ${headerReport.missing_required.join(', ')}`,
        headers: headerReport,
      });
      return;
    }

    // Mode: preview (dry-run, detect dupes), commit (actually write)
    // Default = preview so accidental uploads don't clobber data.
    const mode = (req.body?.mode as string) || 'preview';

    // Optional site remap: { "Taranga Kukatpally": "Taranga", ... } sent on
    // commit so non-canonical CSV site labels can be rewritten to a real
    // project before insert. Preview surfaces the list of unknown sites so
    // the uploader can decide row-by-site whether to remap or keep as-is.
    let siteRemap: Record<string, string> = {};
    if (req.body?.siteRemap) {
      try {
        const parsed = typeof req.body.siteRemap === 'string'
          ? JSON.parse(req.body.siteRemap)
          : req.body.siteRemap;
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string' && isCanonicalSite(v)) {
              siteRemap[k.trim().toLowerCase()] = normaliseSiteName(v);
            }
          }
        }
      } catch {
        // Bad JSON → just ignore the remap, treat as no remap supplied.
      }
    }

    const callerRole = req.user!.role;
    const callerSites = (req.user!.sites && req.user!.sites.length > 0)
      ? req.user!.sites
      : (req.user!.site ? [req.user!.site] : []);

    // Phase 1: normalize all rows
    const normalized: NormalizedRow[] = [];
    const skippedRows: Array<{ row: number; reason: string }> = [];
    // Track non-canonical site labels found in the CSV so the preview UI can
    // prompt for a remap. Keyed by lowercased site name for dedup.
    const unknownSiteCounts = new Map<string, { name: string; rowCount: number }>();

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2; // header is row 1

      const norm = normalizeInvoiceRow(row, rowNum);
      if ('skip' in norm) {
        skippedRows.push({ row: rowNum, reason: norm.reason });
        continue;
      }

      // Apply user-supplied remap first (e.g. "Taranga Kukatpally" → "Taranga"),
      // so role validation and dupe detection see the corrected site.
      if (norm.site) {
        const remapped = siteRemap[norm.site.toLowerCase().trim()];
        if (remapped) norm.site = remapped;
      }

      // Tally unknown sites for the preview response. Skipped only when the
      // value is non-empty AND not in CANONICAL_SITES — blank sites are
      // surfaced as ordinary "skipped" rows below.
      if (norm.site && !isCanonicalSite(norm.site)) {
        const key = norm.site.toLowerCase().trim();
        const prev = unknownSiteCounts.get(key);
        if (prev) prev.rowCount++;
        else unknownSiteCounts.set(key, { name: norm.site, rowCount: 1 });
      }

      // Site accountants must specify a site that's in their assigned list.
      // For single-site accountants we transparently fall back to their one
      // site so blank-site rows still import; multi-site accountants must
      // pick explicitly so we don't silently misroute invoices.
      if (callerRole === 'site') {
        if (!norm.site) {
          if (callerSites.length === 1) {
            norm.site = callerSites[0];
          } else {
            skippedRows.push({ row: rowNum, reason: `Site Location is required — your sites: ${callerSites.join(', ')}` });
            continue;
          }
        } else if (!callerSites.includes(norm.site)) {
          skippedRows.push({ row: rowNum, reason: `site "${norm.site}" is not in your assigned sites (${callerSites.join(', ')})` });
          continue;
        }
      }

      normalized.push(norm);
    }

    const unknownSites = Array.from(unknownSiteCounts.values())
      .sort((a, b) => b.rowCount - a.rowCount);

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
        unknownSites,
        canonicalSites: CANONICAL_SITES,
        headers: headerReport,
      });
      return;
    }

    // Commit mode — write to DB. Duplicates (per-vendor invoice_no, or
    // vendor+amount+date when invoice_no is blank) are unconditionally
    // skipped — the strict business rule is that one vendor cannot have two
    // invoices with the same invoice number, and there is no override path.
    const batchId = randomUUID();
    let imported = 0;
    let vendorsCreated = 0;
    const errors: string[] = [];
    const skippedDuplicates: Array<{ row: number; invoiceNo: string; vendorName: string }> = [];

    for (const r of normalized) {
      try {
        if (duplicateRowNums.has(r.rowNum)) {
          skippedDuplicates.push({
            row: r.rowNum,
            invoiceNo: r.invoiceNo || '(no invoice no)',
            vendorName: r.vendorName,
          });
          continue;
        }

        // Look up or auto-create vendor — fetch category too so we can fall
        // back to it when the CSV row's Head/Category cell is empty.
        let vendor: { id: string; category: string | null } | null = r.vendorName
          ? await queryOne<{ id: string; category: string | null }>(
              'SELECT id, category FROM vendors WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))',
              [r.vendorName]
            )
          : null;

        if (!vendor && r.vendorName) {
          vendor = await queryOne<{ id: string; category: string | null }>(
            `INSERT INTO vendors (name, payment_terms, category, created_by, batch_id)
             VALUES (TRIM($1), 30, $2, $3, $4)
             ON CONFLICT (name) DO UPDATE SET name = vendors.name
             RETURNING id, category`,
            [r.vendorName, r.purpose || null, req.user!.id, batchId]
          );
          vendorsCreated++;
        }

        const invoicePurpose = r.purpose || vendor?.category || '';

        const seqResult = await queryOne<{ nextval: string }>("SELECT nextval('invoice_internal_seq')");
        const internalNo = `MKT-${String(seqResult!.nextval).padStart(5, '0')}`;

        const insertedInvoice = await queryOne<{ id: string }>(
          `INSERT INTO invoices (
            month, invoice_date, vendor_id, vendor_name, invoice_no, po_number,
            purpose, site, invoice_amount, base_amount, cgst_pct, sgst_pct, igst_pct,
            additional_charge, additional_charge_cgst_pct, additional_charge_sgst_pct,
            additional_charge_igst_pct, additional_charge_reason,
            payment_status, remarks, created_by, internal_no, batch_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                    $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
          RETURNING id`,
          [
            r.month,
            r.invoiceDate,
            vendor?.id ?? null,
            r.vendorName || '',
            r.invoiceNo || null,
            r.poNumber || null,
            invoicePurpose,
            r.site || '',
            r.amount,
            r.baseAmount > 0 ? r.baseAmount : r.amount,
            r.cgstPct,
            r.sgstPct,
            r.igstPct,
            r.additionalCharge,
            r.additionalChargeCgstPct,
            r.additionalChargeSgstPct,
            r.additionalChargeIgstPct,
            r.additionalChargeReason || null,
            r.paymentStatus,
            r.remarks || null,
            req.user!.id,
            internalNo,
            batchId,
          ]
        );

        // Per-invoice audit row so the invoice's Activity Log shows where
        // this row came from. The batch-level audit (logged once at the end
        // of the loop) has no invoice_id and therefore doesn't surface in
        // getInvoiceHistory's WHERE invoice_id = $1 filter.
        if (insertedInvoice) {
          await logAudit({
            userId: req.user!.id,
            action: `Imported via bulk batch ${batchId.slice(0, 8)} (row ${r.rowNum})`,
            invoiceId: insertedInvoice.id,
            metadata: {
              source: 'bulk-import',
              batch_id: batchId,
              source_row: r.rowNum,
              invoice_no: r.invoiceNo || null,
              amount: r.amount,
            },
          });
        }

        // Auto-create payment + bank transaction for Paid / Partial invoices.
        // For Paid: paidAmount defaults to invoice amount in the normalizer.
        // For Partial: paidAmount is the user-supplied part-payment.
        const status = r.paymentStatus.trim().toLowerCase();
        const hasPaymentToRecord = (status === 'paid' || status === 'partial') && r.paidAmount > 0;
        if (insertedInvoice && hasPaymentToRecord) {
          if (!r.paymentDate || !r.paymentType) {
            throw new Error('payment_date and payment_type are required for Paid/Partial rows');
          }

          // Insert the payment and link/create its bank_transaction through the
          // SAME canonical helper the interactive flow uses, inside ONE
          // transaction. This (a) fixes the old non-transactional bug where a
          // committed cheque row was orphaned if the payment insert failed, and
          // (b) uses the canonical cheque identity (txn_type, txn_ref, bank,
          // txn_date) + auto-tally so re-imports never spawn duplicate or
          // un-tallied bank rows. Ref is normalised so "Chq 000968" == "000968".
          // Capture as non-null locals (the guard above narrows them, but TS
          // widens object props back to string|null inside the closure).
          const payType: string = r.paymentType;
          const payDate: string = r.paymentDate;
          const normalizedRef = normalizeChequeRef(r.paymentRef);
          const invoiceId = insertedInvoice.id;
          await withTransaction(async (tx) => {
            const pay = await tx.queryOne<{ id: string }>(
              `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by, payment_month)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
              [
                invoiceId,
                r.paidAmount,
                payType,
                normalizedRef,
                payDate,
                r.paymentBank || null,
                req.user!.id,
                r.paymentMonth,
              ]
            );
            await syncBankTxnForPayment(tx, pay!.id, {
              payment_type: payType,
              payment_ref: normalizedRef,
              bank: r.paymentBank || null,
              payment_date: payDate,
              amount: r.paidAmount,
              recorded_by: req.user!.id,
            }, null);
          });

          // Recompute payment_status from sum(payments) + CN allocations so the
          // denormalized invoices.payment_status stays in sync with reality.
          // Without this, a CSV that lists paymentStatus='Partial' (or a value
          // that doesn't match the auto-created payment) leaves the row stuck
          // in the wrong state until something else triggers a recompute.
          await recomputeInvoiceStatus(insertedInvoice.id);
        }

        imported++;
      } catch (err) {
        errors.push(`Row ${r.rowNum}: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }

    await logAudit({
      userId: req.user!.id,
      action: `Bulk imported ${imported} invoices (${skippedDuplicates.length} duplicates skipped, ${skippedRows.length} other skipped)`,
      metadata: {
        batchId,
        type: 'invoices',
        imported,
        skippedDuplicates: skippedDuplicates.length,
        skipped: skippedRows.length,
      },
    });

    res.json({
      mode: 'commit',
      message: `Imported ${imported} invoice${imported === 1 ? '' : 's'}${vendorsCreated > 0 ? ` (auto-created ${vendorsCreated} vendors)` : ''}${skippedDuplicates.length > 0 ? `, skipped ${skippedDuplicates.length} duplicate${skippedDuplicates.length === 1 ? '' : 's'}` : ''}`,
      imported,
      total: records.length,
      batchId,
      skippedDuplicates,
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

    const { rows: records } = parseFile(file.buffer, file.mimetype);

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

    const { rows: records } = parseFile(file.buffer, file.mimetype);

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
        const site = normaliseSiteName(row['site'] || row['Site'] || row['Site Location'] || '');

        // Parse dates strictly — previously a missing or unparseable Payment
        // Date silently fell back to the invoice_date (and then to today),
        // which corrupted aging/cashflow for any row whose source spreadsheet
        // had a misaligned Payment Date column. We now reject those rows.
        const paymentDate = parseDate(rawPaymentDate);
        const invoiceDate = parseDate(rawInvoiceDate) || paymentDate;
        // Use the Month column as-is (accounting month), fall back to invoice_date month
        const parsedMonth = parseMonthColumn(rawMonth);
        const monthDate = parsedMonth
          || (invoiceDate ? `${invoiceDate.slice(0, 7)}-01` : null);

        // Skip completely empty rows
        if (!invoiceNo && !vendorName && !amountStr.replace(/[₹,\s0]/g, '')) {
          skipped++;
          continue;
        }

        // Invoice number is mandatory at the data-entry boundary; see the
        // matching check in normalizeInvoiceRow and createInvoiceSchema.
        if (!invoiceNo.trim()) {
          errors.push(`Row ${rowNum}: missing Invoice no — every row must have a vendor invoice number`);
          skipped++;
          continue;
        }

        const amount = parseFloat(String(amountStr).replace(/[₹,\s]/g, '') || '0');
        if (isNaN(amount) || amount <= 0) {
          skipped++;
          continue;
        }

        if (!invoiceDate || !monthDate) {
          errors.push(`Row ${rowNum}: could not parse Invoice date "${rawInvoiceDate}" or Payment Date "${rawPaymentDate}"`);
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

          // Per-invoice audit row so the Activity Log shows this came from
          // the payments importer (mirrors the per-invoice audit added to
          // the invoice importer; see importInvoices above).
          if (invoice) {
            await logAudit({
              userId: req.user!.id,
              action: `Imported via bulk payments batch ${batchId.slice(0, 8)} (row ${rowNum})`,
              invoiceId: invoice.id,
              metadata: {
                source: 'bulk-import-payments',
                batch_id: batchId,
                source_row: rowNum,
                invoice_no: invoiceNo || null,
                amount,
              },
            });
          }
        }

        if (!invoice) {
          errors.push(`Row ${rowNum}: could not find or create invoice`);
          skipped++;
          continue;
        }

        // Only insert a payment record if row has actual payment data
        if (hasPaymentData) {
          if (!paymentDate) {
            errors.push(`Row ${rowNum}: Payment Date is required and could not be parsed from "${rawPaymentDate}"`);
            skipped++;
            continue;
          }
          const ALLOWED_PAYMENT_TYPES = ['Cash', 'Cheque', 'NEFT', 'RTGS', 'IMPS', 'UPI'];
          const matchedType = paymentType
            ? ALLOWED_PAYMENT_TYPES.find(t => t.toLowerCase() === paymentType.trim().toLowerCase())
            : undefined;
          if (paymentType && !matchedType) {
            errors.push(`Row ${rowNum}: invalid Payment Type "${paymentType}" — expected one of ${ALLOWED_PAYMENT_TYPES.join(', ')}`);
            skipped++;
            continue;
          }
          if (!matchedType) {
            errors.push(`Row ${rowNum}: Payment Type is required (Cash/Cheque/NEFT/RTGS/IMPS/UPI)`);
            skipped++;
            continue;
          }

          const normalizedRef = normalizeChequeRef(paymentRef);

          // Duplicate payment check: same invoice, amount, date, and ref
          const existingPayment = await queryOne<{ id: string }>(
            `SELECT id FROM payments WHERE invoice_id = $1 AND amount = $2 AND payment_date = $3
             AND COALESCE(payment_ref, '') = COALESCE($4, '')`,
            [invoice.id, amount, paymentDate, normalizedRef]
          );
          if (existingPayment) {
            skipped++;
            continue;
          }

          // Insert the payment and link/create its cheque through the canonical
          // helper, in one transaction — so imported non-Cash payments show up
          // tallied on Bank Reconciliation instead of being invisible (this path
          // previously never created a bank_transactions row).
          await withTransaction(async (tx) => {
            const pay = await tx.queryOne<{ id: string }>(
              `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by, batch_id, payment_month)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
              [invoice.id, amount, matchedType, normalizedRef, paymentDate, bank || null, req.user!.id, batchId,
               parseMonthColumn(rawPaymentMonth) || `${paymentDate.slice(0, 7)}-01`]
            );
            await syncBankTxnForPayment(tx, pay!.id, {
              payment_type: matchedType,
              payment_ref: normalizedRef,
              bank: bank || null,
              payment_date: paymentDate,
              amount,
              recorded_by: req.user!.id,
            }, null);
          });

          // Recompute status (accounting for CN allocations)
          await recomputeInvoiceStatus(invoice.id);
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
      // Reset all invoice statuses — credit-note allocations may still be
      // outstanding, so recompute properly rather than blanket 'Not Paid'.
      await query(
        `UPDATE invoices SET payment_status = ${paymentStatusCase('invoices')}, updated_at = NOW()
         WHERE deleted_at IS NULL`
      );
      // All payments are gone — every bank_transactions row is now orphaned.
      await query('DELETE FROM bank_transactions');
      await logAudit({ userId: req.user!.id, action: `Cleared all ${count} payments` });
      res.json({ message: `Deleted ${count} payments and reset invoice statuses.`, deleted: count });
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
      content:
        // Mirrors every field on the manual entry form so a CSV can carry
        // base + GST + additional charge + reason + payment info in one row.
        // Paid Amount is mandatory for Partial rows so the importer knows how
        // much of the invoice has been settled; leave blank for Paid (defaults
        // to full invoice amount) and Not Paid.
        'Sl.No,Month,Invoice date,Vendor Name,Invoice no,PO Number,Head,Site Location,' +
        'Base Amount,CGST %,SGST %,IGST %,' +
        'Additional Charge,Additional Charge CGST %,Additional Charge SGST %,Additional Charge IGST %,Additional Charge Reason,' +
        'Invoice amount,' +
        'Payment Status,Paid Amount,Pending Days,Payment Type,Payment Details,Payment Date,Bank,Payment Month\n' +
        // Example 1: Not Paid — Paid Amount blank
        '1,2026-04-01,2026-04-01,Vendor Name,INV-001,PO-001,Steel,Nirvana,' +
        '100000,9,9,0,' +
        ',,,,,' +
        '118000,Not Paid,,,,,,,\n' +
        // Example 2: Fully Paid via cheque — Paid Amount blank means full
        '2,2026-04-01,2026-04-01,Vendor Name,INV-002,PO-002,Cement,Nirvana,' +
        '50000,9,9,0,' +
        '500,9,9,0,Transport,' +
        '59590,Paid,,0,Cheque,000856,2026-04-05,HDFC,Apr-2026\n' +
        // Example 3: Partial — must specify Paid Amount
        '3,2026-04-01,2026-04-01,Other Vendor,INV-003,PO-003,Cement,Nirvana,' +
        ',,,,' +
        ',,,,,' +
        '25000,Partial,10000,,NEFT,UTR123456,2026-04-10,ICICI,Apr-2026\n',
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

    // Count what will be deleted. Payments come from two import paths: the
    // payments-only importer stamps batch_id, but the invoice importer creates
    // payments tied to the batch's invoices via invoice_id and leaves batch_id
    // NULL — count both, or the audit/response under-reports (it logged
    // "0 payments" while silently orphaning their bank_transactions).
    const paymentCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM payments
       WHERE batch_id = $1
          OR invoice_id IN (SELECT id FROM invoices WHERE batch_id = $1)`,
      [batchId]
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

    // Capture the invoice/bank-txn IDs that the to-be-deleted payments touch.
    // We need these BEFORE the DELETE so we can recompute their cached
    // payment_status (and prune orphaned bank_transactions) afterwards —
    // most importantly when payments from this batch were linked to
    // invoices from a DIFFERENT batch (e.g. a payments-only import targeting
    // existing invoices), which would otherwise stay stuck on a stale status.
    const affectedRows = await query<{ invoice_id: string; bank_txn_id: string | null }>(
      `SELECT DISTINCT invoice_id, bank_txn_id FROM payments
       WHERE batch_id = $1
          OR invoice_id IN (SELECT id FROM invoices WHERE batch_id = $1)`,
      [batchId]
    );
    const affectedInvoiceIds = Array.from(new Set(affectedRows.map(r => r.invoice_id)));
    const affectedBankTxnIds = Array.from(new Set(affectedRows.map(r => r.bank_txn_id).filter((v): v is string => v !== null)));

    // Delete in order: payments → attachments → invoices → vendors.
    // Cover both payment sources (batch_id OR linked to a batch invoice) so the
    // bank_transactions prune below sees them gone and can drop the now-orphaned
    // cheque/NEFT rows the import created.
    await query(
      `DELETE FROM payments
       WHERE batch_id = $1
          OR invoice_id IN (SELECT id FROM invoices WHERE batch_id = $1)`,
      [batchId]
    );
    await query('DELETE FROM attachments WHERE invoice_id IN (SELECT id FROM invoices WHERE batch_id = $1)', [batchId]);
    await query('DELETE FROM invoices WHERE batch_id = $1', [batchId]);
    await query('DELETE FROM vendors WHERE batch_id = $1', [batchId]);

    // Recompute payment_status only on invoices that (a) had a payment from
    // this batch and (b) still exist (weren't deleted with the batch).
    if (affectedInvoiceIds.length > 0) {
      await query(
        `UPDATE invoices SET payment_status = ${paymentStatusCase('invoices')}, updated_at = NOW()
         WHERE id = ANY($1) AND deleted_at IS NULL`,
        [affectedInvoiceIds]
      );
    }

    // Prune bank_transactions that now have zero linked payments — they were
    // created by the import path and no longer reflect a real cheque/NEFT.
    if (affectedBankTxnIds.length > 0) {
      await query(
        `DELETE FROM bank_transactions
         WHERE id = ANY($1)
           AND NOT EXISTS (SELECT 1 FROM payments WHERE bank_txn_id = bank_transactions.id)`,
        [affectedBankTxnIds]
      );

      // Re-sum any affected cheque that survived the prune (it still has
      // payments from another batch). The importer's "reuse existing cheque"
      // path inflated txn_amount by this batch's paidAmount; undo it so the
      // tally invariant (txn_amount == Σ linked payments) holds.
      await query(
        `UPDATE bank_transactions bt
         SET txn_amount = s.total
         FROM (SELECT bank_txn_id AS id, SUM(amount) AS total
               FROM payments WHERE bank_txn_id = ANY($1) GROUP BY bank_txn_id) s
         WHERE bt.id = s.id`,
        [affectedBankTxnIds]
      );
    }

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
