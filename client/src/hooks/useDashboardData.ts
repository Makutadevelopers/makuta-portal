import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../api/client';
import { Invoice } from '../types/invoice';
import { CashflowRow } from '../types/cashflow';

// ── Aging types (mirrors server response) ──────────────────────────────────
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

// ── Dashboard-specific derived types ────────────────────────────────────────
export interface Kpis {
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  partPaidCount: number;
  invoiceCount: number;
}

export interface SiteRow {
  site: string;
  invoiceCount: number;
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  overdue: number;
  settlementPct: number;
}

export interface DueSoonRow {
  invoiceId: string;
  invoiceNo: string;
  vendorName: string;
  site: string;
  dueDate: string;
  balance: number;
  daysLeft: number;
}

export interface VendorOverdue {
  vendorName: string;
  invoiceCount: number;
  maxDaysPastDue: number;
  totalBalance: number;
}

export interface CategorySpend {
  purpose: string;
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
}

export interface MonthTrend {
  month: string;
  totalInvoiced: number;
  totalPaid: number;
  gap: number;
}

export interface DashboardData {
  kpis: Kpis;
  siteRows: SiteRow[];
  dueSoon: DueSoonRow[];
  overdueByVendor: VendorOverdue[];
  spendByCategory: CategorySpend[];
  monthlyTrend: MonthTrend[];
  loading: boolean;
  error: string | null;
}

const EMPTY: DashboardData = {
  kpis: { totalInvoiced: 0, totalPaid: 0, outstanding: 0, overdueAmount: 0, overdueCount: 0, partPaidCount: 0, invoiceCount: 0 },
  siteRows: [],
  dueSoon: [],
  overdueByVendor: [],
  spendByCategory: [],
  monthlyTrend: [],
  loading: true,
  error: null,
};

function n(v: unknown): number {
  return Number(v) || 0;
}

