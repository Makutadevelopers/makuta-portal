// reconciliation.controller.ts
// Bank reconciliation endpoints.
//
// POST /api/reconciliation/bulk-pay — HO only
//   Creates one bank_transactions row and N payments (one per invoice),
//   all in a single transaction. Locks each invoice row with FOR UPDATE
//   to prevent concurrent over-payment. The sum of allocation amounts
//   must equal the cheque / transaction amount.
//
// GET  /api/reconciliation — HO + MD
//   Returns all bank_transactions with their linked payments and the
//   invoice rows those payments applied to, plus a computed tally.

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/query';
import { logAudit } from '../services/audit.service';
import { paymentStatusCase } from '../services/payment.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(v => !isNaN(new Date(v).getTime()), 'Invalid calendar date');

const bulkPaySchema = z.object({
  txn_type: z.string().min(1).max(50),
  // Optional here, required only for non-Cash (refine below): Cash payments carry
  // no cheque / transaction reference, mirroring the single-payment schema.
  txn_ref: z.string().max(100).optional(),
  txn_amount: z.number().positive().max(1e12),
  txn_date: isoDate,
  bank: z.string().max(100).nullable().optional(),
  remarks: z.string().max(500).nullable().optional(),
  allocations: z.array(z.object({
    invoice_id: z.string().uuid(),
    amount: z.number().positive(),
    // TDS withheld for this invoice (sec 194C/194J etc). Computed on the
    // invoice's pre-GST base_amount, frozen at insert time — mirrors the
    // single-payment path. Optional; defaults to 0.
    tds_pct: z.number().min(0).max(10).optional(),
  })).min(1).max(200),
}).refine(
  d => d.txn_type.trim().toLowerCase() === 'cash' || !!d.txn_ref?.trim(),
  { path: ['txn_ref'], message: 'Cheque / transaction reference is required for non-Cash payments' },
);

interface InvoiceRow {
  id: string;
  invoice_amount: string | number;
  base_amount: string | number | null;
  invoice_no: string;
  vendor_name: string;
  site: string;
  pushed?: boolean;
  deleted_at?: string | null;
}

interface BankTxnRow {
  id: string;
  txn_type: string;
  txn_ref: string;
  txn_amount: string | number;
  txn_date: string;
  bank: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
}

