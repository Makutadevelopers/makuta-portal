// export.controller.ts
// GET /api/export/aging                          — PDF of payment aging report
// GET /api/export/invoices?format=pdf|csv|xlsx   — invoice ledger export, respects filters
// GET /api/export/cashflow                       — PDF of cashflow/expenditure

import { Request, Response, NextFunction } from 'express';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import { getAgingData } from '../services/aging.service';
import { query } from '../db/query';

function formatINR(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN');
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export async function exportAging(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const site = (req.query.site as string) || 'All';
    const data = await getAgingData(site);
    const allRows = [...data.overdue, ...data.withinTerms];

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    const safeSite = site.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="payment-aging-${safeSite}.pdf"`);
    doc.pipe(res);

    // Title
    doc.fontSize(16).font('Helvetica-Bold').text('Payment Aging Report', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text(`Makuta Developers · ${site === 'All' ? 'All Sites' : site} · ${fmtDate(new Date().toISOString())}`, { align: 'center' });
    doc.moveDown(1.5);

    // Summary
    const totalOutstanding = allRows.reduce((s, r) => s + Number(r.balance), 0);
    const overdueTotal = data.overdue.reduce((s, r) => s + Number(r.balance), 0);
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text(`Total Outstanding: ${formatINR(totalOutstanding)}     Overdue: ${formatINR(overdueTotal)}     Within Terms: ${formatINR(totalOutstanding - overdueTotal)}`);
    doc.moveDown();

    // Table header
    const cols = [
      { label: 'Vendor', width: 140 },
      { label: 'Site', width: 70 },
      { label: 'Invoice', width: 65 },
      { label: 'Inv Date', width: 65 },
      { label: 'Terms', width: 35 },
      { label: 'Due Date', width: 65 },
      { label: 'Days', width: 40 },
      { label: 'Amount', width: 75 },
      { label: 'Balance', width: 75 },
      { label: 'Status', width: 50 },
    ];

    let y = doc.y;
    doc.fontSize(8).font('Helvetica-Bold');
    let x = 40;
    for (const col of cols) {
      doc.text(col.label, x, y, { width: col.width });
      x += col.width;
    }
    y += 14;
    doc.moveTo(40, y).lineTo(760, y).stroke();
    y += 4;

    // Rows
    doc.font('Helvetica').fontSize(7);
    for (const row of allRows) {
      if (y > 540) {
        doc.addPage();
        y = 40;
      }
      x = 40;
      const vals = [
        row.vendor_name.slice(0, 25),
        row.site,
        row.invoice_no,
        fmtDate(row.invoice_date),
        `${row.payment_terms}d`,
        fmtDate(row.due_date),
        row.overdue ? `${row.days_past_due}d OD` : `${row.days_left}d`,
        formatINR(Number(row.invoice_amount)),
        formatINR(Number(row.balance)),
        row.overdue ? 'OVERDUE' : 'OK',
      ];
      for (let i = 0; i < cols.length; i++) {
        doc.text(vals[i], x, y, { width: cols[i].width });
        x += cols[i].width;
      }
      y += 12;
    }

    doc.end();
  } catch (err) {
    next(err);
  }
}

interface InvoiceExportRow {
  sl_no: number;
  invoice_date: string;
  month: string;
  vendor_name: string;
  invoice_no: string;
  po_number: string | null;
  purpose: string;
  site: string;
  taxable_amount: string;
  cgst_pct: string;
  sgst_pct: string;
  igst_pct: string;
  additional_charge: string;
  invoice_amount: string;
  total_paid: string;
  balance: string;
  payment_status: string;
  pushed: boolean;
  remarks: string | null;
  disputed: boolean | null;
  dispute_severity: string | null;
  dispute_reason: string | null;
  created_at: string;
  pushed_at: string | null;
  created_by_email: string | null;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const EXPORT_HEADERS = [
  'Sl No', 'Invoice Date', 'Accounting Month', 'Vendor', 'Invoice No', 'PO/WO No',
  'Category', 'Site', 'Taxable Amount', 'CGST %', 'SGST %', 'IGST %',
  'Additional Charge', 'Invoice Amount', 'Total Paid', 'Balance',
  'Payment Status', 'Finalized', 'Remarks', 'Disputed', 'Dispute Severity',
  'Dispute Reason', 'Created At', 'Pushed At', 'Created By',
];

function rowToValues(r: InvoiceExportRow): unknown[] {
  return [
    r.sl_no, r.invoice_date, r.month, r.vendor_name, r.invoice_no, r.po_number,
    r.purpose, r.site, r.taxable_amount, r.cgst_pct, r.sgst_pct, r.igst_pct,
    r.additional_charge, r.invoice_amount, r.total_paid, r.balance,
    r.payment_status, r.pushed ? 'Master' : 'Draft', r.remarks,
    r.disputed ? 'Yes' : 'No', r.dispute_severity, r.dispute_reason,
    r.created_at, r.pushed_at, r.created_by_email,
  ];
}

interface FilterDescriptor {
  filters: string[];   // human-readable list, e.g. "Site: Nirvana"
  fileSuffix: string;  // appended to filename when filters are active
}

async function fetchFilteredInvoiceRows(req: Request): Promise<{ rows: InvoiceExportRow[]; describe: FilterDescriptor }> {
  // When the client passes ?ids=uuid1,uuid2,... we export ONLY those rows
  // (used when the user has ticked specific rows in the table). We still
  // keep deleted_at IS NULL for safety. Filter params are otherwise ignored
  // when ids is present — the selection is the authoritative scope.
  const idsRaw = (req.query.ids as string) || '';
  const ids = idsRaw
    .split(',')
    .map(s => s.trim())
    .filter(s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s));

  const site = (req.query.site as string) || 'All';
  const status = (req.query.status as string) || 'All';
  const category = (req.query.category as string) || 'All';
  const search = (req.query.search as string) || '';
  const month = (req.query.month as string) || '';     // YYYY-MM
  const from = (req.query.from as string) || '';        // YYYY-MM-DD
  const to = (req.query.to as string) || '';            // YYYY-MM-DD
  const sortRaw = (req.query.sort as string) || 'created_at';
  const sortBy: 'invoice_date' | 'created_at' | 'last_paid_date' =
    sortRaw === 'invoice_date' ? 'invoice_date'
    : sortRaw === 'last_paid_date' ? 'last_paid_date'
    : 'created_at';

  const conds: string[] = ['i.deleted_at IS NULL'];
  const params: unknown[] = [];
  let p = 1;
  if (ids.length > 0) {
    conds.push(`i.id = ANY($${p++}::uuid[])`);
    params.push(ids);
  } else {
    if (site !== 'All')     { conds.push(`i.site = $${p++}`);            params.push(site); }
    if (status !== 'All')   { conds.push(`i.payment_status = $${p++}`);  params.push(status); }
    if (category !== 'All') { conds.push(`i.purpose = $${p++}`);         params.push(category); }
    if (month)              { conds.push(`TO_CHAR(i.month, 'YYYY-MM') = $${p++}`); params.push(month); }
    if (from)               { conds.push(`i.invoice_date >= $${p++}`);   params.push(from); }
    if (to)                 { conds.push(`i.invoice_date <= $${p++}`);   params.push(to); }
    if (search) {
      conds.push(`(LOWER(i.vendor_name) LIKE $${p} OR LOWER(i.invoice_no) LIKE $${p} OR LOWER(COALESCE(i.po_number, '')) LIKE $${p})`);
      params.push(`%${search.toLowerCase()}%`);
      p++;
    }
  }

  const orderBy =
    sortBy === 'invoice_date' ? 'i.invoice_date DESC, i.sl_no DESC'
    : sortBy === 'last_paid_date' ? 'p.last_paid_date DESC NULLS LAST, i.created_at DESC'
    : 'i.created_at DESC';

  const rows = await query<InvoiceExportRow>(
    `SELECT
       i.sl_no,
       TO_CHAR(i.invoice_date, 'YYYY-MM-DD')          AS invoice_date,
       TO_CHAR(i.month, 'YYYY-MM')                    AS month,
       i.vendor_name,
       i.invoice_no,
       i.po_number,
       i.purpose,
       i.site,
       COALESCE(i.base_amount, i.invoice_amount, 0)   AS taxable_amount,
       COALESCE(i.cgst_pct, 0)                        AS cgst_pct,
       COALESCE(i.sgst_pct, 0)                        AS sgst_pct,
       COALESCE(i.igst_pct, 0)                        AS igst_pct,
       COALESCE(i.additional_charge, 0)               AS additional_charge,
       i.invoice_amount,
       COALESCE(p.total_paid, 0)                      AS total_paid,
       (i.invoice_amount - COALESCE(p.total_paid, 0)) AS balance,
       i.payment_status,
       i.pushed,
       i.remarks,
       i.disputed,
       i.dispute_severity,
       i.dispute_reason,
       TO_CHAR(i.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
       TO_CHAR(i.pushed_at, 'YYYY-MM-DD"T"HH24:MI:SS')  AS pushed_at,
       u.email                                        AS created_by_email
     FROM invoices i
     LEFT JOIN (
       SELECT invoice_id,
              SUM(amount + tds_amount) AS total_paid,
              MAX(payment_date)        AS last_paid_date
       FROM payments
       GROUP BY invoice_id
     ) p ON p.invoice_id = i.id
     LEFT JOIN users u ON u.id = i.created_by
     WHERE ${conds.join(' AND ')}
     ORDER BY ${orderBy}`,
    params
  );

  const labels: string[] = [];
  const slug: string[] = [];
  if (ids.length > 0) {
    labels.push(`Selected: ${ids.length} invoice${ids.length === 1 ? '' : 's'}`);
    slug.push(`selected-${ids.length}`);
  } else {
    if (site !== 'All')     { labels.push(`Site: ${site}`);         slug.push(site.replace(/[^a-zA-Z0-9]+/g, '_')); }
    if (status !== 'All')   { labels.push(`Status: ${status}`);     slug.push(status.replace(/\s+/g, '')); }
    if (category !== 'All') { labels.push(`Category: ${category}`); slug.push(category.replace(/[^a-zA-Z0-9]+/g, '_')); }
    if (month)              { labels.push(`Month: ${month}`);       slug.push(month); }
    if (from || to)         { labels.push(`Range: ${from || '…'} → ${to || '…'}`); slug.push(`${from || ''}_${to || ''}`); }
    if (search)             { labels.push(`Search: ${search}`); }
  }
  const fileSuffix = slug.length > 0 ? `-${slug.join('-')}` : '';
  return { rows, describe: { filters: labels, fileSuffix } };
}

function sendInvoicesCsv(rows: InvoiceExportRow[], filenameBase: string, res: Response) {
  const lines: string[] = [EXPORT_HEADERS.join(',')];
  for (const r of rows) {
    lines.push(rowToValues(r).map(csvCell).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
  res.send('﻿' + lines.join('\n'));
}

function sendInvoicesXlsx(rows: InvoiceExportRow[], filenameBase: string, res: Response) {
  const aoa: unknown[][] = [EXPORT_HEADERS, ...rows.map(rowToValues)];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  // Reasonable default column widths
  sheet['!cols'] = EXPORT_HEADERS.map((h, i) => {
    const max = Math.max(
      h.length,
      ...rows.slice(0, 200).map(r => String(rowToValues(r)[i] ?? '').length)
    );
    return { wch: Math.min(40, Math.max(8, max + 2)) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Invoices');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
  res.send(buf);
}

function sendInvoicesPdf(rows: InvoiceExportRow[], describe: FilterDescriptor, filenameBase: string, res: Response) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`);
  doc.pipe(res);

  doc.fontSize(16).font('Helvetica-Bold').text('Invoice List', { align: 'center' });
  doc.fontSize(10).font('Helvetica').text(`Makuta Developers · ${fmtDate(new Date().toISOString())} · ${rows.length} invoice${rows.length === 1 ? '' : 's'}`, { align: 'center' });
  if (describe.filters.length > 0) {
    doc.fontSize(8).fillColor('#555').text(`Filters: ${describe.filters.join('  ·  ')}`, { align: 'center' });
    doc.fillColor('black');
  }
  doc.moveDown(1.2);

  const cols = [
    { label: '#',          width: 22 },
    { label: 'Date',       width: 60 },
    { label: 'Vendor',     width: 130 },
    { label: 'Invoice No', width: 70 },
    { label: 'PO/WO',      width: 70 },
    { label: 'Category',   width: 70 },
    { label: 'Site',       width: 70 },
    { label: 'Amount',     width: 70 },
    { label: 'Paid',       width: 60 },
    { label: 'Balance',    width: 65 },
    { label: 'Status',     width: 55 },
  ];

  let y = doc.y;
  doc.fontSize(8).font('Helvetica-Bold');
  let x = 40;
  for (const col of cols) {
    doc.text(col.label, x, y, { width: col.width });
    x += col.width;
  }
  y += 14;
  doc.moveTo(40, y).lineTo(800, y).stroke();
  y += 4;

  doc.font('Helvetica').fontSize(7);
  for (const r of rows) {
    if (y > 540) { doc.addPage(); y = 40; }
    x = 40;
    const vals = [
      String(r.sl_no),
      fmtDate(r.invoice_date),
      r.vendor_name.slice(0, 26),
      r.invoice_no,
      (r.po_number || '').slice(0, 14),
      r.purpose,
      r.site,
      formatINR(Number(r.invoice_amount)),
      formatINR(Number(r.total_paid)),
      formatINR(Number(r.balance)),
      r.payment_status,
    ];
    for (let i = 0; i < cols.length; i++) {
      doc.text(vals[i], x, y, { width: cols[i].width });
      x += cols[i].width;
    }
    y += 12;
  }

  doc.end();
}

export async function exportInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const formatRaw = (req.query.format as string || '').toLowerCase();
    const format: 'pdf' | 'csv' | 'xlsx' = formatRaw === 'csv' || formatRaw === 'xlsx' ? formatRaw : 'pdf';
    const { rows, describe } = await fetchFilteredInvoiceRows(req);
    const today = new Date().toISOString().slice(0, 10);
    const filenameBase = `invoices-${today}${describe.fileSuffix}`;

    if (format === 'csv')  return sendInvoicesCsv(rows, filenameBase, res);
    if (format === 'xlsx') return sendInvoicesXlsx(rows, filenameBase, res);
    return sendInvoicesPdf(rows, describe, filenameBase, res);
  } catch (err) {
    next(err);
  }
}

