// tableExports.controller.ts
// Generic /export/* endpoints built on services/exportTable.ts. Each handler
// fetches the (role-scoped / filtered) rows for one table, defines a column
// spec, and hands both to sendTableExport for CSV / XLSX / PDF rendering.
//
// Mounted under /api/export, which is already restricted to ho + mgmt.

import { Request, Response, NextFunction } from 'express';
import { query } from '../db/query';
import { sendTableExport, ExportColumn } from '../services/exportTable';

function parseFormat(req: Request): 'csv' | 'xlsx' | 'pdf' {
  const f = String(req.query.format || '').toLowerCase();
  return f === 'csv' || f === 'xlsx' ? f : 'pdf';
}

const today = () => new Date().toISOString().slice(0, 10);

// ── Credit Notes ──────────────────────────────────────────────────────────────
interface CreditNoteExportRow {
  cn_no: string;
  cn_date: string;
  vendor_name: string;
  site: string;
  base_amount: string;
  cgst_pct: string;
  sgst_pct: string;
  igst_pct: string;
  total_amount: string;
  allocated: string;
  remarks: string | null;
  created_at: string;
}

export async function exportCreditNotes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await query<CreditNoteExportRow>(
      `SELECT cn.cn_no,
              TO_CHAR(cn.cn_date, 'YYYY-MM-DD') AS cn_date,
              cn.vendor_name, cn.site,
              cn.base_amount::text, cn.cgst_pct::text, cn.sgst_pct::text, cn.igst_pct::text,
              cn.total_amount::text,
              COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE credit_note_id = cn.id), 0)::text AS allocated,
              cn.remarks,
              TO_CHAR(cn.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at
         FROM credit_notes cn
        WHERE cn.deleted_at IS NULL
        ORDER BY cn.cn_date DESC, cn.created_at DESC`,
    );

    const columns: ExportColumn[] = [
      { header: 'CN No' },
      { header: 'CN Date', type: 'date' },
      { header: 'Vendor', pdfWidth: 150 },
      { header: 'Site' },
      { header: 'Base Amount', type: 'amount' },
      { header: 'CGST %', type: 'pct' },
      { header: 'SGST %', type: 'pct' },
      { header: 'IGST %', type: 'pct' },
      { header: 'Total Amount', type: 'amount' },
      { header: 'Allocated', type: 'amount' },
      { header: 'Unallocated', type: 'amount' },
      { header: 'Remarks', pdfWidth: 120 },
      { header: 'Created At', type: 'datetime' },
    ];

    const data = rows.map(r => [
      r.cn_no, r.cn_date, r.vendor_name, r.site,
      r.base_amount, r.cgst_pct, r.sgst_pct, r.igst_pct,
      r.total_amount, r.allocated,
      (Number(r.total_amount) - Number(r.allocated)).toFixed(2),
      r.remarks, r.created_at,
    ]);

    sendTableExport(res, {
      format: parseFormat(req),
      filenameBase: `credit-notes-${today()}`,
      title: 'Credit Notes',
      columns,
      rows: data,
    });
  } catch (err) {
    next(err);
  }
}

// Per-invoice outstanding = invoice_amount − (payments.amount + tds) − credit allocations,
// floored at 0 — matches the balance the app shows everywhere.
const BALANCE_EXPR = `GREATEST(
  i.invoice_amount
    - COALESCE((SELECT SUM(amount + tds_amount) FROM payments WHERE invoice_id = i.id), 0)
    - COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE invoice_id = i.id), 0),
  0)`;

// ── Vendor Master ─────────────────────────────────────────────────────────────
interface VendorExportRow {
  name: string; category: string | null; payment_terms: number;
  gstin: string | null; phone: string | null; email: string | null;
  invoice_count: string; outstanding: string;
}

