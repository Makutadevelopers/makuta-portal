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