function derive(
  aging: AgingData,
  cashflow: CashflowRow[],
  invoices: Invoice[],
  allAging?: AgingData,
): Omit<DashboardData, 'loading' | 'error'> {
  // Use full aging for outstanding/overdue KPIs (never filtered)
  const fullAging = allAging ?? aging;
  const fullAgingRows = [...fullAging.withinTerms, ...fullAging.overdue];
  const allAgingRows = [...aging.withinTerms, ...aging.overdue];

  // ── KPIs ────────────────────────────────────────────────────────────────
  // Total invoiced / paid: from filtered invoices
  const totalInvoiced = invoices.reduce((s, i) => s + n(i.invoice_amount), 0);
  const paidInvoiceTotal = invoices
    .filter(i => i.payment_status === 'Paid')
    .reduce((s, i) => s + n(i.invoice_amount), 0);
  // L5: aging only returns Not Paid + Partial rows (see aging.service.ts WHERE clause).
  // We explicitly filter again here so any future change to the endpoint can't silently
  // cause fully-paid rows to be double-counted in the Total Paid KPI.
  const agingPaidTotal = fullAgingRows
    .filter(r => r.payment_status !== 'Paid')
    .reduce((s, r) => s + n(r.total_paid), 0);
  const totalPaid = paidInvoiceTotal + agingPaidTotal;

  // Outstanding / overdue: always from full (unfiltered) aging — live operational metrics
  const outstanding = fullAgingRows.reduce((s, r) => s + n(r.balance), 0);
  const overdueAmount = fullAging.overdue.reduce((s, r) => s + n(r.balance), 0);
  const overdueCount = fullAging.overdue.length;
  const partPaidCount = fullAgingRows.filter(r => r.payment_status === 'Partial').length;

  const kpis: Kpis = {
    totalInvoiced,
    totalPaid,
    outstanding,
    overdueAmount,
    overdueCount,
    partPaidCount,
    invoiceCount: invoices.length,
  };

  // ── Site-wise rows ──────────────────────────────────────────────────────
  const siteMap = new Map<string, { invoiceCount: number; totalInvoiced: number; agingBalance: number; agingPaid: number; overdueBalance: number }>();

  for (const inv of invoices) {
    const entry = siteMap.get(inv.site) ?? { invoiceCount: 0, totalInvoiced: 0, agingBalance: 0, agingPaid: 0, overdueBalance: 0 };
    entry.invoiceCount++;
    entry.totalInvoiced += n(inv.invoice_amount);
    siteMap.set(inv.site, entry);
  }
  for (const row of allAgingRows) {
    const entry = siteMap.get(row.site);
    if (entry) {
      entry.agingBalance += n(row.balance);
      entry.agingPaid += n(row.total_paid);
    }
  }
  for (const row of aging.overdue) {
    const entry = siteMap.get(row.site);
    if (entry) {
      entry.overdueBalance += n(row.balance);
    }
  }

  const siteRows: SiteRow[] = Array.from(siteMap.entries())
    .map(([site, d]) => {
      const sitePaid = d.totalInvoiced - d.agingBalance;
      // agingBalance covers only unpaid/partial invoices; for paid invoices, balance=0
      // so total_paid = total_invoiced - remaining balance
      return {
        site,
        invoiceCount: d.invoiceCount,
        totalInvoiced: d.totalInvoiced,
        totalPaid: sitePaid,
        outstanding: d.agingBalance,
        overdue: d.overdueBalance,
        settlementPct: d.totalInvoiced > 0 ? Math.round((sitePaid / d.totalInvoiced) * 100) : 0,
      };
    })
    .filter(r => r.totalInvoiced > 0)
    .sort((a, b) => b.outstanding - a.outstanding);

  // ── Due in next 15 days ─────────────────────────────────────────────────
  const dueSoon: DueSoonRow[] = aging.withinTerms
    .filter(r => n(r.days_left) >= 0 && n(r.days_left) <= 15)
    .sort((a, b) => n(a.days_left) - n(b.days_left))
    .map(r => ({
      invoiceId: r.invoice_id,
      invoiceNo: r.invoice_no,
      vendorName: r.vendor_name,
      site: r.site,
      dueDate: r.due_date,
      balance: n(r.balance),
      daysLeft: n(r.days_left),
    }));

  // ── Overdue by vendor ───────────────────────────────────────────────────
  const vendorMap = new Map<string, { count: number; maxDays: number; balance: number }>();
  for (const row of aging.overdue) {
    const entry = vendorMap.get(row.vendor_name) ?? { count: 0, maxDays: 0, balance: 0 };
    entry.count++;
    entry.maxDays = Math.max(entry.maxDays, n(row.days_past_due));
    entry.balance += n(row.balance);
    vendorMap.set(row.vendor_name, entry);
  }
  const overdueByVendor: VendorOverdue[] = Array.from(vendorMap.entries())
    .map(([vendorName, d]) => ({
      vendorName,
      invoiceCount: d.count,
      maxDaysPastDue: d.maxDays,
      totalBalance: d.balance,
    }))
    .sort((a, b) => b.totalBalance - a.totalBalance);

  // ── Spend by category ───────────────────────────────────────────────────
  const catMap = new Map<string, { invoiced: number; paid: number }>();
  for (const row of cashflow) {
    const entry = catMap.get(row.purpose) ?? { invoiced: 0, paid: 0 };
    entry.invoiced += n(row.total_invoiced);
    entry.paid += n(row.total_paid);
    catMap.set(row.purpose, entry);
  }
  const spendByCategory: CategorySpend[] = Array.from(catMap.entries())
    .map(([purpose, d]) => ({
      purpose,
      totalInvoiced: d.invoiced,
      totalPaid: d.paid,
      outstanding: d.invoiced - d.paid,
    }))
    .sort((a, b) => b.totalInvoiced - a.totalInvoiced);

  // ── Monthly trend ───────────────────────────────────────────────────────
  const monthMap = new Map<string, { invoiced: number; paid: number }>();
  for (const row of cashflow) {
    const entry = monthMap.get(row.month) ?? { invoiced: 0, paid: 0 };
    entry.invoiced += n(row.total_invoiced);
    entry.paid += n(row.total_paid);
    monthMap.set(row.month, entry);
  }
  const monthlyTrend: MonthTrend[] = Array.from(monthMap.entries())
    .map(([month, d]) => ({
      month,
      totalInvoiced: d.invoiced,
      totalPaid: d.paid,
      gap: d.invoiced - d.paid,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return { kpis, siteRows, dueSoon, overdueByVendor, spendByCategory, monthlyTrend };
}

interface RawData {
  aging: AgingData;
  cashflow: CashflowRow[];
  invoices: Invoice[];
}

export function useDashboardData(dateRange?: { from: string; to: string } | null): DashboardData {
  const [raw, setRaw] = useState<RawData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch once on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [aging, cashflow, invoices] = await Promise.all([
          apiFetch<AgingData>('/aging?site=All'),
          apiFetch<{ expenditure: { month: string; purpose: string; total: number }[]; cashflow: { month: string; purpose: string; total: number }[] }>('/cashflow').then(res => {
            // Merge expenditure + cashflow into CashflowRow[] for dashboard compatibility
            const merged = new Map<string, CashflowRow>();
            for (const r of res.expenditure) {
              const key = `${r.month}|${r.purpose}`;
              if (!merged.has(key)) merged.set(key, { month: r.month, purpose: r.purpose, total_invoiced: 0, total_paid: 0, invoice_count: 0 });
              merged.get(key)!.total_invoiced += Number(r.total);
            }
            for (const r of res.cashflow) {
              const key = `${r.month}|${r.purpose}`;
              if (!merged.has(key)) merged.set(key, { month: r.month, purpose: r.purpose, total_invoiced: 0, total_paid: 0, invoice_count: 0 });
              merged.get(key)!.total_paid += Number(r.total);
            }
            return Array.from(merged.values());
          }),
          apiFetch<Invoice[]>('/invoices'),
        ]);
        if (!cancelled) {
          setRaw({ aging, cashflow, invoices });
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Derive from raw data, filtering by date range
  const data = useMemo<DashboardData>(() => {
    if (loading || !raw) return { ...EMPTY, loading, error };

    let { aging, cashflow, invoices } = raw;

    if (dateRange && (dateRange.from || dateRange.to)) {
      const inRange = (d: string) => {
        const ds = (d || '').slice(0, 10);
        if (dateRange.from && ds < dateRange.from) return false;
        if (dateRange.to && ds > dateRange.to) return false;
        return true;
      };

      // Filter invoices by invoice_date (what was raised in this period)
      invoices = invoices.filter(i => inRange(i.invoice_date));

      // Cashflow by month
      cashflow = cashflow.filter(r => inRange(r.month));

      // IMPORTANT: Aging (outstanding/overdue/due soon) is NOT filtered
      // It always shows the current live state regardless of date filter.
      // This is because outstanding/overdue are real-time operational metrics.
    }

    // Pass full (unfiltered) aging as 4th arg so outstanding/overdue KPIs always show live state
    const derived = derive(aging, cashflow, invoices, raw.aging);
    return { ...derived, loading: false, error: null };
  }, [raw, loading, error, dateRange?.from, dateRange?.to]);

  return data;
}
