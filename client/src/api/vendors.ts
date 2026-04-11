import { apiFetch } from './client';
import { Vendor } from '../types/vendor';

export interface VendorDetailStats {
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  oldestUnpaid: string | null;
}

export interface VendorDetailInvoice {
  id: string;
  invoice_date: string;
  invoice_no: string | null;
  po_number: string | null;
  purpose: string;
  site: string;
  invoice_amount: number;
  payment_status: string;
  balance: number;
}

export interface VendorDetailResponse {
  vendor: Vendor;
  stats: VendorDetailStats;
  invoices: VendorDetailInvoice[];
}

export function getVendorDetail(id: string): Promise<VendorDetailResponse> {
  return apiFetch<VendorDetailResponse>(`/vendors/${id}/detail`);
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

export function updateVendor(id: string, data: Partial<Vendor>): Promise<Vendor> {
  return apiFetch<Vendor>(`/vendors/${id}`, {
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

export function mergeVendors(keepId: string, removeId: string): Promise<Vendor> {
  return apiFetch<Vendor>('/vendors/merge', {
    method: 'POST',
    body: JSON.stringify({ keepId, removeId }),
  });
}
