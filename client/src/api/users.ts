import { apiFetch } from './client';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: 'ho' | 'site' | 'mgmt';
  site: string | null;
  title: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function getUsers(): Promise<UserRecord[]> {
  return apiFetch('/users');
}

export function createUser(data: {
  name: string;
  email: string;
  password: string;
  role: string;
  site: string | null;
  title: string | null;
}): Promise<UserRecord> {
  return apiFetch('/users', { method: 'POST', body: JSON.stringify(data) });
}

export function updateUser(id: string, data: Partial<{
  name: string;
  email: string;
  role: string;
  site: string | null;
  title: string | null;
  is_active: boolean;
}>): Promise<UserRecord> {
  return apiFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function resetUserPassword(id: string, newPassword: string): Promise<{ message: string }> {
  return apiFetch(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword }) });
}
