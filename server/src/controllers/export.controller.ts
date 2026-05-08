// export.controller.ts
// GET /api/export/aging         — PDF of payment aging report
// GET /api/export/invoices      — PDF of invoice list
// GET /api/export/invoices.csv  — CSV of full invoice ledger (HO/admin cross-verify)
// GET /api/export/cashflow      — PDF of cashflow/expenditure

import { Request, Response, NextFunction } from 'express';
import PDFDocument from 'pdfkit';
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

interface InvoiceRow {
  sl_no: number;
  invoice_date: string;
  vendor_name: string;
  invoice_no: string;
  purpose: string;
  site: string;
  invoice_amount: number;
  payment_status: string;
}

export async function exportInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoices = await query<InvoiceRow>('SELECT * FROM invoices WHERE deleted_at IS NULL ORDER BY invoice_date DESC');

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="invoice-list.pdf"');
    doc.pipe(res);

    doc.fontSize(16).font('Helvetica-Bold').text('Invoice List', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text(`Makuta Developers · ${fmtDate(new Date().toISOString())} · ${invoices.length} invoices`, { align: 'center' });
    doc.moveDown(1.5);

    const cols = [
      { label: '#', width: 25 },
      { label: 'Date', width: 65 },
      { label: 'Vendor', width: 160 },
      { label: 'Invoice No', width: 75 },
      { label: 'Category', width: 80 },
      { label: 'Site', width: 90 },
      { label: 'Amount', width: 85 },
      { label: 'Status', width: 60 },
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

    doc.font('Helvetica').fontSize(7);
    for (const inv of invoices) {
      if (y > 540) { doc.addPage(); y = 40; }
      x = 40;
      const vals = [
        String(inv.sl_no),
        fmtDate(inv.invoice_date),
        inv.vendor_name.slice(0, 30),
        inv.invoice_no,
        inv.purpose,
        inv.site,
        formatINR(Number(inv.invoice_amount)),
        inv.payment_status,
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

interface InvoiceCsvRow {
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

export async function exportInvoicesCsv(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await query<InvoiceCsvRow>(
      `SELECT
         i.sl_no,
         TO_CHAR(i.invoice_date, 'YYYY-MM-DD')          AS invoice_date,
         TO_CHAR(i.month, 'YYYY-MM')                    AS month,
         i.vendor_name,
         i.invoice_no,
         i.po_number,
         i.purpose,
         i.site,
         COALESCE(i.taxable_amount, 0)                  AS taxable_amount,
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
         SELECT invoice_id, SUM(amount) AS total_paid
         FROM payments
         GROUP BY invoice_id
       ) p ON p.invoice_id = i.id
       LEFT JOIN users u ON u.id = i.created_by
       WHERE i.deleted_at IS NULL
       ORDER BY i.invoice_date DESC, i.sl_no DESC`
    );

    const headers = [
      'Sl No', 'Invoice Date', 'Accounting Month', 'Vendor', 'Invoice No', 'PO/WO No',
      'Category', 'Site', 'Taxable Amount', 'CGST %', 'SGST %', 'IGST %',
      'Additional Charge', 'Invoice Amount', 'Total Paid', 'Balance',
      'Payment Status', 'Finalized', 'Remarks', 'Disputed', 'Dispute Severity',
      'Dispute Reason', 'Created At', 'Pushed At', 'Created By',
    ];

    const lines: string[] = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        r.sl_no, r.invoice_date, r.month, r.vendor_name, r.invoice_no, r.po_number,
        r.purpose, r.site, r.taxable_amount, r.cgst_pct, r.sgst_pct, r.igst_pct,
        r.additional_charge, r.invoice_amount, r.total_paid, r.balance,
        r.payment_status, r.pushed ? 'Master' : 'Draft', r.remarks,
        r.disputed ? 'Yes' : 'No', r.dispute_severity, r.dispute_reason,
        r.created_at, r.pushed_at, r.created_by_email,
      ].map(csvCell).join(','));
    }

    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="invoices-${today}.csv"`);
    res.send('﻿' + lines.join('\n'));
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