export async function bulkPay(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = bulkPaySchema.parse(req.body);
    const { id: userId } = req.user!;

    // Allocation total must tally with cheque / transaction amount (allow ₹1 paise tolerance)
    const allocTotal = data.allocations.reduce((s, a) => s + a.amount, 0);
    if (Math.abs(allocTotal - data.txn_amount) >= 1) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Allocations total ₹${allocTotal.toLocaleString('en-IN')} does not match cheque / transaction amount ₹${data.txn_amount.toLocaleString('en-IN')}`,
      });
      return;
    }

    // Cash isn't a bank instrument, so it gets no bank_transactions row (mirrors
    // syncBankTxnForPayment, which only links cheque/NEFT/etc). Every other type
    // creates one row that all the payments link to.
    const isCash = data.txn_type.trim().toLowerCase() === 'cash';

    const result = await withTransaction(async (tx) => {
      let txn: BankTxnRow | null = null;
      if (!isCash) {
        txn = await tx.queryOne<BankTxnRow>(
          `INSERT INTO bank_transactions (txn_type, txn_ref, txn_amount, txn_date, bank, remarks, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [data.txn_type, data.txn_ref, data.txn_amount, data.txn_date, data.bank ?? null, data.remarks ?? null, userId]
        );
        if (!txn) {
          return { status: 500, body: { error: 'Internal Server Error', message: 'Failed to create bank transaction' } };
        }
      }

      const paymentsOut: { invoice_id: string; amount: number; invoice_no: string }[] = [];

      for (const alloc of data.allocations) {
        const invoice = await tx.queryOne<InvoiceRow>(
          `SELECT id, invoice_amount, base_amount, invoice_no, vendor_name, site, pushed, deleted_at
           FROM invoices WHERE id = $1 FOR UPDATE`,
          [alloc.invoice_id]
        );
        if (!invoice) {
          return { status: 404, body: { error: 'Not Found', message: `Invoice ${alloc.invoice_id} not found` } };
        }
        if (invoice.deleted_at) {
          return { status: 404, body: { error: 'Not Found', message: `Invoice ${invoice.invoice_no} has been deleted` } };
        }

        const sumRow = await tx.query<{ total: string; allocated: string }>(
          `SELECT
             COALESCE((SELECT SUM(amount + tds_amount) FROM payments WHERE invoice_id = $1), 0)::TEXT AS total,
             COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE invoice_id = $1), 0)::TEXT AS allocated`,
          [alloc.invoice_id]
        );
        const alreadyPaid = Number(sumRow[0]?.total ?? 0);
        const allocatedCredits = Number(sumRow[0]?.allocated ?? 0);
        const balance = Number(invoice.invoice_amount) - alreadyPaid - allocatedCredits;

        // TDS is withheld on top of the cash allocation and settles part of the
        // invoice without cash changing hands — same rule as the single-payment
        // path. Computed on the pre-GST base_amount (sec 194C), frozen here.
        const tdsPctVal = Math.max(0, Math.min(10, alloc.tds_pct ?? 0));
        const tdsBase = Number(invoice.base_amount ?? invoice.invoice_amount);
        const tdsAmount = Math.round(tdsBase * tdsPctVal) / 100;

        // The cheque amount is the cash leg only, so the allocation tally above
        // is unaffected by TDS — but cash + TDS together must still fit inside
        // the outstanding balance.
        if (alloc.amount + tdsAmount > balance + 0.009) {
          return {
            status: 400,
            body: {
              error: 'Bad Request',
              message: `Allocation of ₹${alloc.amount.toLocaleString('en-IN')}${tdsAmount > 0 ? ` + TDS ₹${tdsAmount.toLocaleString('en-IN')}` : ''} for invoice ${invoice.invoice_no} exceeds outstanding balance of ₹${balance.toLocaleString('en-IN')}`,
            },
          };
        }

        await tx.query(
          `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by, bank_txn_id, tds_pct, tds_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [alloc.invoice_id, alloc.amount, data.txn_type,
           isCash ? null : (data.txn_ref ?? null), data.txn_date,
           isCash ? null : (data.bank ?? null), userId, txn?.id ?? null,
           tdsPctVal, tdsAmount]
        );

        await tx.query(
          `UPDATE invoices
           SET payment_status = ${paymentStatusCase('invoices')},
               updated_at = NOW()
           WHERE id = $1`,
          [alloc.invoice_id]
        );

        paymentsOut.push({ invoice_id: alloc.invoice_id, amount: alloc.amount, invoice_no: invoice.invoice_no });
      }

      return { status: 201, body: { txn, allocations: paymentsOut } };
    });

    if (result.status !== 201) {
      res.status(result.status).json(result.body);
      return;
    }

    const body = result.body as { txn: BankTxnRow | null; allocations: { invoice_id: string; amount: number; invoice_no: string }[] };
    try {
      await logAudit({
        userId,
        action: isCash
          ? `Bulk Cash payment ₹${data.txn_amount.toLocaleString('en-IN')} across ${body.allocations.length} invoice(s)`
          : `Bulk payment: ${data.txn_type} ${data.txn_ref} ₹${data.txn_amount.toLocaleString('en-IN')} across ${body.allocations.length} invoice(s)`,
        metadata: { txn_ref: data.txn_ref ?? null, txn_amount: data.txn_amount, count: body.allocations.length },
      });
    } catch (err) {
      console.error('[audit] bulkPay audit log failed:', err);
    }

    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
}

interface ReconciliationRow extends BankTxnRow {
  allocated_total: string | number;
  allocation_count: string | number;
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
}

interface AllocationDetail {
  payment_id: string;
  invoice_id: string;
  invoice_no: string;
  vendor_name: string;
  site: string;
  invoice_amount: string | number;
  allocated_amount: string | number;
  payment_status: string;
}

export async function listReconciliation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const txns = await query<ReconciliationRow>(
      // Only count payments whose invoice is still live — a payment on a
      // soft-deleted invoice is hidden everywhere else, so it must not show or
      // tally here either.
      `SELECT bt.*,
              vu.name AS verified_by_name,
              COALESCE(SUM(p.amount), 0)::NUMERIC(14,2) AS allocated_total,
              COUNT(p.id)                               AS allocation_count
       FROM bank_transactions bt
       LEFT JOIN payments p ON p.bank_txn_id = bt.id
              AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = p.invoice_id AND i.deleted_at IS NULL)
       LEFT JOIN users vu ON vu.id = bt.verified_by
       GROUP BY bt.id, vu.name
       -- A cheque exists only because a payment created it. Hide any row with no
       -- live linked payments — that's a true orphan (bad import) or a cheque
       -- whose only invoice was deleted; neither belongs on the reconciliation
       -- view. Restore-safe (no data mutation) and keeps totals honest.
       HAVING COUNT(p.id) > 0
       ORDER BY bt.txn_date DESC, bt.created_at DESC`
    );

    const txnIds = txns.map(t => t.id);
    let allocMap: Record<string, AllocationDetail[]> = {};
    if (txnIds.length > 0) {
      const rows = await query<AllocationDetail & { bank_txn_id: string }>(
        `SELECT p.id AS payment_id,
                p.bank_txn_id,
                p.amount AS allocated_amount,
                i.id AS invoice_id,
                i.invoice_no,
                i.vendor_name,
                i.site,
                i.invoice_amount,
                i.payment_status
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         WHERE p.bank_txn_id = ANY($1::uuid[])
           AND i.deleted_at IS NULL
         ORDER BY i.invoice_no`,
        [txnIds]
      );
      allocMap = rows.reduce<Record<string, AllocationDetail[]>>((acc, r) => {
        const { bank_txn_id, ...rest } = r;
        (acc[bank_txn_id] ||= []).push(rest);
        return acc;
      }, {});
    }

    const out = txns.map(t => {
      const allocations = allocMap[t.id] ?? [];
      const allocatedTotal = Number(t.allocated_total);
      const txnAmount = Number(t.txn_amount);
      // Cheque vs allocated can differ by a few paise because the old importer
      // wrote paise-rounded payment splits. Treat anything under ₹1 as tallied —
      // the same tolerance bulkPay() enforces when a cheque is created. Without
      // this, a ₹0.40 rounding gap surfaced as "Mismatch" even though the page
      // (which displays whole rupees) showed the balance as ₹0.
      const rawBalance = Number((txnAmount - allocatedTotal).toFixed(2));
      const balance = Object.is(rawBalance, -0) ? 0 : rawBalance;
      return {
        ...t,
        txn_amount: txnAmount,
        allocated_total: allocatedTotal,
        allocation_count: Number(t.allocation_count),
        balance,
        tally_ok: Math.abs(rawBalance) < 1,
        allocations: allocations.map(a => ({
          ...a,
          invoice_amount: Number(a.invoice_amount),
          allocated_amount: Number(a.allocated_amount),
        })),
      };
    });

    res.json(out);
  } catch (err) {
    next(err);
  }
}

const verifySchema = z.object({
  verified: z.boolean(),
});

interface VerifyResultRow {
  id: string;
  txn_ref: string;
  verified_at: string | null;
  verified_by: string | null;
}

// PATCH /api/reconciliation/:id/verify — HO + MD
//   Marks a bank transaction as verified (ticked) against the bank
//   statement, or clears the verification. Records who verified and when.
export async function verifyReconciliation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid transaction id' });
      return;
    }
    const { verified } = verifySchema.parse(req.body);
    const { id: userId } = req.user!;

    const updated = await query<VerifyResultRow>(
      `UPDATE bank_transactions
       SET verified_at = ${verified ? 'NOW()' : 'NULL'},
           verified_by = ${verified ? '$2' : 'NULL'}
       WHERE id = $1
       RETURNING id, txn_ref, verified_at, verified_by`,
      verified ? [id, userId] : [id]
    );

    if (updated.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Bank transaction not found' });
      return;
    }

    try {
      await logAudit({
        userId,
        action: `${verified ? 'Verified' : 'Un-verified'} bank transaction ${updated[0].txn_ref} against bank statement`,
        metadata: { bank_txn_id: id, verified },
      });
    } catch (err) {
      console.error('[audit] verifyReconciliation audit log failed:', err);
    }

    res.json(updated[0]);
  } catch (err) {
    next(err);
  }
}

const updateDateSchema = z.object({
  txn_date: isoDate,
});

interface LinkedPaymentRow {
  payment_id: string;
  invoice_id: string;
  invoice_no: string;
  invoice_date: string;
  old_payment_date: string;
}

// PATCH /api/reconciliation/:id/date — HO only
//   Corrects the cheque/transaction date (e.g. when the actual bank debit lands
//   later than the cheque was issued). The new date cascades to every payment
//   linked to this cheque so each invoice's "Paid Date" (derived from
//   MAX(payments.payment_date)) reflects the real debit date. payment_month is
//   re-synced too. Rejected if the new date is before any linked invoice's date.
//
//   Audits: one summary row for the cheque, plus per-payment "Edited payment:
//   date X -> Y" rows with metadata.paymentId — so future repair migrations
//   treat each payment's date as a human edit (see CLAUDE.md).
export async function updateReconciliationDate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid transaction id' });
      return;
    }
    const { txn_date: newDate } = updateDateSchema.parse(req.body);
    const { id: userId } = req.user!;

    const result = await withTransaction(async (tx) => {
      const txn = await tx.queryOne<{ id: string; txn_ref: string; old_date: string }>(
        `SELECT id, txn_ref, to_char(txn_date, 'YYYY-MM-DD') AS old_date
         FROM bank_transactions WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!txn) {
        return { status: 404, body: { error: 'Not Found', message: 'Bank transaction not found' } };
      }

      if (txn.old_date === newDate) {
        return {
          status: 200,
          body: { id: txn.id, txn_ref: txn.txn_ref, txn_date: newDate, old_date: txn.old_date, payments_updated: 0, unchanged: true },
        };
      }

      const linked = await tx.query<LinkedPaymentRow>(
        `SELECT p.id AS payment_id, p.invoice_id, i.invoice_no,
                to_char(i.invoice_date, 'YYYY-MM-DD') AS invoice_date,
                to_char(p.payment_date, 'YYYY-MM-DD') AS old_payment_date
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         WHERE p.bank_txn_id = $1`,
        [id]
      );

      // Payment-before-invoice is an impossible business state — same rule the
      // bulk importer enforces. ISO YYYY-MM-DD strings compare lexicographically.
      const violation = linked.find(l => newDate < l.invoice_date);
      if (violation) {
        return {
          status: 400,
          body: {
            error: 'Bad Request',
            message: `Cheque date ${newDate} is before invoice ${violation.invoice_no} (dated ${violation.invoice_date}). Pick a date on or after every linked invoice's date.`,
          },
        };
      }

      await tx.query(
        `UPDATE bank_transactions SET txn_date = $1 WHERE id = $2`,
        [newDate, id]
      );

      await tx.query(
        `UPDATE payments
         SET payment_date = $1::date,
             payment_month = date_trunc('month', $1::date)::date
         WHERE bank_txn_id = $2`,
        [newDate, id]
      );

      return {
        status: 200,
        body: {
          id: txn.id,
          txn_ref: txn.txn_ref,
          txn_date: newDate,
          old_date: txn.old_date,
          payments_updated: linked.length,
          linked,
        },
      };
    });

    if (result.status !== 200) {
      res.status(result.status).json(result.body);
      return;
    }

    const body = result.body as {
      id: string; txn_ref: string; txn_date: string; old_date: string;
      payments_updated: number; unchanged?: boolean; linked?: LinkedPaymentRow[];
    };

    if (!body.unchanged) {
      try {
        await logAudit({
          userId,
          action: `Edited cheque date: ${body.txn_ref} · ${body.old_date} → ${body.txn_date}`,
          metadata: {
            bank_txn_id: body.id,
            old_date: body.old_date,
            new_date: body.txn_date,
            payments_updated: body.payments_updated,
          },
        });
        for (const l of body.linked ?? []) {
          await logAudit({
            userId,
            action: `Edited payment: date ${l.old_payment_date} → ${body.txn_date} (via cheque ${body.txn_ref})`,
            invoiceId: l.invoice_id,
            metadata: {
              paymentId: l.payment_id,
              bank_txn_id: body.id,
              old_date: l.old_payment_date,
              new_date: body.txn_date,
              via_cheque_date_edit: true,
            },
          });
        }
      } catch (err) {
        console.error('[audit] updateReconciliationDate audit log failed:', err);
      }
    }

    res.json({ id: body.id, txn_ref: body.txn_ref, txn_date: body.txn_date, old_date: body.old_date, payments_updated: body.payments_updated });
  } catch (err) {
    next(err);
  }
}
