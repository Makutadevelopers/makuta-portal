import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../api/client';
import { useVendors } from '../../hooks/useVendors';
import { useInvoices } from '../../hooks/useInvoices';
import { formatINR } from '../../utils/formatters';
import { SITES } from '../../utils/constants';
import { CashflowRow } from '../../types/cashflow';
import AppShell from '../../components/layout/AppShell';

export default function CashflowPage() {
  const [rows, setRows] = useState<CashflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { vendors } = useVendors();
  const { invoices } = useInvoices();

  const [activeTab, setActiveTab] = useState<'expenditure' | 'cashflow'>('expenditure');
  const [fSite, setFSite] = useState('All');
  const [fCategory, setFCategory] = useState('All');
  const [fVendor, setFVendor] = useState('');

  useEffect(() => {
    apiFetch<CashflowRow[]>('/cashflow')
      .then(setRows)
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

  // When a specific category is selected, pivot by vendor; otherwise by category
  const drillByVendor = fCategory !== 'All';

  // Expenditure pivot
  const expPivot = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    if (drillByVendor) {
      // Pivot by vendor using invoice data filtered to the selected category
      const catInvoices = invoices.filter(i => i.purpose === fCategory);
      for (const inv of catInvoices) {
        const key = inv.vendor_name;
        const m = inv.month?.slice(0, 7) ?? '';
        if (!m) continue;
        if (!map.has(key)) map.set(key, new Map());
        map.get(key)!.set(m, (map.get(key)!.get(m) ?? 0) + Number(inv.invoice_amount));
      }
    } else {
      for (const r of filtered) {
        if (!map.has(r.purpose)) map.set(r.purpose, new Map());
        map.get(r.purpose)!.set(r.month, (map.get(r.purpose)!.get(r.month) ?? 0) + Number(r.total_invoiced));
      }
    }
    return map;
  }, [filtered, drillByVendor, fCategory, invoices]);

  // Cashflow pivot (payments)
  const cfPivot = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    if (drillByVendor) {
      const catInvoices = invoices.filter(i => i.purpose === fCategory && i.payment_status === 'Paid');
      for (const inv of catInvoices) {
        const key = inv.vendor_name;
        const m = inv.month?.slice(0, 7) ?? '';
        if (!m) continue;
        if (!map.has(key)) map.set(key, new Map());
        map.get(key)!.set(m, (map.get(key)!.get(m) ?? 0) + Number(inv.invoice_amount));
      }
    } else {
      for (const r of filtered) {
        if (Number(r.total_paid) === 0) continue;
        if (!map.has(r.purpose)) map.set(r.purpose, new Map());
        map.get(r.purpose)!.set(r.month, (map.get(r.purpose)!.get(r.month) ?? 0) + Number(r.total_paid));
      }
    }
    return map;
  }, [filtered, drillByVendor, fCategory, invoices]);

  function monthLabel(ym: string): string {
    const [y, m] = ym.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[parseInt(m, 10) - 1]} ${y.slice(2)}`;
  }

  const pivot = activeTab === 'expenditure' ? expPivot : cfPivot;
  const cats = Array.from(pivot.keys()).sort();
  const totals = months.map(m => cats.reduce((s, c) => s + (pivot.get(c)?.get(m) ?? 0), 0));
  const grandTotal = totals.reduce((s, v) => s + v, 0);
  const isEmpty = cats.length === 0 || grandTotal === 0;

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Cashflow & Expenditure</div>
          <div className="text-xs text-gray-500 mt-1">Monthly breakdown of invoices raised and payments made</div>
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
          {/* Vendor drill-down panel */}
          {fVendor && (() => {
            const vendorInvs = invoices.filter(i => i.vendor_name === fVendor);
            const vendorPivot = new Map<string, Map<string, number>>();
            for (const inv of vendorInvs) {
              const m = inv.month?.slice(0, 7) ?? '';
              const cat = inv.purpose;
              if (!vendorPivot.has(cat)) vendorPivot.set(cat, new Map());
              vendorPivot.get(cat)!.set(m, (vendorPivot.get(cat)!.get(m) ?? 0) + Number(inv.invoice_amount));
            }
            const vMonths = Array.from(new Set(vendorInvs.map(i => i.month?.slice(0, 7) ?? ''))).sort();
            const vCats = Array.from(vendorPivot.keys()).sort();
            const vTotal = vendorInvs.reduce((s, i) => s + Number(i.invoice_amount), 0);

            return (
              <div className="mb-6 bg-white rounded-xl border-2 border-blue-200 overflow-hidden">
                <div className="px-5 py-4 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-blue-900">{fVendor}</div>
                    <div className="text-xs text-blue-700 mt-0.5">{vendorInvs.length} invoices · {formatINR(vTotal)}</div>
                  </div>
                  <button onClick={() => setFVendor('')} className="text-xs text-blue-600 hover:underline">Clear</button>
                </div>
                {vCats.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-gray-500">Category</th>
                          {vMonths.map(m => <th key={m} className="px-4 py-2 text-right font-medium text-gray-500">{monthLabel(m)}</th>)}
                          <th className="px-4 py-2 text-right font-medium text-gray-900">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vCats.map(c => {
                          const row = vendorPivot.get(c)!;
                          const rowTotal = vMonths.reduce((s, m) => s + (row.get(m) ?? 0), 0);
                          return (
                            <tr key={c} className="border-t border-gray-50">
                              <td className="px-4 py-2.5 font-medium text-gray-900">{c}</td>
                              {vMonths.map(m => <td key={m} className="px-4 py-2.5 text-right text-gray-700">{(row.get(m) ?? 0) > 0 ? formatINR(row.get(m)!) : '—'}</td>)}
                              <td className="px-4 py-2.5 text-right font-semibold">{formatINR(rowTotal)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

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

          {/* Pivot table with sticky header */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto max-h-[70vh] overflow-y-auto relative">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50 sticky top-0 z-20">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-500 sticky left-0 bg-gray-50 z-30">{drillByVendor ? 'Vendor' : 'Category'}</th>
                  {months.map(m => (
                    <th key={m} className="px-4 py-2.5 text-right font-medium text-gray-500 whitespace-nowrap">{monthLabel(m)}</th>
                  ))}
                  <th className="px-4 py-2.5 text-right font-medium text-gray-900 sticky right-0 bg-gray-50 z-30">Total</th>
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
                        <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap sticky right-0 bg-white z-10">{formatINR(rowTotal)}</td>
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
                    <td className="px-4 py-2.5 text-right font-bold text-gray-900 whitespace-nowrap sticky right-0 bg-gray-50 z-30">{formatINR(grandTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Tab description */}
          <div className="mt-3 text-xs text-gray-400">
            {activeTab === 'expenditure'
              ? `Invoice amounts · ${fSite === 'All' ? 'All Sites' : fSite}`
              : `Payments made · ${fSite === 'All' ? 'All Sites' : fSite}`
            }
          </div>
        </>
      )}
    </AppShell>
  );
}
