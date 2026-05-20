import { apiFetch } from './client';

export interface AnalyticsMonthly {
  month: string; // 'YYYY-MM'
  invoiceCount: number;
  totalInvoiced: number;
  totalPaid: number;
  balance: number;
}

export interface AnalyticsVendor {
  vendorName: string;
  invoiceCount: number;
  totalInvoiced: number;
  clearedCount: number;
  totalCleared: number;
  balance: number;
}

export interface AnalyticsResponse {
  monthly: AnalyticsMonthly[];
  vendors: AnalyticsVendor[];
  availableMonths: string[];
}

export function getAnalytics(site: string, month: string): Promise<AnalyticsResponse> {
  const params = new URLSearchParams();
  if (site && site !== 'All') params.set('site', site);
  if (month && month !== 'All') params.set('month', month);
  const qs = params.toString();
  return apiFetch<AnalyticsResponse>(`/analytics${qs ? `?${qs}` : ''}`);
}
