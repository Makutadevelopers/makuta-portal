// Categories API — list + create. Anyone authenticated can add.

import { apiFetch } from './client';

export interface Category {
  id: string;
  name: string;
  created_at: string;
  created_by: string | null;
}

export interface CreatedCategory extends Category {
  alreadyExisted?: boolean;
}

export function listCategories(): Promise<Category[]> {
  return apiFetch<Category[]>('/categories');
}

export function createCategory(name: string): Promise<CreatedCategory> {
  return apiFetch<CreatedCategory>('/categories', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}
