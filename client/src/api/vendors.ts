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