export async function exportVendors(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const params: unknown[] = [];
    let where = '';
    if (search) { params.push(`%${search}%`); where = `WHERE LOWER(v.name) LIKE $1`; }

    const rows = await query<VendorExportRow>(
      `SELECT v.name, v.category, v.payment_terms, v.gstin, v.phone, v.email,
              COUNT(i.id)::text AS invoice_count,
              COALESCE(SUM(${BALANCE_EXPR}), 0)::text AS outstanding
         FROM vendors v
         LEFT JOIN invoices i ON i.vendor_id = v.id AND i.deleted_at IS NULL
         ${where}
        GROUP BY v.id, v.name, v.category, v.payment_terms, v.gstin, v.phone, v.email
        ORDER BY v.name`,
      params,
    );

    const columns: ExportColumn[] = [
      { header: 'Vendor', pdfWidth: 160 },
      { header: 'Category' },
      { header: 'Payment Terms (days)', type: 'int' },
      { header: 'GSTIN' },
      { header: 'Phone' },
      { header: 'Email', pdfWidth: 130 },
      { header: 'Invoices', type: 'int' },
      { header: 'Outstanding', type: 'amount' },
    ];
    const data = rows.map(r => [
      r.name, r.category, r.payment_terms, r.gstin, r.phone, r.email, r.invoice_count, r.outstanding,
    ]);
    sendTableExport(res, {
      format: parseFormat(req), filenameBase: `vendors-${today()}`,
      title: 'Vendor Master', columns, rows: data,
      filters: search ? [`Search: ${search}`] : [],
    });
  } catch (err) { next(err); }
}

// ── Vendor Detail (one vendor's invoices, honouring the page filters) ──────────
interface VendorInvoiceExportRow {
  invoice_date: string; invoice_no: string | null; po_number: string | null;
  purpose: string | null; site: string; invoice_amount: string;
  total_paid: string; balance: string; payment_status: string; last_paid_date: string | null;
}

export async function exportVendorInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const vendorId = String(req.query.vendor_id || '');
    if (!vendorId) {
      res.status(400).json({ error: 'Bad Request', message: 'vendor_id is required' });
      return;
    }
    const status = String(req.query.status || 'All');
    const site = String(req.query.site || 'All');
    const order = String(req.query.order || 'All');     // PO | WO | All
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    const paidMonth = String(req.query.paid_month || '');

    const params: unknown[] = [vendorId];
    const clauses: string[] = ['i.vendor_id = $1', 'i.deleted_at IS NULL'];
    const filters: string[] = [];
    if (status !== 'All') { params.push(status); clauses.push(`i.payment_status = $${params.length}`); filters.push(`Status: ${status}`); }
    if (site !== 'All') { params.push(site); clauses.push(`i.site = $${params.length}`); filters.push(`Site: ${site}`); }
    if (order === 'PO') { clauses.push(`UPPER(COALESCE(i.po_number,'')) LIKE '%/PO/%'`); filters.push('Type: PO'); }
    if (order === 'WO') { clauses.push(`UPPER(COALESCE(i.po_number,'')) LIKE '%/WO/%'`); filters.push('Type: WO'); }
    if (from) { params.push(from); clauses.push(`i.invoice_date >= $${params.length}`); filters.push(`From: ${from}`); }
    if (to) { params.push(to); clauses.push(`i.invoice_date <= $${params.length}`); filters.push(`To: ${to}`); }
    if (paidMonth) {
      params.push(paidMonth);
      clauses.push(`TO_CHAR((SELECT MAX(payment_date) FROM payments WHERE invoice_id = i.id), 'YYYY-MM') = $${params.length}`);
      filters.push(`Paid month: ${paidMonth}`);
    }

    const rows = await query<VendorInvoiceExportRow>(
      `SELECT TO_CHAR(i.invoice_date, 'YYYY-MM-DD') AS invoice_date, i.invoice_no, i.po_number,
              i.purpose, i.site, i.invoice_amount::text,
              COALESCE((SELECT SUM(amount + tds_amount) FROM payments WHERE invoice_id = i.id), 0)::text AS total_paid,
              ${BALANCE_EXPR}::text AS balance,
              i.payment_status,
              TO_CHAR((SELECT MAX(payment_date) FROM payments WHERE invoice_id = i.id), 'YYYY-MM-DD') AS last_paid_date
         FROM invoices i
        WHERE ${clauses.join(' AND ')}
        ORDER BY i.invoice_date DESC, i.created_at DESC`,
      params,
    );

    const columns: ExportColumn[] = [
      { header: 'Invoice Date', type: 'date' },
      { header: 'Invoice No' },
      { header: 'PO/WO No' },
      { header: 'Category' },
      { header: 'Site' },
      { header: 'Invoice Amount', type: 'amount' },
      { header: 'Total Paid', type: 'amount' },
      { header: 'Balance', type: 'amount' },
      { header: 'Status' },
      { header: 'Last Paid', type: 'date' },
    ];
    const data = rows.map(r => [
      r.invoice_date, r.invoice_no, r.po_number, r.purpose, r.site,
      r.invoice_amount, r.total_paid, r.balance, r.payment_status, r.last_paid_date,
    ]);
    sendTableExport(res, {
      format: parseFormat(req), filenameBase: `vendor-invoices-${today()}`,
      title: 'Vendor Invoices', columns, rows: data, filters,
    });
  } catch (err) { next(err); }
}

