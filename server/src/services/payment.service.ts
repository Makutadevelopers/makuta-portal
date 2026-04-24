// payment.service.ts
// Handles payment insertion and automatic invoice status recomputation.
//
// Business rules (effective payable = invoice_amount − sum(credit note allocations)):
// - sum(payments) ≥ effective_payable → 'Paid'
// - sum(payments) > 0 OR sum(CN allocations) > 0 (but effective not met) → 'Partial'
// - nothing → 'Not Paid'

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
  return `CASE
    WHEN (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = ${alias}.id)
         >= ${alias}.invoice_amount
            - (SELECT COALESCE(SUM(allocated_amount), 0) FROM credit_note_allocations WHERE invoice_id = ${alias}.id)
      THEN 'Paid'
    WHEN (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = ${alias}.id) > 0
      OR (SELECT COALESCE(SUM(allocated_amount), 0) FROM credit_note_allocations WHERE invoice_id = ${alias}.id) > 0
      THEN 'Partial'
    ELSE 'Not Paid'
  END`;
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
