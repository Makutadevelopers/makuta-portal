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
import { paymentStatusCase } from '../services/payment.service';

const MINOR_LIMIT = 50000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(v => !isNaN(new Date(v).getTime()), 'Invalid calendar date');

const createPaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive').max(1e12, 'Amount too large'),
  payment_type: z.string().min(1, 'Payment type is required').max(50),
  payment_ref: z.string().min(1, 'Reference / TXN number is required').max(100),
  payment_date: isoDate,
  bank: z.string().max(100).nullable().optional(),
});

interface InvoiceRow {
  id: string;
  invoice_amount: number;
  site: string;
  pushed?: boolean;
  deleted_at?: string | null;
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
        `SELECT id, invoice_amount, site, pushed, deleted_at
         FROM invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId]
      );

      if (!invoice) {
        return { status: 404, body: { error: 'Not Found', message: 'Invoice not found' } };
      }
      if (invoice.deleted_at) {
        return { status: 404, body: { error: 'Not Found', message: 'Invoice has been deleted' } };
      }
      if (role === 'site' && invoice.site !== req.user!.site) {
        return { status: 403, body: { error: 'Forbidden', message: 'You can only record payments for invoices in your own site' } };
      }
      // H4: Site accountants may not pay finalized invoices — those need HO
      if (role === 'site' && invoice.pushed) {
        return { status: 403, body: { error: 'Forbidden', message: 'Finalized invoices can only be paid by Head Office' } };
      }

      // Sum existing payments + CN allocations inside the same transaction so we see the latest state
      const sumRows = await tx.query<{ total: string; allocated: string }>(
        `SELECT
           COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = $1), 0)::TEXT AS total,
           COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE invoice_id = $1), 0)::TEXT AS allocated`,
        [invoiceId]
      );
      const alreadyPaid = Number(sumRows[0]?.total ?? 0);
      const allocated = Number(sumRows[0]?.allocated ?? 0);
      const balance = Number(invoice.invoice_amount) - alreadyPaid - allocated;
      if (data.amount > balance) {
        return {
          status: 400,
          body: {
            error: 'Bad Request',
            message: `Payment of ₹${data.amount.toLocaleString('en-IN')} exceeds outstanding balance of ₹${balance.toLocaleString('en-IN')}`,
          },
        };
      }

      const payment = await tx.queryOne<PaymentRow>(
        `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [invoiceId, data.amount, data.payment_type, data.payment_ref ?? null, data.payment_date, data.bank ?? null, userId]
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
      const newBalance = balance - data.amount;
      return { status: 201, body: { payment, newStatus, newBalance } };
    });

    if (result.status !== 201) {
      res.status(result.status).json(result.body);
      return;
    }

    // Non-blocking audit + email outside the transaction
    const { payment, newStatus, newBalance } = result.body as { payment: PaymentRow; newStatus: string; newBalance: number };
    const isPartial = newStatus === 'Partial';
    try {
      await logAudit({
        userId,
        action: `${isPartial ? 'Part payment' : 'Full payment'}: ₹${data.amount.toLocaleString('en-IN')} via ${data.payment_type}${isPartial ? ` · Balance ₹${newBalance.toLocaleString('en-IN')}` : ''}`,
        invoiceId,
        metadata: { amount: data.amount, type: data.payment_type, ref: data.payment_ref },
      });
    } catch (auditErr) {
      console.error('[audit] createPayment audit log failed:', auditErr);
    }

    notifyPaymentRecorded({
      vendorName: '',
      invoiceNo: invoiceId,
      paymentAmount: data.amount,
      paymentType: data.payment_type,
      balance: newBalance,
      hoEmail: 'rajesh@makuta.in',
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