interface CashflowRow {
  month: string;
  purpose: string;
  total_invoiced: number;
  total_paid: number;
  invoice_count: number;
}

export async function exportCashflow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await query<CashflowRow>(
      `SELECT TO_CHAR(i.month, 'YYYY-MM') AS month, i.purpose,
         SUM(i.invoice_amount) AS total_invoiced,
         COALESCE(SUM(p.total_paid), 0) AS total_paid,
         COUNT(i.id)::INT AS invoice_count
       FROM invoices i
       LEFT JOIN (SELECT invoice_id, SUM(amount) AS total_paid FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
       WHERE i.deleted_at IS NULL
       GROUP BY TO_CHAR(i.month, 'YYYY-MM'), i.purpose
       ORDER BY month, i.purpose`
    );

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="cashflow-expenditure.pdf"');
    doc.pipe(res);

    doc.fontSize(16).font('Helvetica-Bold').text('Cashflow & Expenditure Report', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text(`Makuta Developers · ${fmtDate(new Date().toISOString())}`, { align: 'center' });
    doc.moveDown(1.5);

    const cols = [
      { label: 'Month', width: 80 },
      { label: 'Category', width: 150 },
      { label: 'Invoiced', width: 100 },
      { label: 'Paid', width: 100 },
      { label: 'Outstanding', width: 100 },
      { label: 'Invoices', width: 60 },
    ];

    let y = doc.y;
    doc.fontSize(8).font('Helvetica-Bold');
    let x = 40;
    for (const col of cols) {
      doc.text(col.label, x, y, { width: col.width });
      x += col.width;
    }
    y += 14;
    doc.moveTo(40, y).lineTo(680, y).stroke();
    y += 4;

    doc.font('Helvetica').fontSize(7);
    for (const r of rows) {
      if (y > 540) { doc.addPage(); y = 40; }
      x = 40;
      const vals = [
        r.month,
        r.purpose,
        formatINR(Number(r.total_invoiced)),
        formatINR(Number(r.total_paid)),
        formatINR(Number(r.total_invoiced) - Number(r.total_paid)),
        String(r.invoice_count),
      ];
      for (let i = 0; i < cols.length; i++) {
        doc.text(vals[i], x, y, { width: cols[i].width });
        x += cols[i].width;
      }
      y += 12;
    }

    doc.end();
  } catch (err) {
    next(err);
  }
}
