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

export function undoPushInvoice(id: string): Promise<Invoice> {
  return apiFetch<Invoice>(`/invoices/${id}/undo-push`, { method: 'POST' });
}

export function deleteInvoice(id: string): Promise<{ message: string }> {
  return apiFetch(`/invoices/${id}`, { method: 'DELETE' });
}

export function getBinInvoices(): Promise<(Invoice & { deleted_by_name: string | null })[]> {
  return apiFetch('/invoices/bin');
}

export function restoreInvoice(id: string): Promise<Invoice> {
  return apiFetch(`/invoices/bin/${id}/restore`, { method: 'POST' });
}

export function permanentDeleteInvoice(id: string): Promise<{ message: string }> {
  return apiFetch(`/invoices/bin/${id}`, { method: 'DELETE' });
}

export function purgeBin(): Promise<{ purged: number }> {
  return apiFetch('/invoices/bin/purge', { method: 'POST' });
}

export function bulkFinalizeInvoices(ids: string[]): Promise<{ finalized: number; total: number }> {
  return apiFetch('/invoices/bulk-finalize', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export interface AuditLogEntry {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  invoice_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function getInvoiceHistory(invoiceId: string): Promise<AuditLogEntry[]> {
  return apiFetch<AuditLogEntry[]>(`/audit/invoice/${invoiceId}`);
}
