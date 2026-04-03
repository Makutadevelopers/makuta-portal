// payment.service.ts
// Handles payment insertion and automatic invoice status recomputation.
//
// Business rules:
// - sum(payments) = invoice_amount → 'Paid'
// - sum(payments) > 0 but < invoice_amount → 'Partial'
// - no payments → 'Not Paid'

import { queryOne } from '../db/query';

interface StatusResult {
  payment_status: string;
}

/**
 * Recompute and update the payment_status of an invoice
 * based on the sum of all its payments.
 */
export async function recomputeInvoiceStatus(invoiceId: string): Promise<string> {
  const result = await queryOne<StatusResult>(
    `UPDATE invoices
     SET payment_status = CASE
       WHEN (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = $1)
            >= invoice_amount THEN 'Paid'
       WHEN (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = $1)
            > 0 THEN 'Partial'
       ELSE 'Not Paid'
     END,
     updated_at = NOW()
     WHERE id = $1
     RETURNING payment_status`,
    [invoiceId]
  );

  return result?.payment_status ?? 'Not Paid';
}
