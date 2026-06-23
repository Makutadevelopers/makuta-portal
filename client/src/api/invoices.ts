import { apiFetch } from './client';
import { Invoice, CreateInvoiceData, DisputeSeverity, InvoiceLineItem } from '../types/invoice';

export function getInvoices(): Promise<Invoice[]> {
  return apiFetch<Invoice[]>('/invoices');
}

// Additional line items for one invoice. Returns [] for legacy invoices that
// only have the single additional_charge column (callers fall back to that).
export function getInvoiceLineItems(id: string): Promise<InvoiceLineItem[]> {
  return apiFetch<InvoiceLineItem[]>(`/invoices/${id}/line-items`);
}

// Single invoice with the same computed shape the list returns. Used to patch
// one row after an edit instead of re-fetching the whole list.
export function getInvoice(id: string): Promise<Invoice> {
  return apiFetch<Invoice>(`/invoices/${id}`);
}

export function createInvoice(data: CreateInvoiceData): Promise<Invoice> {
  return apiFetch<Invoice>('/invoices', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export interface BatchInvoiceResult {
  index: number;
  ok: boolean;
  invoice_id?: string;
  error?: { code?: string; message: string; existing?: unknown };
}

export interface BatchInvoiceResponse {
  created: number;
  failed: number;
  results: BatchInvoiceResult[];
}

export function createInvoiceBatch(body: {
  vendor_id: string;
  vendor_name: string;
  site: string;
  invoices: CreateInvoiceData[];
}): Promise<BatchInvoiceResponse> {
  return apiFetch<BatchInvoiceResponse>('/invoices/batch', {
    method: 'POST',
    body: JSON.stringify(body),
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

export function markInvoiceDisputed(
  id: string,
  severity: DisputeSeverity,
  reason: string,
): Promise<Invoice> {
  return apiFetch<Invoice>(`/invoices/${id}/dispute`, {
    method: 'POST',
    body: JSON.stringify({ severity, reason }),
  });
}

export function clearInvoiceDispute(id: string, reason?: string): Promise<Invoice> {
  return apiFetch<Invoice>(`/invoices/${id}/dispute`, {
    method: 'DELETE',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

export function bulkFinalizeInvoices(ids: string[]): Promise<{ finalized: number; total: number }> {
  return apiFetch('/invoices/bulk-finalize', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export function bulkDeleteInvoices(ids: string[]): Promise<{ deleted: number; total: number }> {
  return apiFetch('/invoices/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export interface RecomputeStatusesResult {
  total: number;
  changed: number;
  counts: { Paid?: number; Partial?: number; 'Not Paid'?: number };
}

export function recomputeInvoiceStatuses(): Promise<RecomputeStatusesResult> {
  return apiFetch('/invoices/recompute-statuses', { method: 'POST' });
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