// ── Audit Trail ───────────────────────────────────────────────────────────────
interface AuditExportRow {
  created_at: string; user_name: string | null; action: string;
  invoice_no: string | null; invoice_site: string | null; vendor_name: string | null;
}

export async function exportAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await query<AuditExportRow>(
      `SELECT TO_CHAR(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
              u.name AS user_name, a.action,
              i.invoice_no, i.site AS invoice_site, i.vendor_name
         FROM audit_logs a
         LEFT JOIN users u    ON u.id = a.user_id
         LEFT JOIN invoices i ON i.id = a.invoice_id
        ORDER BY a.created_at DESC
        LIMIT 5000`,
    );
    const columns: ExportColumn[] = [
      { header: 'When', type: 'datetime' },
      { header: 'User' },
      { header: 'Action', pdfWidth: 280 },
      { header: 'Invoice No' },
      { header: 'Site' },
      { header: 'Vendor', pdfWidth: 120 },
    ];
    const data = rows.map(r => [r.created_at, r.user_name, r.action, r.invoice_no, r.invoice_site, r.vendor_name]);
    sendTableExport(res, {
      format: parseFormat(req), filenameBase: `audit-trail-${today()}`,
      title: 'Audit Trail', columns, rows: data,
    });
  } catch (err) { next(err); }
}

// ── Petty Cash (combined ledger: disbursements in + expenses out) ──────────────
interface PettyCashExportRow {
  date: string; site: string; kind: string; amount: string; detail: string | null; remarks: string | null;
}

export async function exportPettyCash(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const site = String(req.query.site || 'All');
    const params: unknown[] = [];
    let siteClauseD = '', siteClauseE = '';
    const filters: string[] = [];
    if (site !== 'All') {
      params.push(site);
      siteClauseD = `AND d.site = $1`;
      siteClauseE = `AND e.site = $1`;
      filters.push(`Site: ${site}`);
    }
    const rows = await query<PettyCashExportRow>(
      `SELECT * FROM (
         SELECT TO_CHAR(d.given_on, 'YYYY-MM-DD') AS date, d.site, 'Float In' AS kind,
                d.amount::text AS amount, d.reference AS detail, d.remarks
           FROM petty_cash_disbursements d
          WHERE d.deleted_at IS NULL ${siteClauseD}
         UNION ALL
         SELECT TO_CHAR(e.spent_on, 'YYYY-MM-DD') AS date, e.site, 'Expense' AS kind,
                e.amount::text AS amount, e.purpose AS detail, e.remarks
           FROM petty_cash_expenses e
          WHERE e.deleted_at IS NULL ${siteClauseE}
       ) ledger
       ORDER BY date DESC`,
      params,
    );
    const columns: ExportColumn[] = [
      { header: 'Date', type: 'date' },
      { header: 'Site' },
      { header: 'Type' },
      { header: 'Amount', type: 'amount' },
      { header: 'Reference / Purpose', pdfWidth: 180 },
      { header: 'Remarks', pdfWidth: 140 },
    ];
    const data = rows.map(r => [r.date, r.site, r.kind, r.amount, r.detail, r.remarks]);
    sendTableExport(res, {
      format: parseFormat(req), filenameBase: `petty-cash-${today()}`,
      title: 'Petty Cash Ledger', columns, rows: data, filters,
    });
  } catch (err) { next(err); }
}

