import { useState, useEffect, useCallback } from 'react';
import { Category, listCategories, createCategory } from '../api/categories';
import { PURPOSES } from '../utils/constants';

// Categories live in the DB so anyone can add a new one without a deploy.
// PURPOSES (in constants.ts) is kept as the seed list — the DB is seeded
// with the same names by migration 025 — and as a runtime fallback when
// the API call fails (e.g. transient network blip).

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listCategories();
      setCategories(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Add a new category and refresh. Returns the persisted name (which may
  // differ in capitalisation from the input if a case-insensitive match
  // already exists).
  const add = useCallback(async (name: string): Promise<string> => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Category name is required');
    const created = await createCategory(trimmed);
    await refresh();
    return created.name;
  }, [refresh]);

  // Names sorted A→Z. If the API hasn't loaded yet, fall back to the
  // static seed list so the dropdown never renders empty.
  const names = categories.length > 0
    ? categories.map(c => c.name).sort((a, b) => a.localeCompare(b))
    : [...PURPOSES].sort((a, b) => a.localeCompare(b));

  return { categories, names, loading, error, refresh, add };
}
