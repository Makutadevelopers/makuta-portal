// Projects (sites) API — list + create + update. List is open to any
// authenticated role (invoice / credit-note / petty-cash dropdowns);
// create and update are HO-only on the server.

import { apiFetch } from './client';

export interface SiteUsage {
  invoices: number;
  creditNotes: number;
  pettyCash: number;
  users: number;
}

export interface Site {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  /** Only present on the HO management listing (includeInactive=1). */
  usage?: SiteUsage;
}

export interface CreatedSite extends Site {
  alreadyExisted?: boolean;
  reactivated?: boolean;
}

/** Rows moved by a rename, keyed by table. Returned only when a rename ran. */
export type RenameMoved = Record<string, number>;

export interface UpdatedSite extends Site {
  moved?: RenameMoved;
}

export function listSites(opts?: { includeInactive?: boolean }): Promise<Site[]> {
  const qs = opts?.includeInactive ? '?includeInactive=1' : '';
  return apiFetch<Site[]>(`/sites${qs}`);
}

export function createSite(name: string): Promise<CreatedSite> {
  return apiFetch<CreatedSite>('/sites', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function updateSite(
  id: string,
  patch: { name?: string; active?: boolean; confirmArchiveWithData?: boolean }
): Promise<UpdatedSite> {
  return apiFetch<UpdatedSite>(`/sites/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
