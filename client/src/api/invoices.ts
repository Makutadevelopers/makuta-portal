import { apiFetch } from './client';
import { Invoice, CreateInvoiceData } from '../types/invoice';

export function getInvoices(): Promise<Invoice[]> {
  return apiFetch<Invoice[]>('/invoices');
}

export function createInvoice(data: CreateInvoiceData): Promise<Invoice> {
  return apiFetch<Invoice>('/invoices', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateInvoice(id: string, data: Partial<CreateInvoiceData>): Promise<Invoice> {
  return apiFetch<Invoice>(`/invoices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function pushInvoice(id: string): Promise<Invoice> {
  return apiFetch<Invoice>(`/invoices/${id}/push`, { method: 'POST' });
}
