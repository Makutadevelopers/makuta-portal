import { useState, useEffect, useCallback } from 'react';
import { Invoice } from '../types/invoice';
import { getInvoices, getInvoice } from '../api/invoices';

export function useInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `background: true` re-fetches without flipping `loading`, so the current
  // rows stay on screen instead of blanking to a spinner. Used after an edit/
  // save so the list updates in place rather than flickering through a reload.
  const fetch = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) setLoading(true);
    setError(null);
    try {
      const data = await getInvoices();
      setInvoices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoices');
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const refresh = useCallback(() => fetch({ background: true }), [fetch]);

  // Patch a single row in place after an edit: re-fetch just that invoice
  // (with the server-computed balance/status/attachment_count) and swap it
  // into the list — no full reload, no flicker. If the row vanished server-side
  // (e.g. now out of scope), drop it locally. Falls back to a background
  // refresh on error so the list never silently diverges from the server.
  const patchInvoice = useCallback(async (id: string) => {
    try {
      const updated = await getInvoice(id);
      setInvoices(prev => {
        const idx = prev.findIndex(i => i.id === id);
        if (idx === -1) return [updated, ...prev];
        const next = prev.slice();
        next[idx] = updated;
        return next;
      });
    } catch {
      fetch({ background: true });
    }
  }, [fetch]);

  // Remove a row locally after a delete — no reload needed.
  const removeInvoice = useCallback((id: string) => {
    setInvoices(prev => prev.filter(i => i.id !== id));
  }, []);

  return { invoices, loading, error, refresh, patchInvoice, removeInvoice };
}
