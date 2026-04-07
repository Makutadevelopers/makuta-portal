// export.controller.ts
// GET /api/export/aging     — PDF of payment aging report
// GET /api/export/invoices  — PDF of invoice list
// GET /api/export/cashflow  — PDF of cashflow/expenditure

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
    res.setHeader('Content-Disposition', `attachment; filename="payment-aging-${site}.pdf"`);
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
    const invoices = await query<InvoiceRow>('SELECT * FROM invoices ORDER BY invoice_date DESC');

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