// ── Bank Reconciliation (bank transactions + verification + linked payments) ───
interface BankTxnExportRow {
  txn_date: string; txn_type: string; txn_ref: string; bank: string | null;
  txn_amount: string; verified: boolean; linked: string; remarks: string | null;
}

export async function exportBankTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const verified = String(req.query.verified || 'All'); // verified | unverified | All
    const clauses: string[] = [];
    const filters: string[] = [];
    if (verified === 'verified') { clauses.push('b.verified_at IS NOT NULL'); filters.push('Verified only'); }
    if (verified === 'unverified') { clauses.push('b.verified_at IS NULL'); filters.push('Unverified only'); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await query<BankTxnExportRow>(
      `SELECT TO_CHAR(b.txn_date, 'YYYY-MM-DD') AS txn_date, b.txn_type, b.txn_ref, b.bank,
              b.txn_amount::text, (b.verified_at IS NOT NULL) AS verified,
              (SELECT COUNT(*) FROM payments WHERE bank_txn_id = b.id)::text AS linked,
              b.remarks
         FROM bank_transactions b
         ${where}
        ORDER BY b.txn_date DESC, b.created_at DESC`,
    );
    const columns: ExportColumn[] = [
      { header: 'Date', type: 'date' },
      { header: 'Type' },
      { header: 'Reference' },
      { header: 'Bank' },
      { header: 'Amount', type: 'amount' },
      { header: 'Verified' },
      { header: 'Linked Payments', type: 'int' },
      { header: 'Remarks', pdfWidth: 140 },
    ];
    const data = rows.map(r => [
      r.txn_date, r.txn_type, r.txn_ref, r.bank, r.txn_amount,
      r.verified ? 'Yes' : 'No', r.linked, r.remarks,
    ]);
    sendTableExport(res, {
      format: parseFormat(req), filenameBase: `bank-transactions-${today()}`,
      title: 'Bank Reconciliation', columns, rows: data, filters,
    });
  } catch (err) { next(err); }
}

// ── Bin (soft-deleted invoices) ────────────────────────────────────────────────
interface BinExportRow {
  invoice_date: string; vendor_name: string | null; invoice_no: string | null;
  purpose: string | null; site: string; invoice_amount: string; payment_status: string;
  deleted_at: string; deleted_by_name: string | null;
}

export async function exportBin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await query<BinExportRow>(
      `SELECT TO_CHAR(i.invoice_date, 'YYYY-MM-DD') AS invoice_date, i.vendor_name, i.invoice_no,
              i.purpose, i.site, i.invoice_amount::text, i.payment_status,
              TO_CHAR(i.deleted_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS deleted_at,
              u.name AS deleted_by_name
         FROM invoices i
         LEFT JOIN users u ON u.id = i.deleted_by
        WHERE i.deleted_at IS NOT NULL
        ORDER BY i.deleted_at DESC`,
    );
    const columns: ExportColumn[] = [
      { header: 'Invoice Date', type: 'date' },
      { header: 'Vendor', pdfWidth: 150 },
      { header: 'Invoice No' },
      { header: 'Category' },
      { header: 'Site' },
      { header: 'Invoice Amount', type: 'amount' },
      { header: 'Status' },
      { header: 'Deleted At', type: 'datetime' },
      { header: 'Deleted By' },
    ];
    const data = rows.map(r => [
      r.invoice_date, r.vendor_name, r.invoice_no, r.purpose, r.site,
      r.invoice_amount, r.payment_status, r.deleted_at, r.deleted_by_name,
    ]);
    sendTableExport(res, {
      format: parseFormat(req), filenameBase: `bin-${today()}`,
      title: 'Bin — Deleted Invoices', columns, rows: data,
    });
  } catch (err) { next(err); }
}
