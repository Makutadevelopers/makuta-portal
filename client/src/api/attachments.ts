import { apiFetch, getApiToken, getApiOrigin } from './client';

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
  downloadUrl: string;
}

// S3-stored attachments come back with an absolute presigned URL — leave those alone
// (appending anything to them, including a ?token=, would invalidate the signature).
// Local-disk attachments come back with a relative `/api/...` path; the browser would
// resolve that against the Vercel origin (which doesn't host the API), so prepend the
// API origin and append the JWT as ?token=... so <img src=...> and direct-tab opens work.
function resolveAttachmentUrl(url: string, token: string | null, origin: string): string {
  if (!url.startsWith('/api/')) return url;
  const sep = url.includes('?') ? '&' : '?';
  const tokenSuffix = token ? `${sep}token=${token}` : '';
  return `${origin}${url}${tokenSuffix}`;
}

export async function getAttachments(invoiceId: string): Promise<Attachment[]> {
  const list = await apiFetch<Attachment[]>(`/invoices/${invoiceId}/attachments`);
  const token = getApiToken();
  const origin = getApiOrigin();
  return list.map(att => ({
    ...att,
    url: resolveAttachmentUrl(att.url, token, origin),
    downloadUrl: resolveAttachmentUrl(att.downloadUrl, token, origin),
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
