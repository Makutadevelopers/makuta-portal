import { useState, useEffect, useCallback } from 'react';
import { Bank, listBanks } from '../api/banks';
import { BANKS } from '../utils/constants';

// Banks live in the DB so HO can add a new one without a deploy. BANKS
// (in constants.ts) is kept as the seed list — the DB is seeded with the
// same names by migration 026 — and as a runtime fallback when the API
// call fails (e.g. transient network blip) so the dropdown never renders
// empty.
//
// `includeInactive` is used by the Bank Master page (HO). Everything else
// (payment forms, etc.) gets only active banks.
export function useBanks(opts?: { includeInactive?: boolean }) {
  const includeInactive = opts?.includeInactive ?? false;
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listBanks({ includeInactive });
      setBanks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load banks');
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => { refresh(); }, [refresh]);

  // Names of currently-active banks, sorted A→Z. If the API hasn't
  // loaded yet, fall back to the static seed list so the dropdown
  // never renders empty.
  const names = banks.length > 0
    ? banks.filter(b => b.active).map(b => b.name).sort((a, b) => a.localeCompare(b))
    : [...BANKS].sort((a, b) => a.localeCompare(b));

  return { banks, names, loading, error, refresh };
}
