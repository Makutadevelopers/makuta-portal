import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../api/client';
import { useVendors } from '../../hooks/useVendors';
import { formatINR } from '../../utils/formatters';
import { SITES } from '../../utils/constants';
import { CashflowRow } from '../../types/cashflow';
import AppShell from '../../components/layout/AppShell';

export default function MgmtCashflow() {
  const [rows, setRows] = useState<CashflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { vendors } = useVendors();

  const [fSite, setFSite] = useState('All');
  const [fCategory, setFCategory] = useState('All');
  const [fVendor, setFVendor] = useState('');

  useEffect(() => {
    apiFetch<{ expenditure: { month: string; purpose: string; total: number }[]; cashflow: { month: string; purpose: string; total: number }[] }>('/cashflow')
      .then(res => {
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
        setRows(Array.from(merged.values()));
      })
      .finally(() => setLoading(false));
  }, []);

  const months = useMemo(() => {
    const set = new Set(rows.map(r => r.month));
    return Array.from(set).sort();
  }, [rows]);

  const categories = useMemo(() => {
    const set = new Set(rows.map(r => r.purpose));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let data = rows;
    if (fCategory !== 'All') data = data.filter(r => r.purpose === fCategory);
    return data;
  }, [rows, fCategory]);

  const expPivot = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const r of filtered) {
      if (!map.has(r.purpose)) map.set(r.purpose, new Map());
      map.get(r.purpose)!.set(r.month, (map.get(r.purpose)!.get(r.month) ?? 0) + Number(r.total_invoiced));
    }
    return map;
  }, [filtered]);

  const cfPivot = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const r of filtered) {
      if (Number(r.total_paid) === 0) continue;
      if (!map.has(r.purpose)) map.set(r.purpose, new Map());
      map.get(r.purpose)!.set(r.month, (map.get(r.purpose)!.get(r.month) ?? 0) + Number(r.total_paid));
    }
    return map;
  }, [filtered]);

  function monthLabel(ym: string): string {
    const [y, m] = ym.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[parseInt(m, 10) - 1]} ${y.slice(2)}`;
  }

  function renderPivotTable(pivot: Map<string, Map<string, number>>, title: string, subtitle: string) {
    const cats = Array.from(pivot.keys()).sort();
    const totals = months.map(m => cats.reduce((s, c) => s + (pivot.get(c)?.get(m) ?? 0), 0));
    const grandTotal = totals.reduce((s, v) => s + v, 0);
    const isEmpty = cats.length === 0 || grandTotal === 0;

    return (
      <div className="mb-8">
        <div className="mb-3">
          <span className="text-sm font-medium text-gray-900">{title}</span>
          <span className="text-xs text-gray-400 ml-2">{subtitle}</span>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 sticky left-0 bg-gray-50 z-10">Category</th>
                {months.map(m => <th key={m} className="px-4 py-2.5 text-right font-medium text-gray-500 whitespace-nowrap">{monthLabel(m)}</th>)}
                <th className="px-4 py-2.5 text-right font-medium text-gray-900">Total</th>
              </tr>
            </thead>
            <tbody>
              {isEmpty ? (
                <tr><td colSpan={months.length + 2} className="px-4 py-10 text-center text-gray-400 text-sm">No payments recorded yet for selected filters.</td></tr>
              ) : cats.map(c => {
                const row = pivot.get(c)!;
                const rowTotal = months.reduce((s, m) => s + (row.get(m) ?? 0), 0);
                return (
                  <tr key={c} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-gray-900 sticky left-0 bg-white z-10">{c}</td>
                    {months.map(m => { const v = row.get(m) ?? 0; return <td key={m} className="px-4 py-3 text-right text-gray-700">{v > 0 ? formatINR(v) : '—'}</td>; })}
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatINR(rowTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            {!isEmpty && (
              <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                <tr>
                  <td className="px-4 py-2.5 font-medium text-gray-900 sticky left-0 bg-gray-50 z-10">Total</td>
                  {totals.map((t, i) => <td key={months[i]} className="px-4 py-2.5 text-right font-semibold text-gray-900">{formatINR(t)}</td>)}
                  <td className="px-4 py-2.5 text-right font-bold text-gray-900">{formatINR(grandTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Cashflow & Expenditure</div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={fSite} onChange={e => setFSite(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
            <option value="All">All Sites</option>
            {SITES.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={fCategory} onChange={e => setFCategory(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
            <option value="All">All Categories</option>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
          <select value={fVendor} onChange={e => setFVendor(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
            <option value="">Select Vendor</option>
            {vendors.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : (
        <>
          {renderPivotTable(expPivot, 'Expenditure', `Invoice amounts · ${fSite === 'All' ? 'All Sites' : fSite}`)}
          {renderPivotTable(cfPivot, 'Cashflow', `Payments made · ${fSite === 'All' ? 'All Sites' : fSite}`)}
        </>
      )}
    </AppShell>
  );
}
