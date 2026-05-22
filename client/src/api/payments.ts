import { apiFetch } from './client';
import { Payment, CreatePaymentData } from '../types/payment';

export function getPayments(invoiceId: string): Promise<Payment[]> {
  return apiFetch<Payment[]>(`/invoices/${invoiceId}/payments`);
}

export function createPayment(invoiceId: string, data: CreatePaymentData): Promise<Payment> {
  return apiFetch<Payment>(`/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updatePayment(invoiceId: string, paymentId: string, data: CreatePaymentData): Promise<Payment & { invoice_payment_status?: string }> {
  return apiFetch<Payment & { invoice_payment_status?: string }>(`/invoices/${invoiceId}/payments/${paymentId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// Reverse ALL payments on an invoice (cheque bounce / wrong entry) → Not Paid,
// recording a reason in the audit log. Server hard-deletes the payments and
// re-tallies any shared cheque.
export function revertPayments(invoiceId: string, reason: string): Promise<{ invoice_payment_status: string; reverted_count: number }> {
  return apiFetch<{ invoice_payment_status: string; reverted_count: number }>(`/invoices/${invoiceId}/payments/revert`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
