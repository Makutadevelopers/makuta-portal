import { useState, useEffect, useMemo } from 'react';
import { useSites } from '../../hooks/useSites';
import { apiFetch } from '../../api/client';
import { formatINR } from '../../utils/formatters';
import AppShell from '../../components/layout/AppShell';
import { useStickyHeaderHeight } from '../../hooks/useStickyHeaderHeight';
import { useReloadOnFocus } from '../../hooks/useReloadOnFocus';

interface PivotRow {
  month: string;
  purpose: string;
  total: number;
}

interface CashflowResponse {
  expenditure: PivotRow[];
  cashflow: PivotRow[];
}

// Default to the latest 6 months — wider periods make the table hard to scan
// and the column count grows forever. A toggle reveals the older months when
// users actually want them.
const RECENT_MONTH_COUNT = 6;

export default function CashflowPage() {
  // Projects come from the DB-backed Project Master (HO manages them at
  // /projects). useSites falls back to the static seed list while the request
  // is in flight, so this dropdown is never empty.
  const { names: SITES } = useSites();
  const [data, setData] = useState<CashflowResponse>({ expenditure: [], cashflow: [] });
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<'expenditure' | 'cashflow'>('expenditure');
  const [fSite, setFSite] = useState('All');
  const [fCategory, setFCategory] = useState('All');
  const [showAllMonths, setShowAllMonths] = useState(false);
  const { ref: stickyHeaderRef } = useStickyHeaderHeight();

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

  // Silent refresh on focus so figures reflect edits made elsewhere (no spinner).
  useReloadOnFocus(() => {
    const params = new URLSearchParams();
    if (fSite !== 'All') params.set('site', fSite);
    if (fCategory !== 'All') params.set('category', fCategory);
    const qs = params.toString();
    apiFetch<CashflowResponse>(`/cashflow${qs ? `?${qs}` : ''}`).then(setData).catch(() => {});
  });

  const rows = activeTab === 'expenditure' ? data.expenditure : data.cashflow;

  const months = useMemo(() => {
    const set = new Set(rows.map(r => r.month));
    return Array.from(set).sort();
  }, [rows]);

  // The columns actually rendered: latest N months by default, all when the
  // user clicks "Show older". `months` is YYYY-MM ascending, so .slice(-N)
  // gives the most recent. Totals/colSpan/rowTotal all use this windowed set
  // so the on-screen "Total" column matches the columns shown.
  const visibleMonths = useMemo(
    () => (showAllMonths ? months : months.slice(-RECENT_MONTH_COUNT)),
    [months, showAllMonths],
  );
  const hiddenMonthCount = months.length - visibleMonths.length;

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
  // Totals computed over the visible columns so they sum to the on-screen Total.
  const totals = visibleMonths.map(m => cats.reduce((s, c) => s + (pivot.get(c)?.get(m) ?? 0), 0));
  const grandTotal = totals.reduce((s, v) => s + v, 0);
  const isEmpty = cats.length === 0 || grandTotal === 0;

  return (
    <AppShell>
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-30 bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 -mt-4 sm:-mt-6 pt-4 sm:pt-6 pb-2 mb-4"
      >
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="text-lg font-medium text-gray-900">Cashflow & Expenditure</div>
            <div className="text-xs text-gray-500 mt-1">
              {activeTab === 'expenditure'
                ? 'Monthly breakdown by accounting month'
                : 'Monthly breakdown by payment month'}
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

          {/* Months toggle — only when there are older months to reveal */}
          {months.length > RECENT_MONTH_COUNT && (
            <div className="mb-3 flex items-center justify-end text-xs">
              <button
                onClick={() => setShowAllMonths(s => !s)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
              >
                {showAllMonths
                  ? `Showing all ${months.length} months — show recent ${RECENT_MONTH_COUNT}`
                  : `Showing recent ${visibleMonths.length} of ${months.length} months — show ${hiddenMonthCount} older`}
              </button>
            </div>
          )}

          {/* Pivot table.
             Sticky is applied on the cells themselves (not <thead>/<tfoot>) so
             it works reliably across browsers; every sticky cell carries its
             own opaque background. z-layers: corner cells z-30 (sticky in two
             axes), edge cells z-20, body sticky-left/right z-10. */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto max-h-[70vh] overflow-y-auto relative
            [&_th:first-child]:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] [&_td:first-child]:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]
            [&_th:last-child]:shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.1)] [&_td:last-child]:shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.1)]">
            <table className="w-full text-[13px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-500 sticky top-0 left-0 bg-gray-50 z-30 border-b border-gray-200 whitespace-nowrap">
                    {drillByVendor ? 'Vendor' : 'Category'}
                  </th>
                  {visibleMonths.map(m => (
                    <th key={m} className="px-4 py-2.5 text-right font-medium text-gray-500 sticky top-0 bg-gray-50 z-20 border-b border-gray-200 whitespace-nowrap">
                      {monthLabel(m)}
                    </th>
                  ))}
                  <th className="px-4 pl-6 py-2.5 text-right font-medium text-gray-900 sticky top-0 right-0 bg-gray-50 z-30 border-l border-b border-gray-200 whitespace-nowrap">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {isEmpty ? (
                  <tr>
                    <td colSpan={visibleMonths.length + 2} className="px-4 py-10 text-center text-gray-400 text-sm">
                      {activeTab === 'cashflow' ? 'No payments recorded yet for selected filters.' : 'No data for selected filters.'}
                    </td>
                  </tr>
                ) : (
                  cats.map(c => {
                    const row = pivot.get(c)!;
                    const rowTotal = visibleMonths.reduce((s, m) => s + (row.get(m) ?? 0), 0);
                    return (
                      <tr key={c} className="hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-medium text-gray-900 sticky left-0 bg-white z-10 whitespace-nowrap border-t border-gray-50">
                          {c}
                        </td>
                        {visibleMonths.map(m => {
                          const v = row.get(m) ?? 0;
                          return (
                            <td key={m} className="px-4 py-3 text-right text-gray-700 whitespace-nowrap border-t border-gray-50">
                              {v > 0 ? formatINR(v) : '—'}
                            </td>
                          );
                        })}
                        <td className="px-4 pl-6 py-3 text-right font-semibold text-gray-900 whitespace-nowrap sticky right-0 bg-white z-10 border-l border-t border-gray-100">
                          {formatINR(rowTotal)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {!isEmpty && (
                <tfoot>
                  <tr>
                    <td className="px-4 py-2.5 font-medium text-gray-900 sticky bottom-0 left-0 bg-gray-50 z-30 border-t-2 border-gray-200 whitespace-nowrap">
                      Total
                    </td>
                    {totals.map((t, i) => (
                      <td key={visibleMonths[i]} className="px-4 py-2.5 text-right font-semibold text-gray-900 sticky bottom-0 bg-gray-50 z-20 border-t-2 border-gray-200 whitespace-nowrap">
                        {formatINR(t)}
                      </td>
                    ))}
                    <td className="px-4 pl-6 py-2.5 text-right font-bold text-gray-900 sticky bottom-0 right-0 bg-gray-50 z-30 border-l border-t-2 border-gray-200 whitespace-nowrap">
                      {formatINR(grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Tab description */}
          <div className="mt-3 text-xs text-gray-400">
            {activeTab === 'expenditure'
              ? `By invoice date · ${fSite === 'All' ? 'All Sites' : fSite}`
              : `By payment month · ${fSite === 'All' ? 'All Sites' : fSite}`
            }
          </div>
        </>
      )}
    </AppShell>
  );
}
