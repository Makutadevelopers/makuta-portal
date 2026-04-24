import { apiFetch, getApiToken } from './client';
import {
  CreditNote,
  CreateCreditNoteData,
  VendorCreditBalance,
  InvoiceCreditSuggestions,
} from '../types/creditNote';

export function getCreditNotes(): Promise<CreditNote[]> {
  return apiFetch<CreditNote[]>('/credit-notes');
}

export function getCreditNote(id: string): Promise<CreditNote> {
  return apiFetch<CreditNote>(`/credit-notes/${id}`);
}

export function createCreditNote(data: CreateCreditNoteData): Promise<CreditNote> {
  return apiFetch<CreditNote>('/credit-notes', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateCreditNote(id: string, data: Partial<CreateCreditNoteData>): Promise<CreditNote> {
  return apiFetch<CreditNote>(`/credit-notes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteCreditNote(id: string): Promise<{ message: string }> {
  return apiFetch(`/credit-notes/${id}`, { method: 'DELETE' });
}

export function addAllocation(
  cnId: string,
  data: { invoice_id: string; allocated_amount: number }
): Promise<{ message: string }> {
  return apiFetch(`/credit-notes/${cnId}/allocations`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function removeAllocation(cnId: string, allocId: string): Promise<{ message: string }> {
  return apiFetch(`/credit-notes/${cnId}/allocations/${allocId}`, { method: 'DELETE' });
}

export function getVendorCreditBalance(vendorId: string): Promise<VendorCreditBalance> {
  return apiFetch<VendorCreditBalance>(`/credit-notes/vendor/${vendorId}/balance`);
}

export function getInvoiceCreditSuggestions(invoiceId: string): Promise<InvoiceCreditSuggestions> {
  return apiFetch<InvoiceCreditSuggestions>(`/credit-notes/invoice/${invoiceId}/suggestions`);
}

// ── Attachments ────────────────────────────────────────────
export interface CreditNoteAttachment {
  id: string;
  credit_note_id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  s3_key: string;
  s3_bucket: string;
  uploaded_by: string | null;
  uploaded_at: string;
  url: string;
}

export async function getCreditNoteAttachments(cnId: string): Promise<CreditNoteAttachment[]> {
  const list = await apiFetch<CreditNoteAttachment[]>(`/credit-notes/${cnId}/attachments`);
  const token = getApiToken();
  return list.map((att) => ({
    ...att,
    url: token && att.url.startsWith('/api/') ? `${att.url}${att.url.includes('?') ? '&' : '?'}token=${token}` : att.url,
  }));
}

export function uploadCreditNoteAttachment(cnId: string, file: File): Promise<CreditNoteAttachment> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch<CreditNoteAttachment>(`/credit-notes/${cnId}/attachments`, {
    method: 'POST',
    body: formData,
  });
}

export function deleteCreditNoteAttachment(cnId: string, attachmentId: string): Promise<{ message: string }> {
  return apiFetch(`/credit-notes/${cnId}/attachments/${attachmentId}`, { method: 'DELETE' });
}
