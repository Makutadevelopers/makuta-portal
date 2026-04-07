import { apiFetch } from './client';

export interface Alert {
  id: string;
  alert_type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  resolved: boolean;
  created_at: string;
}

export function getAlerts(): Promise<Alert[]> {
  return apiFetch<Alert[]>('/alerts');
}

export function getAlertCount(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>('/alerts/count');
}

export function resolveAlert(id: string): Promise<Alert> {
  return apiFetch<Alert>(`/alerts/${id}/resolve`, { method: 'POST' });
}
