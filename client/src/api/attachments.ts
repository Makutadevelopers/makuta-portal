import { apiFetch, getApiToken } from './client';

export interface Attachment {
  id: string;
  invoice_id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  s3_key: string;
  s3_bucket: string;
  uploaded_by: string | null;
  uploaded_at: string;
  url: string;
}

export async function getAttachments(invoiceId: string): Promise<Attachment[]> {
  const list = await apiFetch<Attachment[]>(`/invoices/${invoiceId}/attachments`);
  // Append JWT as ?token=... so the download URL works when opened directly in a browser tab
  const token = getApiToken();
  return list.map(att => ({
    ...att,
    url: token && att.url.startsWith('/api/') ? `${att.url}${att.url.includes('?') ? '&' : '?'}token=${token}` : att.url,
  }));
}

export async function uploadAttachment(invoiceId: string, file: File): Promise<Attachment> {
  const formData = new FormData();
  formData.append('file', file);

  return apiFetch<Attachment>(`/invoices/${invoiceId}/attachments`, {
    method: 'POST',
    body: formData,
  });
}

export function deleteAttachment(invoiceId: string, attachmentId: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/invoices/${invoiceId}/attachments/${attachmentId}`, {
    method: 'DELETE',
  });
}
