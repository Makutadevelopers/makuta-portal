import { apiFetch } from './client';

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

export function getAttachments(invoiceId: string): Promise<Attachment[]> {
  return apiFetch<Attachment[]>(`/invoices/${invoiceId}/attachments`);
}

export async function uploadAttachment(invoiceId: string, file: File): Promise<Attachment> {
  const formData = new FormData();
  formData.append('file', file);

  return apiFetch<Attachment>(`/invoices/${invoiceId}/attachments`, {
    method: 'POST',
    body: formData,
  });
}
