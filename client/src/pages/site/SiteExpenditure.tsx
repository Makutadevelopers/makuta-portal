import { useState, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useInvoices } from '../../hooks/useInvoices';
import { formatINR } from '../../utils/formatters';
import AppShell from '../../components/layout/AppShell';

type ViewMode = 'category' | 'vendor';

export default function SiteExpenditure() {
  const { user } = useAuth();
  const { invoices, loading } = useInvoices();
  const [view, setView] = useState<ViewMode>('category');
  const [fMonth, setFMonth] = useState('All');

  const months = useMemo(() => {
    const set = new Set(invoices.map(i => i.month?.slice(0, 7)));
    return Array.from(set).filter(Boolean).sort();
  }, [invoices]);

  const filtered = useMemo(() => {
    if (fMonth === 'All') return invoices;
    return invoices.filter(i => i.month?.startsWith(fMonth));
  }, [invoices, fMonth]);

  const grandTotal = filtered.reduce((s, i) => s + Number(i.invoice_amount), 0);
  const categoriesCount = new Set(filtered.map(i => i.purpose)).size;

  // Group by category or vendor
  const grouped = useMemo(() => {
    const key = view === 'category' ? 'purpose' : 'vendor_name';
    const map = new Map<string, { count: number; total: number }>();
    for (const inv of filtered) {
      const k = inv[key] as string;
      const existing = map.get(k) ?? { count: 0, total: 0 };
      existing.count++;
      existing.total += Number(inv.invoice_amount);
      map.set(k, existing);
    }
    return Array.from(map.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [filtered, view]);

  const maxTotal = Math.max(...grouped.map(g => g.total), 1);

  function monthLabel(ym: string): string {
    const [y, m] = ym.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Expenditure — {user?.site}</div>
          <div className="text-xs text-gray-500 mt-1">Invoice amounts for your site · payment details managed by Head Office</div>
        </div>
        <select value={fMonth} onChange={e => setFMonth(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
          <option value="All">All Months</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Total Invoiced</div>
              <div className="text-2xl font-semibold text-gray-900">{formatINR(grandTotal)}</div>
              <div className="text-xs text-gray-400 mt-1">{filtered.length} invoices submitted</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Categories</div>
              <div className="text-2xl font-semibold text-gray-900">{categoriesCount}</div>
              <div className="text-xs text-gray-400 mt-1">across {categoriesCount} material types</div>
            </div>
          </div>

          {/* Toggle */}
          <div className="flex items-center gap-2 mb-5">
            <button
              onClick={() => setView('category')}
              className={`px-4 py-2 text-sm rounded-lg font-medium ${view === 'category' ? 'bg-[#1a3c5e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              By Category
            </button>
            <button
              onClick={() => setView('vendor')}
              className={`px-4 py-2 text-sm rounded-lg font-medium ${view === 'vendor' ? 'bg-[#1a3c5e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              By Vendor
            </button>
          </div>

          {/* Grouped breakdown */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-sm font-medium text-gray-900">{view === 'category' ? 'Category-wise' : 'Vendor-wise'} expenditure</div>
            </div>
            <div className="px-5 py-3 space-y-4">
              {grouped.map(row => {
                const barW = (row.total / maxTotal) * 100;
                return (
                  <div key={row.name}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <span className="text-sm font-medium text-gray-900">{row.name}</span>
                        <span className="text-xs text-gray-400 ml-2">{row.count} inv.</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">{formatINR(row.total)}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-[#1a3c5e]" style={{ width: `${barW}%` }} />
                    </div>
                  </div>
                );
              })}
              {grouped.length === 0 && (
                <div className="py-5 text-center text-sm text-gray-400">No data</div>
              )}
            </div>
            {grouped.length > 0 && (
              <div className="px-5 py-3 border-t border-gray-200 flex justify-between">
                <span className="text-sm font-medium text-gray-900">Total</span>
                <span className="text-sm font-bold text-gray-900">{formatINR(grandTotal)}</span>
              </div>
            )}
          </div>

          {/* Disclaimer */}
          <div className="mt-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            Amounts shown are invoice values submitted from your site. Payment status, cashflow, and aging are managed exclusively by Head Office.
          </div>
        </>
      )}
    </AppShell>
  );
}
