import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../api/client';
import { formatINR } from '../../utils/formatters';
import { SITES } from '../../utils/constants';
import AppShell from '../../components/layout/AppShell';

interface PivotRow {
  month: string;
  purpose: string;
  total: number;
}

interface CashflowResponse {
  expenditure: PivotRow[];
  cashflow: PivotRow[];
}

export default function CashflowPage() {
  const [data, setData] = useState<CashflowResponse>({ expenditure: [], cashflow: [] });
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<'expenditure' | 'cashflow'>('expenditure');
  const [fSite, setFSite] = useState('All');
  const [fCategory, setFCategory] = useState('All');

  const drillByVendor = fCategory !== 'All';

  // Populate the category dropdown once from the unfiltered response
  useEffect(() => {
    apiFetch<CashflowResponse>('/cashflow').then(res => {
      const cats = new Set(res.expenditure.map(r => r.purpose));
      setAllCategories(Array.from(cats).sort());
    });
  }, []);

  // Re-fetch whenever site OR category changes
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fSite !== 'All') params.set('site', fSite);
    if (fCategory !== 'All') params.set('category', fCategory);
    const qs = params.toString();
    apiFetch<CashflowResponse>(`/cashflow${qs ? `?${qs}` : ''}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [fSite, fCategory]);

  const rows = activeTab === 'expenditure' ? data.expenditure : data.cashflow;

  const months = useMemo(() => {
    const set = new Set(rows.map(r => r.month));
    return Array.from(set).sort();
  }, [rows]);

  const pivot = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!map.has(r.purpose)) map.set(r.purpose, new Map());
      map.get(r.purpose)!.set(r.month, (map.get(r.purpose)!.get(r.month) ?? 0) + Number(r.total));
    }
    return map;
  }, [rows]);

  function monthLabel(ym: string): string {
    const [y, m] = ym.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[parseInt(m, 10) - 1]} ${y.slice(2)}`;
  }

  const cats = Array.from(pivot.keys()).sort();
  const totals = months.map(m => cats.reduce((s, c) => s + (pivot.get(c)?.get(m) ?? 0), 0));
  const grandTotal = totals.reduce((s, v) => s + v, 0);
  const isEmpty = cats.length === 0 || grandTotal === 0;

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Cashflow & Expenditure</div>
          <div className="text-xs text-gray-500 mt-1">
            {activeTab === 'expenditure'
              ? 'Monthly breakdown by accounting month'
              : 'Monthly breakdown by accounting month'}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={fSite} onChange={e => setFSite(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
            <option value="All">All Sites</option>
            {SITES.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={fCategory} onChange={e => setFCategory(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
            <option value="All">All Categories</option>
            {allCategories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : (
        <>
          {/* Tab switcher */}
          <div className="flex items-center gap-1 mb-4">
            <button
              onClick={() => setActiveTab('expenditure')}
              className={`px-4 py-2 text-sm font-medium rounded-lg ${
                activeTab === 'expenditure'
                  ? 'bg-[#1a3c5e] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Expenditure
            </button>
            <button
              onClick={() => setActiveTab('cashflow')}
              className={`px-4 py-2 text-sm font-medium rounded-lg ${
                activeTab === 'cashflow'
                  ? 'bg-[#1a3c5e] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Cashflow (Payments)
            </button>
          </div>

          {/* Pivot table */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto max-h-[70vh] overflow-y-auto relative
            [&_th:first-child]:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] [&_td:first-child]:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]
            [&_th:last-child]:shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.1)] [&_td:last-child]:shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.1)]">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50 sticky top-0 z-20">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-500 sticky left-0 bg-gray-50 z-30">{drillByVendor ? 'Vendor' : 'Category'}</th>
                  {months.map(m => (
                    <th key={m} className="px-4 py-2.5 text-right font-medium text-gray-500 whitespace-nowrap">{monthLabel(m)}</th>
                  ))}
                  <th className="px-4 pl-6 py-2.5 text-right font-medium text-gray-900 sticky right-0 bg-gray-50 z-30 border-l border-gray-200">Total</th>
                </tr>
              </thead>
              <tbody>
                {isEmpty ? (
                  <tr>
                    <td colSpan={months.length + 2} className="px-4 py-10 text-center text-gray-400 text-sm">
                      {activeTab === 'cashflow' ? 'No payments recorded yet for selected filters.' : 'No data for selected filters.'}
                    </td>
                  </tr>
                ) : (
                  cats.map(c => {
                    const row = pivot.get(c)!;
                    const rowTotal = months.reduce((s, m) => s + (row.get(m) ?? 0), 0);
                    return (
                      <tr key={c} className="border-t border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-medium text-gray-900 sticky left-0 bg-white z-10 whitespace-nowrap">{c}</td>
                        {months.map(m => {
                          const v = row.get(m) ?? 0;
                          return <td key={m} className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">{v > 0 ? formatINR(v) : '—'}</td>;
                        })}
                        <td className="px-4 pl-6 py-3 text-right font-semibold text-gray-900 whitespace-nowrap sticky right-0 bg-white z-10 border-l border-gray-100">{formatINR(rowTotal)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {!isEmpty && (
                <tfoot className="border-t-2 border-gray-200 bg-gray-50 sticky bottom-0 z-20">
                  <tr>
                    <td className="px-4 py-2.5 font-medium text-gray-900 sticky left-0 bg-gray-50 z-30">Total</td>
                    {totals.map((t, i) => (
                      <td key={months[i]} className="px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">{formatINR(t)}</td>
                    ))}
                    <td className="px-4 pl-6 py-2.5 text-right font-bold text-gray-900 whitespace-nowrap sticky right-0 bg-gray-50 z-30 border-l border-gray-200">{formatINR(grandTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Tab description */}
          <div className="mt-3 text-xs text-gray-400">
            {activeTab === 'expenditure'
              ? `By invoice date · ${fSite === 'All' ? 'All Sites' : fSite}`
              : `By invoice month · ${fSite === 'All' ? 'All Sites' : fSite}`
            }
          </div>
        </>
      )}
    </AppShell>
  );
}
