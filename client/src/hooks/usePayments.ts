import { useState, useCallback } from 'react';
import { Payment } from '../types/payment';
import { getPayments } from '../api/payments';

export function usePayments(invoiceId: string | null) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getPayments(invoiceId);
      setPayments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  return { payments, loading, error, refresh: fetch };
}
