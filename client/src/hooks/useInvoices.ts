import { useCallback } from 'react';
import { Invoice } from '../types/invoice';
import { getInvoices, getInvoice } from '../api/invoices';
import { useCachedQuery, setQueryData } from './useCachedQuery';

const KEY = '/invoices';

export function useInvoices() {
  // Shared SWR cache: revisiting any invoice-backed page renders instantly from
  // cache while revalidating in the background. Focus-refresh + post-mutation
  // invalidation keep this current; the background poll is a slow safety net
  // (2 min) — a tight 20s poll re-rendered the whole list every 20s and added
  // needless API load. Every page reading this key shares one copy.
  const { data, loading, error, refresh } = useCachedQuery<Invoice[]>(
    KEY,
    getInvoices,
    { pollMs: 120_000 },
  );
  const invoices = data ?? [];
  const errMsg = error?.message ?? null;

  // Patch a single row in place after an edit: re-fetch just that invoice
  // (with the server-computed balance/status/attachment_count) and swap it into
  // the shared cache — no full reload, no flicker, and every page on this key
  // updates at once. If the row vanished server-side (e.g. now out of scope),
  // drop it locally. Falls back to a background refresh on error so the list
  // never silently diverges from the server.
  const patchInvoice = useCallback(async (id: string) => {
    try {
      const updated = await getInvoice(id);
      setQueryData<Invoice[]>(KEY, (prev) => {
        const list = prev ?? [];
        const idx = list.findIndex((i) => i.id === id);
        if (idx === -1) return [updated, ...list];
        const next = list.slice();
        next[idx] = updated;
        return next;
      });
    } catch {
      refresh();
    }
  }, [refresh]);

  // Remove a row from the shared cache after a delete — no reload needed.
  const removeInvoice = useCallback((id: string) => {
    setQueryData<Invoice[]>(KEY, (prev) => (prev ?? []).filter((i) => i.id !== id));
  }, []);

  return { invoices, loading, error: errMsg, refresh, patchInvoice, removeInvoice };
}
