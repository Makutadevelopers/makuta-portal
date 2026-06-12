import { apiFetch, getApiToken, getApiOrigin } from './client';
import { Vendor } from '../types/vendor';

export interface VendorDetailStats {
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  oldestUnpaid: string | null;
}

export interface VendorDetailAttachment {
  id: string;
  invoice_id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  url: string;
  uploaded_at: string;
}

export interface VendorDetailPayment {
  id: string;
  invoice_id: string;
  payment_date: string;
  payment_type: string;
  payment_ref: string | null;
  bank: string | null;
  amount: number;
  tds_pct: number;
  tds_amount: number;
}

export interface VendorDetailInvoice {
  id: string;
  invoice_date: string;
  invoice_no: string | null;
  po_number: string | null;
  purpose: string;
  site: string;
  invoice_amount: number;
  base_amount: number | string | null;
  payment_status: string;
  balance: number;
  last_paid_date: string | null;
  attachments: VendorDetailAttachment[];
  payments: VendorDetailPayment[];
}

export interface VendorDetailResponse {
  vendor: Vendor;
  stats: VendorDetailStats;
  invoices: VendorDetailInvoice[];
}

export async function getVendorDetail(id: string): Promise<VendorDetailResponse> {
  const data = await apiFetch<VendorDetailResponse>(`/vendors/${id}/detail`);
  // Local-disk attachments come back with a relative `/api/...` path; the browser would
  // resolve that against the Vercel origin (which doesn't host the API), so prepend the
  // API origin and append the JWT as ?token=... so direct-tab opens work.
  const token = getApiToken();
  const origin = getApiOrigin();
  data.invoices = data.invoices.map(inv => ({
    ...inv,
    // Server may not yet expose payments (older deploy) — default to [] so the UI doesn't crash.
    payments: inv.payments ?? [],
    // Server may not yet expose attachments (older deploy) — default to [] so the UI doesn't crash.
    attachments: (inv.attachments ?? []).map(att => {
      if (!att.url.startsWith('/api/')) return att;
      const sep = att.url.includes('?') ? '&' : '?';
      const tokenSuffix = token ? `${sep}token=${token}` : '';
      return { ...att, url: `${origin}${att.url}${tokenSuffix}` };
    }),
  }));
  return data;
}

export function getVendors(): Promise<Vendor[]> {
  return apiFetch<Vendor[]>('/vendors');
}

export function createVendor(data: Partial<Vendor>): Promise<Vendor> {
  return apiFetch<Vendor>('/vendors', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export interface UpdateVendorResponse extends Vendor {
  invoicesRecategorised?: number;
}

export function updateVendor(id: string, data: Partial<Vendor>): Promise<UpdateVendorResponse> {
  return apiFetch<UpdateVendorResponse>(`/vendors/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteVendor(id: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/vendors/${id}`, { method: 'DELETE' });
}

export function getSimilarVendors(name: string): Promise<{ id: string; name: string; similarity: string }[]> {
  return apiFetch<{ id: string; name: string; similarity: string }[]>(
    `/vendors/similar?name=${encodeURIComponent(name)}`
  );
}

export interface DuplicatePair {
  vendorA: { id: string; name: string };
  vendorB: { id: string; name: string };
  reason: string;
}

export function getDuplicateVendors(): Promise<DuplicatePair[]> {
  return apiFetch<DuplicatePair[]>('/vendors/duplicates');
}

export function dismissDuplicateVendorPair(vendorAId: string, vendorBId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/vendors/duplicates/dismiss', {
    method: 'POST',
    body: JSON.stringify({ vendorAId, vendorBId }),
  });
}

export interface MergeVendorsResponse extends Vendor {
  mergeId: string;
  repointedCount: number;
  collapsedDuplicates: number;
  removedName: string;
}

export function mergeVendors(keepId: string, removeId: string): Promise<MergeVendorsResponse> {
  return apiFetch<MergeVendorsResponse>('/vendors/merge', {
    method: 'POST',
    body: JSON.stringify({ keepId, removeId }),
  });
}

export interface VendorMerge {
  id: string;
  kept_vendor_id: string;
  removed_vendor_id: string;
  removed_vendor_name: string;
  kept_vendor_name: string | null;
  invoice_count: number;
  merged_by: string | null;
  merged_by_name: string | null;
  merged_at: string;
  reverted_at: string | null;
  reverted_by: string | null;
}

export function getVendorMerges(includeReverted = false): Promise<VendorMerge[]> {
  const q = includeReverted ? '?includeReverted=true' : '';
  return apiFetch<VendorMerge[]>(`/vendors/merges${q}`);
}

export function revertVendorMerge(mergeId: string): Promise<{
  ok: true;
  restoredVendor: Vendor;
  restoredInvoiceCount: number;
}> {
  return apiFetch(`/vendors/merges/${mergeId}/revert`, { method: 'POST' });
}
