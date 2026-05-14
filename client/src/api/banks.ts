// Banks API — list + create + update. List is open to any authenticated
// role (payment dropdowns); create / update are HO-only on the server.

import { apiFetch } from './client';

export interface Bank {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface CreatedBank extends Bank {
  alreadyExisted?: boolean;
  reactivated?: boolean;
}

export function listBanks(opts?: { includeInactive?: boolean }): Promise<Bank[]> {
  const qs = opts?.includeInactive ? '?includeInactive=1' : '';
  return apiFetch<Bank[]>(`/banks${qs}`);
}

export function createBank(name: string): Promise<CreatedBank> {
  return apiFetch<CreatedBank>('/banks', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function updateBank(id: string, patch: { name?: string; active?: boolean }): Promise<Bank> {
  return apiFetch<Bank>(`/banks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
