import { apiFetch } from './client';
import { Vendor } from '../types/vendor';

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
