import { apiFetch } from '../api/client';
import { useCachedQuery } from './useCachedQuery';

interface AgingRow {
  invoice_id: string;
  invoice_no: string;
  vendor_name: string;
  site: string;
  invoice_date: string;
  invoice_amount: number;
  payment_terms: number;
  due_date: string;
  total_paid: number;
  balance: number;
  days_past_due: number;
  days_left: number;
  overdue: boolean;
  payment_status: string;
}

interface AgingData {
  withinTerms: AgingRow[];
  overdue: AgingRow[];
}

const EMPTY: AgingData = { withinTerms: [], overdue: [] };

export function useAgingCalc(site: string = 'All') {
  // Shared SWR cache keyed per-site: switching back to a site you already
  // viewed renders instantly while revalidating. Focus-refresh keeps it current;
  // the background poll is a slow safety net (2 min) rather than a tight 20s loop.
  // The spinner only shows on the very first load of a given site.
  const key = `/aging?site=${encodeURIComponent(site)}`;
  const { data, loading, error, refresh } = useCachedQuery<AgingData>(
    key,
    () => apiFetch<AgingData>(key),
    { pollMs: 120_000 },
  );
  const aging = data ?? EMPTY;
  return { ...aging, loading, error: error?.message ?? null, refresh };
}
