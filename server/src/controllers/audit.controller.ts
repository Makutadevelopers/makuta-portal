// audit.controller.ts
// GET /api/audit — ho only
// Returns audit_logs joined with user names, sorted newest first.

import { Request, Response, NextFunction } from 'express';
import { query } from '../db/query';

interface AuditRow {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  invoice_id: string | null;
  invoice_no: string | null;
  invoice_site: string | null;
  vendor_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// Hard cap so the audit page doesn't ship the entire table over the wire.
// 2000 covers ~3 months of activity at current usage; older rows stay in the
// DB and remain accessible via the per-invoice history endpoint.
const AUDIT_LIST_LIMIT = 2000;

export async function getAuditLogs(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const logs = await query<AuditRow>(
      `SELECT
         a.id, a.user_id, u.name AS user_name,
         a.action, a.invoice_id, a.metadata, a.created_at,
         i.invoice_no AS invoice_no,
         i.site       AS invoice_site,
         i.vendor_name AS vendor_name
       FROM audit_logs a
       LEFT JOIN users u    ON u.id = a.user_id
       LEFT JOIN invoices i ON i.id = a.invoice_id
       ORDER BY a.created_at DESC
       LIMIT $1`,
      [AUDIT_LIST_LIMIT]
    );
    res.json(logs);
  } catch (err) {
    next(err);
  }
}

// Direct payment-flow audit actions, so we can tell whether an invoice's
// payments are already represented in the audit trail. If they are, we don't
// synthesize payment entries (avoids duplicating the manual flow's rows).
const PAYMENT_AUDIT_PREFIXES = ['Full payment', 'Part payment', 'Edited payment', 'Deleted payment'];

interface PaymentTimelineRow {
  id: string;
  amount: string | number;
  tds_amount: string | number | null;
  payment_type: string;
  payment_ref: string | null;
  payment_date: string;
  bank: string | null;
  recorded_by: string | null;
  user_name: string | null;
  created_at: string;
}

export async function getInvoiceHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoiceId = req.params.invoiceId as string;

    // 1. Audit rows tied directly to this invoice (manual edits, payment
    //    edits, status changes, pushes, and — for imports after 2026-05-19 —
    //    the per-invoice import row).
    const direct = await query<AuditRow>(
      `SELECT a.id, a.user_id, u.name AS user_name,
              a.action, a.invoice_id, a.metadata, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.invoice_id = $1`,
      [invoiceId]
    );

    // 2. The batch-level bulk-import event. Imports before 2026-05-19 logged
    //    only this one summary row (no invoice_id), so the invoice's own log
    //    looked empty. Surface it for any invoice whose batch_id matches.
    const batchEvent = await query<AuditRow>(
      `SELECT a.id, a.user_id, u.name AS user_name,
              a.action, $1::uuid AS invoice_id, a.metadata, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.invoice_id IS NULL
         AND a.action ILIKE 'Bulk imported%'
         AND a.metadata->>'batchId' = (SELECT batch_id::text FROM invoices WHERE id = $1)`,
      [invoiceId]
    );

    // 3. Payment entries. Older imports created the payment without an audit
    //    row, so a Paid invoice could show no payment in its history at all.
    //    Synthesize one entry per payment from the payments table — but only
    //    when the invoice has NO payment-flow audit of its own, so we don't
    //    duplicate the manual flow's "Full payment"/"Edited payment" rows.
    const hasPaymentAudit = direct.some(r =>
      PAYMENT_AUDIT_PREFIXES.some(p => r.action?.startsWith(p))
    );
    let synthesizedPayments: AuditRow[] = [];
    if (!hasPaymentAudit) {
      const payments = await query<PaymentTimelineRow>(
        `SELECT p.id, p.amount, p.tds_amount, p.payment_type, p.payment_ref,
                p.payment_date, p.bank, p.recorded_by, u.name AS user_name, p.created_at
         FROM payments p
         LEFT JOIN users u ON u.id = p.recorded_by
         WHERE p.invoice_id = $1
         ORDER BY p.payment_date`,
        [invoiceId]
      );
      synthesizedPayments = payments.map(p => {
        const amt = Number(p.amount).toLocaleString('en-IN');
        const ref = p.payment_ref && p.payment_ref.trim() ? ` (ref ${p.payment_ref.trim()})` : '';
        const dateLabel = new Date(p.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        return {
          id: `payment:${p.id}`,
          user_id: p.recorded_by ?? '',
          user_name: p.user_name ?? 'Import',
          action: `Payment recorded: ₹${amt} via ${p.payment_type}${ref} on ${dateLabel}`,
          invoice_id: invoiceId,
          invoice_no: null,
          invoice_site: null,
          vendor_name: null,
          metadata: { synthesized: true, payment_id: p.id },
          created_at: p.created_at ?? p.payment_date,
        } as AuditRow;
      });
    }

    const merged = [...direct, ...batchEvent, ...synthesizedPayments].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    res.json(merged);
  } catch (err) {
    next(err);
  }
}
