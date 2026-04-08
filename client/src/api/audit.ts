import { apiFetch } from './client';
import { AuditLog } from '../types/audit';

export function getAuditLogs(): Promise<AuditLog[]> {
  return apiFetch<AuditLog[]>('/audit');
}

export function undoBatchImport(batchId: string): Promise<{ message: string; deleted: { invoices: number; payments: number; vendors: number } }> {
  return apiFetch(`/import/batch/${batchId}`, { method: 'DELETE' });
}
