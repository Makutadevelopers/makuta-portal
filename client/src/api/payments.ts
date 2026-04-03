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
