import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api/client';

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

export function useAgingCalc(site: string = 'All') {
  const [data, setData] = useState<AgingData>({ withinTerms: [], overdue: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<AgingData>(`/aging?site=${encodeURIComponent(site)}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load aging data');
    } finally {
      setLoading(false);
    }
  }, [site]);

  useEffect(() => { fetch(); }, [fetch]);

  return { ...data, loading, error, refresh: fetch };
}
