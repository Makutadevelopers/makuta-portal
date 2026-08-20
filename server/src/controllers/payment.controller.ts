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
import { notifyPaymentEdited } from '../services/email.service';
import { userHasSite, isSiteScoped } from '../middleware/auth';
import { paymentStatusCase, syncBankTxnForPayment, resyncBankTxnAmount } from '../services/payment.service';

const MINOR_LIMIT = 50000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(v => !isNaN(new Date(v).getTime()), 'Invalid calendar date');

// TDS deducted at source. Indian construction TDS sits around 1–2% (sec 194C);
// other sections go up to 10%, so we cap at 10 here and let the UI suggest 2.
const tdsPct = z.number().min(0, 'TDS % cannot be negative').max(10, 'TDS % cannot exceed 10').optional();
// GST-TDS (CGST+SGST) withheld under GST law — statutorily 2%. Capped at 10 to
// match the TDS field; computed on the same pre-GST base. See migration 050.
const gstTdsPct = z.number().min(0, 'GST-TDS % cannot be negative').max(10, 'GST-TDS % cannot exceed 10').optional();
// GST ADDED at payment (the opposite of GST-TDS withholding): extra cash paid to
// the vendor on top of the invoice, computed on the taxable base. GST slabs go
// up to 28%, so cap at 28. NOT part of invoice settlement. See migration 052.
const gstAddedPct = z.number().min(0, 'GST % cannot be negative').max(28, 'GST % cannot exceed 28').optional();

const createPaymentSchema = z.object({
  amount: z.number().nonnegative('Amount cannot be negative').max(1e12, 'Amount too large'),
  payment_type: z.string().min(1, 'Payment type is required').max(50),
  // payment_ref is optional/nullable at the API layer — Cash payments don't carry a
  // cheque/TXN reference. The client enforces "ref required for non-Cash".
  payment_ref: z.string().max(100).nullable().optional(),
  payment_date: isoDate,
  bank: z.string().max(100).nullable().optional(),
  tds_pct: tdsPct,
  gst_tds_pct: gstTdsPct,
  gst_added_pct: gstAddedPct,
}).refine(d => d.amount > 0 || (d.tds_pct ?? 0) > 0 || (d.gst_tds_pct ?? 0) > 0, {
  message: 'Amount, TDS % or GST-TDS % must be greater than zero',
});

// Update is HO-only and any field is optional, but the body must be non-empty.
const updatePaymentSchema = z.object({
  amount: z.number().nonnegative('Amount cannot be negative').max(1e12, 'Amount too large'),
  payment_type: z.string().min(1, 'Payment type is required').max(50),
  payment_ref: z.string().max(100).nullable().optional(),
  payment_date: isoDate,
  bank: z.string().max(100).nullable().optional(),
  tds_pct: tdsPct,
  gst_tds_pct: gstTdsPct,
  gst_added_pct: gstAddedPct,
}).refine(d => d.amount > 0 || (d.tds_pct ?? 0) > 0 || (d.gst_tds_pct ?? 0) > 0, {
  message: 'Amount, TDS % or GST-TDS % must be greater than zero',
});

