// payment.service.ts
// Handles payment insertion and automatic invoice status recomputation.
//
// Business rules (effective payable = invoice_amount − sum(credit note allocations);
// each payment can also withhold TDS, which counts toward settlement):
// - sum(payments.amount + payments.tds_amount) ≥ effective_payable − ₹1 → 'Paid'
// - sum(payments.amount + payments.tds_amount) > 0
//     OR sum(CN allocations) > 0 (but effective not met) → 'Partial'
// - nothing → 'Not Paid'
//
// The ₹1 tolerance absorbs paisa-level shortfalls that arise from GST
// rounding (e.g. invoice_amount = ₹1,576,798.60, payment = ₹1,576,798.50).
// Indian site accounting doesn't track paisa, so a ≤ ₹1 underpayment is
// effectively settled. Anything larger is a real partial payment.

import { query, queryOne } from '../db/query';

interface StatusResult {
  payment_status: string;
}

/**
 * SQL fragment that resolves to the correct payment_status for a given invoice id alias.
 * Reusable across controllers that need bulk UPDATE ... SET payment_status = (this).
 * Pass the invoice-row alias (e.g. 'i' or 'invoices') so the subqueries join correctly.
 */
export function paymentStatusCase(alias: string): string {
  // settled = cash actually received + TDS withheld (per payment row).
  // payments.tds_amount defaults to 0 (migration 027) so pre-TDS rows
  // and TDS-aware rows both work without special-casing.
  return `CASE
    WHEN (SELECT COALESCE(SUM(amount + tds_amount + gst_tds_amount), 0) FROM payments WHERE invoice_id = ${alias}.id)
         >= ${alias}.invoice_amount
            - (SELECT COALESCE(SUM(allocated_amount), 0) FROM credit_note_allocations WHERE invoice_id = ${alias}.id)
            - 1
      THEN 'Paid'
    WHEN (SELECT COALESCE(SUM(amount + tds_amount + gst_tds_amount), 0) FROM payments WHERE invoice_id = ${alias}.id) > 0
      OR (SELECT COALESCE(SUM(allocated_amount), 0) FROM credit_note_allocations WHERE invoice_id = ${alias}.id) > 0
      THEN 'Partial'
    ELSE 'Not Paid'
  END`;
}

// Transaction client shape handed to callbacks by withTransaction().
type TxClient = {
  query: <R>(sql: string, params?: unknown[]) => Promise<R[]>;
  queryOne: <R>(sql: string, params?: unknown[]) => Promise<R | null>;
};

/**
 * Keep bank_transactions in sync with one payment row so that cheque/NEFT/
 * RTGS/UPI/IMPS payments entered through the normal invoice payment flow show
 * up on Bank Reconciliation — historically only Bulk Pay and the bulk importer
 * created bank_transactions, leaving manually-keyed cheques invisible there.
 *
 * Identity of a physical cheque/transfer = (txn_type, txn_ref, bank, txn_date).
 * One cheque paying several invoices therefore collapses to a single
 * reconciliation row, while the same cheque number reused on another date stays
 * separate. A non-Cash payment with a reference and amount > 0 is linked to that
 * row (reused when it already exists, else created); a row left with no linked
 * payments is deleted so it never surfaces as an un-tallied orphan.
 *
 * Invariant maintained: bank_transactions.txn_amount == SUM(amount +
 * gst_added_amount) of its linked payments — the actual money that left the
 * bank (cash to vendor + any GST added at payment), the same tally Bank
 * Reconciliation checks. Withheld TDS/GST-TDS are excluded: they never leave
 * the bank as part of the cheque.
 *
 * Call AFTER the payment row has been inserted/updated, inside the same
 * transaction. `previousTxnId` is the txn the payment was linked to before this
 * change (null on create) so a moved or cleared link re-sums the old cheque too.
 */
