import { useState, useEffect, useCallback } from 'react';
import { Site, listSites } from '../api/sites';
import { SITES } from '../utils/constants';

// Projects live in the DB (migration 053) so HO can open a new one from
// Project Master without a deploy. SITES (in constants.ts) is kept as the seed
// list — migration 053 seeds the same six names — and as a runtime fallback
// when the API call fails or hasn't returned yet, so a project dropdown never
// renders empty and a network blip can't silently narrow someone's options.
//
// `includeInactive` is used by the Project Master page (HO). Everything else
// (invoice forms, filters, petty cash) gets only active projects.
export function useSites(opts?: { includeInactive?: boolean }) {
  const includeInactive = opts?.includeInactive ?? false;
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listSites({ includeInactive });
      setSites(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => { refresh(); }, [refresh]);

  // Names of currently-active projects. Falls back to the static seed list
  // until the API responds so dropdowns are never empty.
  const names = sites.length > 0
    ? sites.filter(s => s.active).map(s => s.name)
    : SITES;

  return { sites, names, loading, error, refresh };
}
