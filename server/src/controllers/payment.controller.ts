// payment.controller.ts
// POST /api/invoices/:id/payments — create a payment
// GET  /api/invoices/:id/payments — list payments for an invoice
//
// Business rules:
// - Minor payments (amount <= 50000): site role allowed
// - Major payments (amount > 50000): ho only
// - After insert, recompute invoice payment_status

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/query';
import { logAudit } from '../services/audit.service';
import { notifyPaymentRecorded } from '../services/email.service';
import { userHasSite } from '../middleware/auth';
import { paymentStatusCase } from '../services/payment.service';

const MINOR_LIMIT = 50000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(v => !isNaN(new Date(v).getTime()), 'Invalid calendar date');

// TDS deducted at source. Indian construction TDS sits around 1–2% (sec 194C);
// other sections go up to 10%, so we cap at 10 here and let the UI suggest 2.
const tdsPct = z.number().min(0, 'TDS % cannot be negative').max(10, 'TDS % cannot exceed 10').optional();

const createPaymentSchema = z.object({
  amount: z.number().nonnegative('Amount cannot be negative').max(1e12, 'Amount too large'),
  payment_type: z.string().min(1, 'Payment type is required').max(50),
  // payment_ref is optional/nullable at the API layer — Cash payments don't carry a
  // cheque/TXN reference. The client enforces "ref required for non-Cash".
  payment_ref: z.string().max(100).nullable().optional(),
  payment_date: isoDate,
  bank: z.string().max(100).nullable().optional(),
  tds_pct: tdsPct,
}).refine(d => d.amount > 0 || (d.tds_pct ?? 0) > 0, {
  message: 'Either Amount or TDS % must be greater than zero',
});

// Update is HO-only and any field is optional, but the body must be non-empty.
const updatePaymentSchema = z.object({
  amount: z.number().nonnegative('Amount cannot be negative').max(1e12, 'Amount too large'),
  payment_type: z.string().min(1, 'Payment type is required').max(50),
  payment_ref: z.string().max(100).nullable().optional(),
  payment_date: isoDate,
  bank: z.string().max(100).nullable().optional(),
  tds_pct: tdsPct,
}).refine(d => d.amount > 0 || (d.tds_pct ?? 0) > 0, {
  message: 'Either Amount or TDS % must be greater than zero',
});

interface InvoiceRow {
  id: string;
  invoice_amount: number;
  site: string;
  pushed?: boolean;
  deleted_at?: string | null;
  vendor_name: string;
  invoice_no: string | null;
}

interface PaymentRow {
  id: string;
  invoice_id: string;
  amount: number;
  payment_type: string;
  payment_ref: string | null;
  payment_date: string;
  bank: string | null;
  recorded_by: string | null;
  created_at: string;
  tds_pct: number;
  tds_amount: number;
}

