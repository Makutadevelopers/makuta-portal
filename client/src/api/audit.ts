import { apiFetch } from './client';
import { AuditLog } from '../types/audit';

export function getAuditLogs(): Promise<AuditLog[]> {
  return apiFetch<AuditLog[]>('/audit');
}