export async function syncBankTxnForPayment(
  tx: TxClient,
  paymentId: string,
  payment: {
    payment_type: string;
    payment_ref: string | null;
    bank: string | null;
    payment_date: string;
    amount: number;
    recorded_by?: string | null;
  },
  previousTxnId: string | null,
): Promise<void> {
  const ref = payment.payment_ref?.trim() || null;
  const shouldLink =
    payment.payment_type.trim().toLowerCase() !== 'cash' &&
    payment.amount > 0 &&
    ref !== null;

  let newTxnId: string | null = null;
  if (shouldLink) {
    // FOR UPDATE serialises concurrent allocations to the same cheque.
    const existing = await tx.queryOne<{ id: string }>(
      `SELECT id FROM bank_transactions
        WHERE txn_type = $1 AND txn_ref = $2
          AND bank IS NOT DISTINCT FROM $3 AND txn_date = $4
        ORDER BY created_at, id
        LIMIT 1
        FOR UPDATE`,
      [payment.payment_type, ref, payment.bank ?? null, payment.payment_date],
    );
    if (existing) {
      newTxnId = existing.id;
    } else {
      const created = await tx.queryOne<{ id: string }>(
        `INSERT INTO bank_transactions (txn_type, txn_ref, txn_amount, txn_date, bank, remarks, created_by)
         VALUES ($1, $2, 0, $3, $4, 'Recorded via invoice payment', $5)
         RETURNING id`,
        [payment.payment_type, ref, payment.payment_date, payment.bank ?? null, payment.recorded_by ?? null],
      );
      newTxnId = created?.id ?? null;
    }
  }

  await tx.query(`UPDATE payments SET bank_txn_id = $1 WHERE id = $2`, [newTxnId, paymentId]);

  // Re-sum the cheque we just linked to and the one we moved away from.
  const affected = new Set<string>();
  if (newTxnId) affected.add(newTxnId);
  if (previousTxnId && previousTxnId !== newTxnId) affected.add(previousTxnId);
  for (const id of affected) {
    await resyncBankTxnAmount(tx, id);
  }
}

/**
 * Reset a bank_transaction's amount to the sum of its linked payments. A
 * transaction left with no payments is deleted (no orphan rows on the
 * reconciliation view). Used by {@link syncBankTxnForPayment} and by the
 * payment-reversal flow, which deletes payments and must re-tally the cheque
 * (a cheque covering several invoices only loses the reverted invoice's share).
 */
export async function resyncBankTxnAmount(tx: TxClient, txnId: string): Promise<void> {
  const agg = await tx.queryOne<{ cnt: string; total: string }>(
    `SELECT COUNT(*)::text AS cnt, COALESCE(SUM(amount + gst_added_amount), 0)::text AS total
       FROM payments WHERE bank_txn_id = $1`,
    [txnId],
  );
  if (!agg || Number(agg.cnt) === 0) {
    await tx.query(`DELETE FROM bank_transactions WHERE id = $1`, [txnId]);
    return;
  }
  await tx.query(`UPDATE bank_transactions SET txn_amount = $1 WHERE id = $2`, [agg.total, txnId]);
}

/**
 * Recompute and update the payment_status of a single invoice.
 */
export async function recomputeInvoiceStatus(invoiceId: string): Promise<string> {
  const result = await queryOne<StatusResult>(
    `UPDATE invoices
     SET payment_status = ${paymentStatusCase('invoices')},
         updated_at = NOW()
     WHERE id = $1
     RETURNING payment_status`,
    [invoiceId]
  );

  return result?.payment_status ?? 'Not Paid';
}

/**
 * Bulk-recompute payment_status for all non-deleted invoices.
 * Used after CSV imports, reconciliation batches, or backfills that touch many rows at once.
 */
export async function recomputeAllInvoiceStatuses(): Promise<void> {
  await query(
    `UPDATE invoices SET payment_status = ${paymentStatusCase('invoices')} WHERE deleted_at IS NULL`
  );
}
