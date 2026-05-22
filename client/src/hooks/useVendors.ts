import { Vendor } from '../types/vendor';
import { getVendors } from '../api/vendors';
import { useCachedQuery } from './useCachedQuery';

const KEY = '/vendors';

export function useVendors() {
  // Vendors change rarely, so a lighter 60s poll (plus focus refresh and the
  // shared SWR cache for instant revisits) is plenty. `refresh()` after a
  // mutation forces an immediate revalidation for every page on this key.
  const { data, loading, error, refresh } = useCachedQuery<Vendor[]>(
    KEY,
    getVendors,
    { pollMs: 60_000 },
  );
  return { vendors: data ?? [], loading, error: error?.message ?? null, refresh };
}