export async function createPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoiceId = req.params.id as string;
    const data = createPaymentSchema.parse(req.body);
    const { role, id: userId } = req.user!;

    // Enforce minor/major payment rules up-front (cheap check, no DB needed)
    if (role === 'site' && data.amount > MINOR_LIMIT) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Site accountants can only process payments up to ₹${MINOR_LIMIT.toLocaleString('en-IN')}`,
      });
      return;
    }

    // All DB writes run inside a single transaction with SELECT ... FOR UPDATE on the invoice
    // to prevent concurrent payments from double-spending the balance.
    const result = await withTransaction(async (tx) => {
      // Lock the invoice row so no other payment can pass the balance check simultaneously
      const invoice = await tx.queryOne<InvoiceRow>(
        `SELECT id, invoice_amount, site, pushed, deleted_at, vendor_name, invoice_no
         FROM invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId]
      );

      if (!invoice) {
        return { status: 404, body: { error: 'Not Found', message: 'Invoice not found' } };
      }
      if (invoice.deleted_at) {
        return { status: 404, body: { error: 'Not Found', message: 'Invoice has been deleted' } };
      }
      if (role === 'site' && !userHasSite(req.user, invoice.site)) {
        return { status: 403, body: { error: 'Forbidden', message: 'You can only record payments for invoices in sites you are assigned to' } };
      }
      // H4: Site accountants may not pay finalized invoices — those need HO
      if (role === 'site' && invoice.pushed) {
        return { status: 403, body: { error: 'Forbidden', message: 'Finalized invoices can only be paid by Head Office' } };
      }

      // Sum existing payments (cash + TDS) + CN allocations inside the same
      // transaction so the balance check uses the latest state.
      const sumRows = await tx.query<{ total: string; allocated: string }>(
        `SELECT
           COALESCE((SELECT SUM(amount + tds_amount) FROM payments WHERE invoice_id = $1), 0)::TEXT AS total,
           COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE invoice_id = $1), 0)::TEXT AS allocated`,
        [invoiceId]
      );
      const alreadyPaid = Number(sumRows[0]?.total ?? 0);
      const allocated = Number(sumRows[0]?.allocated ?? 0);
      const balance = Number(invoice.invoice_amount) - alreadyPaid - allocated;

      // TDS is charged on the FULL invoice amount, not on this payment's
      // cash component. The site accountant supplies the %; we compute and
      // freeze the rupee value here so reads don't have to re-round.
      const tdsPctVal = data.tds_pct ?? 0;
      const tdsAmount = Math.round(Number(invoice.invoice_amount) * tdsPctVal) / 100;
      const settlement = data.amount + tdsAmount;
      if (settlement > balance + 0.001) {
        return {
          status: 400,
          body: {
            error: 'Bad Request',
            message: `Payment (₹${data.amount.toLocaleString('en-IN')} cash + ₹${tdsAmount.toLocaleString('en-IN')} TDS) exceeds outstanding balance of ₹${balance.toLocaleString('en-IN')}`,
          },
        };
      }

      const payment = await tx.queryOne<PaymentRow>(
        `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by, tds_pct, tds_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [invoiceId, data.amount, data.payment_type, data.payment_ref ?? null, data.payment_date, data.bank ?? null, userId, tdsPctVal, tdsAmount]
      );

      // If minor payment by site, mark invoice as minor_payment
      if (role === 'site') {
        await tx.query(
          'UPDATE invoices SET minor_payment = TRUE, updated_at = NOW() WHERE id = $1',
          [invoiceId]
        );
      }

      // Recompute payment_status inside the same transaction, accounting for CN allocations
      const statusRow = await tx.queryOne<{ payment_status: string }>(
        `UPDATE invoices
         SET payment_status = ${paymentStatusCase('invoices')},
             updated_at = NOW()
         WHERE id = $1
         RETURNING payment_status`,
        [invoiceId]
      );

      const newStatus = statusRow?.payment_status ?? 'Not Paid';
      const newBalance = balance - settlement;
      return {
        status: 201,
        body: {
          payment,
          newStatus,
          newBalance,
          tdsAmount,
          vendorName: invoice.vendor_name,
          invoiceNo: invoice.invoice_no,
        },
      };
    });

    if (result.status !== 201) {
      res.status(result.status).json(result.body);
      return;
    }

    // Non-blocking audit + email outside the transaction
    const { payment, newStatus, newBalance, tdsAmount, vendorName, invoiceNo } = result.body as {
      payment: PaymentRow;
      newStatus: string;
      newBalance: number;
      tdsAmount: number;
      vendorName: string;
      invoiceNo: string | null;
    };
    const isPartial = newStatus === 'Partial';
    const tdsSuffix = tdsAmount > 0
      ? ` · TDS ${(data.tds_pct ?? 0).toString()}% (₹${tdsAmount.toLocaleString('en-IN')})`
      : '';
    try {
      await logAudit({
        userId,
        action: `${isPartial ? 'Part payment' : 'Full payment'}: ₹${data.amount.toLocaleString('en-IN')} via ${data.payment_type}${tdsSuffix}${isPartial ? ` · Balance ₹${newBalance.toLocaleString('en-IN')}` : ''}`,
        invoiceId,
        metadata: { amount: data.amount, type: data.payment_type, ref: data.payment_ref, tds_pct: data.tds_pct ?? 0, tds_amount: tdsAmount },
      });
    } catch (auditErr) {
      console.error('[audit] createPayment audit log failed:', auditErr);
    }

    notifyPaymentRecorded({
      vendorName: vendorName || '(vendor not set)',
      invoiceNo: invoiceNo ?? '(no invoice no)',
      paymentAmount: data.amount,
      paymentType: data.payment_type,
      balance: newBalance,
    }).catch((err) => console.error('[email] notifyPaymentRecorded failed:', err));

    res.status(201).json({ ...payment, invoice_payment_status: newStatus });
  } catch (err) {
    next(err);
  }
}

export async function getPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoiceId = req.params.id as string;

    const payments = await query<PaymentRow>(
      'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY payment_date',
      [invoiceId]
    );

    res.json(payments);
  } catch (err) {
    next(err);
  }
}

// PATCH /api/invoices/:id/payments/:pid — edit a saved payment (HO only).
// The new amount must fit within the invoice headroom that remains AFTER
// excluding this payment's old amount and any CN allocations.
export async function updatePayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoiceId = req.params.id as string;
    const paymentId = req.params.pid as string;
    const data = updatePaymentSchema.parse(req.body);
    const { id: userId } = req.user!;

    const result = await withTransaction(async (tx) => {
      const invoice = await tx.queryOne<InvoiceRow>(
        `SELECT id, invoice_amount, site, pushed, deleted_at, vendor_name, invoice_no
         FROM invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId]
      );
      if (!invoice) {
        return { status: 404, body: { error: 'Not Found', message: 'Invoice not found' } };
      }
      if (invoice.deleted_at) {
        return { status: 404, body: { error: 'Not Found', message: 'Invoice has been deleted' } };
      }

      const existing = await tx.queryOne<PaymentRow>(
        `SELECT * FROM payments WHERE id = $1 AND invoice_id = $2 FOR UPDATE`,
        [paymentId, invoiceId]
      );
      if (!existing) {
        return { status: 404, body: { error: 'Not Found', message: 'Payment not found for this invoice' } };
      }

      const sumRows = await tx.query<{ other_total: string; allocated: string }>(
        `SELECT
           COALESCE((SELECT SUM(amount + tds_amount) FROM payments WHERE invoice_id = $1 AND id <> $2), 0)::TEXT AS other_total,
           COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE invoice_id = $1), 0)::TEXT AS allocated`,
        [invoiceId, paymentId]
      );
      const otherPaid = Number(sumRows[0]?.other_total ?? 0);
      const allocated = Number(sumRows[0]?.allocated ?? 0);
      const headroom = Number(invoice.invoice_amount) - otherPaid - allocated;
      const tdsPctVal = data.tds_pct ?? 0;
      const tdsAmount = Math.round(Number(invoice.invoice_amount) * tdsPctVal) / 100;
      const settlement = data.amount + tdsAmount;
      if (settlement > headroom + 0.001) {
        return {
          status: 400,
          body: {
            error: 'Bad Request',
            message: `Updated payment (₹${data.amount.toLocaleString('en-IN')} cash + ₹${tdsAmount.toLocaleString('en-IN')} TDS) exceeds remaining invoice headroom of ₹${headroom.toLocaleString('en-IN')}`,
          },
        };
      }

      const updated = await tx.queryOne<PaymentRow>(
        `UPDATE payments
           SET amount = $1,
               payment_type = $2,
               payment_ref = $3,
               payment_date = $4,
               bank = $5,
               tds_pct = $6,
               tds_amount = $7
         WHERE id = $8 AND invoice_id = $9
         RETURNING *`,
        [data.amount, data.payment_type, data.payment_ref ?? null, data.payment_date, data.bank ?? null, tdsPctVal, tdsAmount, paymentId, invoiceId]
      );

      const statusRow = await tx.queryOne<{ payment_status: string }>(
        `UPDATE invoices
            SET payment_status = ${paymentStatusCase('invoices')},
                updated_at = NOW()
          WHERE id = $1
          RETURNING payment_status`,
        [invoiceId]
      );

      return {
        status: 200,
        body: { payment: updated, before: existing, newStatus: statusRow?.payment_status ?? 'Not Paid' },
      };
    });

    if (result.status !== 200) {
      res.status(result.status).json(result.body);
      return;
    }

    const { payment, before, newStatus } = result.body as {
      payment: PaymentRow;
      before: PaymentRow;
      newStatus: string;
    };

    try {
      const diffs: string[] = [];
      if (Number(before.amount) !== Number(payment.amount)) {
        diffs.push(`amount ₹${Number(before.amount).toLocaleString('en-IN')} → ₹${Number(payment.amount).toLocaleString('en-IN')}`);
      }
      if (before.payment_type !== payment.payment_type) {
        diffs.push(`type ${before.payment_type} → ${payment.payment_type}`);
      }
      if ((before.payment_ref ?? '') !== (payment.payment_ref ?? '')) {
        diffs.push(`ref ${before.payment_ref ?? '—'} → ${payment.payment_ref ?? '—'}`);
      }
      const beforeDate = String(before.payment_date).slice(0, 10);
      const afterDate = String(payment.payment_date).slice(0, 10);
      if (beforeDate !== afterDate) {
        diffs.push(`date ${beforeDate} → ${afterDate}`);
      }
      if ((before.bank ?? '') !== (payment.bank ?? '')) {
        diffs.push(`bank ${before.bank ?? '—'} → ${payment.bank ?? '—'}`);
      }
      if (Number(before.tds_pct ?? 0) !== Number(payment.tds_pct ?? 0)) {
        diffs.push(`TDS ${Number(before.tds_pct ?? 0)}% (₹${Number(before.tds_amount ?? 0).toLocaleString('en-IN')}) → ${Number(payment.tds_pct)}% (₹${Number(payment.tds_amount).toLocaleString('en-IN')})`);
      }
      const summary = diffs.length ? diffs.join(' · ') : 'no field changes';
      await logAudit({
        userId,
        action: `Edited payment: ${summary}`,
        invoiceId,
        metadata: { paymentId, before, after: payment },
      });
    } catch (auditErr) {
      console.error('[audit] updatePayment audit log failed:', auditErr);
    }

    res.json({ ...payment, invoice_payment_status: newStatus });
  } catch (err) {
    next(err);
  }
}