interface InvoiceRow {
  id: string;
  invoice_amount: number;
  base_amount: number | string | null;
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
  gst_tds_pct: number;
  gst_tds_amount: number;
  gst_added_pct: number;
  gst_added_amount: number;
  bank_txn_id: string | null;
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
        `SELECT id, invoice_amount, base_amount, site, pushed, deleted_at, vendor_name, invoice_no
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
           COALESCE((SELECT SUM(amount + tds_amount + gst_tds_amount) FROM payments WHERE invoice_id = $1), 0)::TEXT AS total,
           COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE invoice_id = $1), 0)::TEXT AS allocated`,
        [invoiceId]
      );
      const alreadyPaid = Number(sumRows[0]?.total ?? 0);
      const allocated = Number(sumRows[0]?.allocated ?? 0);
      const balance = Number(invoice.invoice_amount) - alreadyPaid - allocated;

      // TDS is charged on the taxable BASE amount (pre-GST), per Sec. 194C —
      // CBDT clarification that TDS is deducted on the value of the supply
      // excluding GST. Falls back to the full invoice_amount only for legacy
      // rows that pre-date the tax-split columns and have no base_amount.
      // The rupee value is frozen here so reads don't have to re-round.
      const tdsPctVal = data.tds_pct ?? 0;
      const tdsBase = Number(invoice.base_amount ?? invoice.invoice_amount);
      const tdsAmount = Math.round(tdsBase * tdsPctVal) / 100;
      // GST-TDS is withheld on the same pre-GST taxable base as income-tax TDS
      // and, like TDS, settles the invoice without cash changing hands.
      const gstTdsPctVal = data.gst_tds_pct ?? 0;
      const gstTdsAmount = Math.round(tdsBase * gstTdsPctVal) / 100;
      // GST ADDED at payment: extra cash paid to the vendor on top of the
      // invoice, computed on the taxable BASE — the same base as TDS and
      // GST-TDS. (It was briefly computed on base − TDS; corrected 2026-08-20.
      // GST is levied on the value of the supply, which TDS does not reduce —
      // TDS is withheld from what is paid, it does not shrink the taxable
      // value.) Unlike TDS/GST-TDS this is NOT a withholding and does NOT
      // settle the invoice — it only inflates the cheque (see bank txn below).
      const gstAddedPctVal = data.gst_added_pct ?? 0;
      const gstAddedAmount = Math.round(tdsBase * gstAddedPctVal) / 100;
      // Settlement excludes gstAddedAmount — cash + withholdings only.
      const settlement = data.amount + tdsAmount + gstTdsAmount;
      if (settlement > balance + 0.001) {
        const withheldParts = [
          tdsAmount > 0 ? `₹${tdsAmount.toLocaleString('en-IN')} TDS` : null,
          gstTdsAmount > 0 ? `₹${gstTdsAmount.toLocaleString('en-IN')} GST-TDS` : null,
        ].filter(Boolean).join(' + ');
        return {
          status: 400,
          body: {
            error: 'Bad Request',
            message: `Payment (₹${data.amount.toLocaleString('en-IN')} cash${withheldParts ? ` + ${withheldParts}` : ''}) exceeds outstanding balance of ₹${balance.toLocaleString('en-IN')}`,
          },
        };
      }

      const payment = await tx.queryOne<PaymentRow>(
        `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by, tds_pct, tds_amount, gst_tds_pct, gst_tds_amount, gst_added_pct, gst_added_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [invoiceId, data.amount, data.payment_type, data.payment_ref ?? null, data.payment_date, data.bank ?? null, userId, tdsPctVal, tdsAmount, gstTdsPctVal, gstTdsAmount, gstAddedPctVal, gstAddedAmount]
      );
      if (!payment) {
        return { status: 500, body: { error: 'Internal Server Error', message: 'Failed to record payment' } };
      }

      // Surface non-Cash payments on Bank Reconciliation (creates/links a bank_transactions row).
      await syncBankTxnForPayment(tx, payment.id, {
        payment_type: data.payment_type,
        payment_ref: data.payment_ref ?? null,
        bank: data.bank ?? null,
        payment_date: data.payment_date,
        amount: data.amount,
        recorded_by: userId,
      }, null);

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
          gstTdsAmount,
          gstAddedAmount,
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
    const { payment, newStatus, newBalance, tdsAmount, gstTdsAmount, gstAddedAmount, vendorName, invoiceNo } = result.body as {
      payment: PaymentRow;
      newStatus: string;
      newBalance: number;
      tdsAmount: number;
      gstTdsAmount: number;
      gstAddedAmount: number;
      vendorName: string;
      invoiceNo: string | null;
    };
    const isPartial = newStatus === 'Partial';
    const tdsSuffix = tdsAmount > 0
      ? ` · TDS ${(data.tds_pct ?? 0).toString()}% (₹${tdsAmount.toLocaleString('en-IN')})`
      : '';
    const gstTdsSuffix = gstTdsAmount > 0
      ? ` · GST-TDS ${(data.gst_tds_pct ?? 0).toString()}% (₹${gstTdsAmount.toLocaleString('en-IN')})`
      : '';
    const gstAddedSuffix = gstAddedAmount > 0
      ? ` · GST added ${(data.gst_added_pct ?? 0).toString()}% (₹${gstAddedAmount.toLocaleString('en-IN')})`
      : '';
    try {
      await logAudit({
        userId,
        action: `${isPartial ? 'Part payment' : 'Full payment'}: ₹${data.amount.toLocaleString('en-IN')} via ${data.payment_type}${tdsSuffix}${gstTdsSuffix}${gstAddedSuffix}${isPartial ? ` · Balance ₹${newBalance.toLocaleString('en-IN')}` : ''}`,
        invoiceId,
        metadata: { amount: data.amount, type: data.payment_type, ref: data.payment_ref, tds_pct: data.tds_pct ?? 0, tds_amount: tdsAmount, gst_tds_pct: data.gst_tds_pct ?? 0, gst_tds_amount: gstTdsAmount, gst_added_pct: data.gst_added_pct ?? 0, gst_added_amount: gstAddedAmount },
      });
    } catch (auditErr) {
      console.error('[audit] createPayment audit log failed:', auditErr);
    }

    res.status(201).json({ ...payment, invoice_payment_status: newStatus });
  } catch (err) {
    next(err);
  }
}

export async function getPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoiceId = req.params.id as string;

    // Scope: site-scoped roles (project manager) may only view payments for
    // invoices on their assigned sites. 404 (not 403) so an out-of-scope
    // invoice's existence isn't revealed. ho/mgmt skip the check.
    if (isSiteScoped(req.user)) {
      const [inv] = await query<{ site: string }>(
        'SELECT site FROM invoices WHERE id = $1 AND deleted_at IS NULL',
        [invoiceId]
      );
      if (!inv || !userHasSite(req.user, inv.site)) {
        res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
        return;
      }
    }

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
        `SELECT id, invoice_amount, base_amount, site, pushed, deleted_at, vendor_name, invoice_no
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
           COALESCE((SELECT SUM(amount + tds_amount + gst_tds_amount) FROM payments WHERE invoice_id = $1 AND id <> $2), 0)::TEXT AS other_total,
           COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE invoice_id = $1), 0)::TEXT AS allocated`,
        [invoiceId, paymentId]
      );
      const otherPaid = Number(sumRows[0]?.other_total ?? 0);
      const allocated = Number(sumRows[0]?.allocated ?? 0);
      const headroom = Number(invoice.invoice_amount) - otherPaid - allocated;
      const tdsPctVal = data.tds_pct ?? 0;
      // TDS base is the pre-GST taxable value (see createPayment).
      const tdsBase = Number(invoice.base_amount ?? invoice.invoice_amount);
      const tdsAmount = Math.round(tdsBase * tdsPctVal) / 100;
      // GST-TDS withheld on the same pre-GST base (see createPayment).
      const gstTdsPctVal = data.gst_tds_pct ?? 0;
      const gstTdsAmount = Math.round(tdsBase * gstTdsPctVal) / 100;
      // GST added at payment (extra cash, on the taxable base). Not part of
      // settlement/headroom — see createPayment.
      const gstAddedPctVal = data.gst_added_pct ?? 0;
      const gstAddedAmount = Math.round(tdsBase * gstAddedPctVal) / 100;
      const settlement = data.amount + tdsAmount + gstTdsAmount;
      if (settlement > headroom + 0.001) {
        const withheldParts = [
          tdsAmount > 0 ? `₹${tdsAmount.toLocaleString('en-IN')} TDS` : null,
          gstTdsAmount > 0 ? `₹${gstTdsAmount.toLocaleString('en-IN')} GST-TDS` : null,
        ].filter(Boolean).join(' + ');
        return {
          status: 400,
          body: {
            error: 'Bad Request',
            message: `Updated payment (₹${data.amount.toLocaleString('en-IN')} cash${withheldParts ? ` + ${withheldParts}` : ''}) exceeds remaining invoice headroom of ₹${headroom.toLocaleString('en-IN')}`,
          },
        };
      }

      const updated = await tx.queryOne<PaymentRow>(
        `UPDATE payments
           SET amount = $1,
               payment_type = $2,
               payment_ref = $3,
               payment_date = $4,
               payment_month = DATE_TRUNC('month', $4::date)::date,
               bank = $5,
               tds_pct = $6,
               tds_amount = $7,
               gst_tds_pct = $8,
               gst_tds_amount = $9,
               gst_added_pct = $10,
               gst_added_amount = $11
         WHERE id = $12 AND invoice_id = $13
         RETURNING *`,
        [data.amount, data.payment_type, data.payment_ref ?? null, data.payment_date, data.bank ?? null, tdsPctVal, tdsAmount, gstTdsPctVal, gstTdsAmount, gstAddedPctVal, gstAddedAmount, paymentId, invoiceId]
      );

      // Re-link the bank_transactions row to match the edited details (a changed
      // type/ref/bank/date moves the payment to a different cheque; a changed
      // amount re-sums the same one; switching to Cash unlinks it entirely).
      await syncBankTxnForPayment(tx, paymentId, {
        payment_type: data.payment_type,
        payment_ref: data.payment_ref ?? null,
        bank: data.bank ?? null,
        payment_date: data.payment_date,
        amount: data.amount,
        recorded_by: existing.recorded_by,
      }, existing.bank_txn_id ?? null);

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
        body: {
          payment: updated,
          before: existing,
          newStatus: statusRow?.payment_status ?? 'Not Paid',
          vendorName: invoice.vendor_name,
          invoiceNo: invoice.invoice_no,
        },
      };
    });

    if (result.status !== 200) {
      res.status(result.status).json(result.body);
      return;
    }

    const { payment, before, newStatus, vendorName, invoiceNo } = result.body as {
      payment: PaymentRow;
      before: PaymentRow;
      newStatus: string;
      vendorName: string;
      invoiceNo: string | null;
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
      if (Number(before.gst_tds_pct ?? 0) !== Number(payment.gst_tds_pct ?? 0)) {
        diffs.push(`GST-TDS ${Number(before.gst_tds_pct ?? 0)}% (₹${Number(before.gst_tds_amount ?? 0).toLocaleString('en-IN')}) → ${Number(payment.gst_tds_pct)}% (₹${Number(payment.gst_tds_amount).toLocaleString('en-IN')})`);
      }
      if (Number(before.gst_added_pct ?? 0) !== Number(payment.gst_added_pct ?? 0)) {
        diffs.push(`GST added ${Number(before.gst_added_pct ?? 0)}% (₹${Number(before.gst_added_amount ?? 0).toLocaleString('en-IN')}) → ${Number(payment.gst_added_pct)}% (₹${Number(payment.gst_added_amount).toLocaleString('en-IN')})`);
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

    notifyPaymentEdited({
      vendorName: vendorName || '(vendor not set)',
      invoiceNo: invoiceNo ?? '(no invoice no)',
      before: {
        amount: Number(before.amount),
        type: before.payment_type,
        ref: before.payment_ref,
        date: String(before.payment_date).slice(0, 10),
        bank: before.bank,
      },
      after: {
        amount: Number(payment.amount),
        type: payment.payment_type,
        ref: payment.payment_ref,
        date: String(payment.payment_date).slice(0, 10),
        bank: payment.bank,
      },
      editedBy: req.user!.name,
    }).catch((err) => console.error('[email] notifyPaymentEdited failed:', err));

    res.json({ ...payment, invoice_payment_status: newStatus });
  } catch (err) {
    next(err);
  }
}

const revertSchema = z.object({
  reason: z.string().trim().min(3, 'Please give a reason (e.g. cheque bounced, wrong entry)').max(500),
});

/**
 * Reverse ALL payments on an invoice and return it to its computed status
 * (Not Paid, unless credit notes still cover part of it). Used for cheque
 * bounces or payments entered against the wrong invoice.
 *
 * Payments are hard-deleted; the reason and the status change are preserved in
 * the audit log. Any cheque a deleted payment was part of is re-tallied — a
 * cheque that paid several invoices only loses this invoice's share, and a
 * cheque left with no payments is removed from Bank Reconciliation.
 *
 * Access: HO any invoice; site only its own, non-finalized invoices.
 */
export async function revertInvoicePayments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoiceId = req.params.id as string;
    const { reason } = revertSchema.parse(req.body);
    const { role, id: userId } = req.user!;

    const result = await withTransaction(async (tx) => {
      const invoice = await tx.queryOne<InvoiceRow & { payment_status: string }>(
        `SELECT id, invoice_amount, site, pushed, deleted_at, vendor_name, invoice_no, payment_status
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
        return { status: 403, body: { error: 'Forbidden', message: 'You can only revert payments for invoices in sites you are assigned to' } };
      }
      if (role === 'site' && invoice.pushed) {
        return { status: 403, body: { error: 'Forbidden', message: 'Finalized invoices can only be reverted by Head Office' } };
      }

      const payments = await tx.query<PaymentRow>(
        `SELECT * FROM payments WHERE invoice_id = $1 ORDER BY payment_date, created_at`,
        [invoiceId]
      );
      if (payments.length === 0) {
        return { status: 400, body: { error: 'Bad Request', message: 'This invoice has no payments to revert' } };
      }

      // Hard-delete the payments, then re-tally every cheque they touched.
      const txnIds = [...new Set(payments.map(p => p.bank_txn_id).filter((id): id is string => !!id))];
      await tx.query(`DELETE FROM payments WHERE invoice_id = $1`, [invoiceId]);
      for (const txnId of txnIds) {
        await resyncBankTxnAmount(tx, txnId);
      }

      // Recompute status (Not Paid unless credit notes still cover part of it)
      // and clear the site minor-payment flag now that the payments are gone.
      const statusRow = await tx.queryOne<{ payment_status: string }>(
        `UPDATE invoices
            SET payment_status = ${paymentStatusCase('invoices')},
                minor_payment = FALSE,
                updated_at = NOW()
          WHERE id = $1
          RETURNING payment_status`,
        [invoiceId]
      );

      return {
        status: 200,
        body: {
          invoiceId,
          before: invoice.payment_status,
          newStatus: statusRow?.payment_status ?? 'Not Paid',
          reverted: payments,
          vendorName: invoice.vendor_name,
          invoiceNo: invoice.invoice_no,
        },
      };
    });

    if (result.status !== 200) {
      res.status(result.status).json(result.body);
      return;
    }

    const { before, newStatus, reverted, invoiceNo } = result.body as {
      before: string;
      newStatus: string;
      reverted: PaymentRow[];
      vendorName: string;
      invoiceNo: string | null;
    };

    try {
      const totalCash = reverted.reduce((s, p) => s + Number(p.amount), 0);
      await logAudit({
        userId,
        action: `Reverted ${reverted.length} payment${reverted.length === 1 ? '' : 's'} (₹${totalCash.toLocaleString('en-IN')}): ${before} → ${newStatus}. Reason: ${reason}`,
        invoiceId,
        metadata: { reason, before, after: newStatus, invoiceNo, reverted },
      });
    } catch (auditErr) {
      console.error('[audit] revertInvoicePayments audit log failed:', auditErr);
    }

    res.json({ invoice_payment_status: newStatus, reverted_count: reverted.length });
  } catch (err) {
    next(err);
  }
}
