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
import { query, queryOne } from '../db/query';
import { recomputeInvoiceStatus } from '../services/payment.service';
import { logAudit } from '../services/audit.service';
import { notifyPaymentRecorded } from '../services/email.service';

const MINOR_LIMIT = 50000;

const createPaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  payment_type: z.string().min(1, 'Payment type is required'),
  payment_ref: z.string().nullable().optional(),
  payment_date: z.string().min(1, 'Payment date is required'),
  bank: z.string().nullable().optional(),
});

interface InvoiceRow {
  id: string;
  invoice_amount: number;
  site: string;
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

    // Verify invoice exists
    const invoice = await queryOne<InvoiceRow>(
      'SELECT id, invoice_amount, site FROM invoices WHERE id = $1',
      [invoiceId]
    );

    if (!invoice) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }

    // Block overpayment
    const existingPayments = await query<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE invoice_id = $1',
      [invoiceId]
    );
    const alreadyPaid = Number(existingPayments[0]?.total ?? 0);
    const balance = Number(invoice.invoice_amount) - alreadyPaid;
    if (data.amount > balance) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Payment of ₹${data.amount.toLocaleString('en-IN')} exceeds outstanding balance of ₹${balance.toLocaleString('en-IN')}`,
      });
      return;
    }

    // Enforce minor/major payment rules
    if (role === 'site' && data.amount > MINOR_LIMIT) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Site accountants can only process payments up to ₹${MINOR_LIMIT.toLocaleString('en-IN')}`,
      });
      return;
    }

    const payment = await queryOne<PaymentRow>(
      `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [invoiceId, data.amount, data.payment_type, data.payment_ref ?? null, data.payment_date, data.bank ?? null, userId]
    );

    // If minor payment by site, mark invoice as minor_payment
    if (role === 'site' && data.amount <= MINOR_LIMIT) {
      await queryOne(
        'UPDATE invoices SET minor_payment = TRUE, updated_at = NOW() WHERE id = $1',
        [invoiceId]
      );
    }

    // Recompute invoice payment_status
    const newStatus = await recomputeInvoiceStatus(invoiceId);

    const newBalance = balance - data.amount;
    const isPartial = newStatus === 'Partial';
    await logAudit({
      userId,
      action: `${isPartial ? 'Part payment' : 'Full payment'}: ₹${data.amount.toLocaleString('en-IN')} via ${data.payment_type}${isPartial ? ` · Balance ₹${newBalance.toLocaleString('en-IN')}` : ''}`,
      invoiceId,
      metadata: { amount: data.amount, type: data.payment_type, ref: data.payment_ref },
    });

    notifyPaymentRecorded({
      vendorName: '',
      invoiceNo: invoiceId,
      paymentAmount: data.amount,
      paymentType: data.payment_type,
      balance: newBalance,
      hoEmail: 'rajesh@makuta.in',
    }).catch(() => {});

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
