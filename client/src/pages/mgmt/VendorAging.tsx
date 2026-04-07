import { useState, useMemo } from 'react';
import { useAgingCalc } from '../../hooks/useAgingCalc';
import { formatINR } from '../../utils/formatters';
import { SITES } from '../../utils/constants';
import AppShell from '../../components/layout/AppShell';

interface VendorRow {
  vendor: string;
  terms: number;
  invoiceCount: number;
  totalBalance: number;
  withinBalance: number;
  overdueBalance: number;
  maxDaysPast: number;
  earliestDue: string | null;
}

export default function VendorAging() {
  const [site, setSite] = useState('All');
  const [sortBy, setSortBy] = useState<string>('overdueBalance');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const { withinTerms, overdue, loading } = useAgingCalc(site);

  const vendorRows = useMemo(() => {
    const map = new Map<string, VendorRow>();
    const allRows = [...withinTerms, ...overdue];

    for (const r of allRows) {
      const bal = Number(r.balance);
      if (bal <= 0) continue;
      const isOv = r.overdue;

      if (!map.has(r.vendor_name)) {
        map.set(r.vendor_name, {
          vendor: r.vendor_name, terms: r.payment_terms, invoiceCount: 0,
          totalBalance: 0, withinBalance: 0, overdueBalance: 0, maxDaysPast: 0, earliestDue: null,
        });
      }
      const row = map.get(r.vendor_name)!;
      row.invoiceCount++;
      row.totalBalance += bal;
      if (isOv) {
        row.overdueBalance += bal;
        row.maxDaysPast = Math.max(row.maxDaysPast, Number(r.days_past_due));
      } else {
        row.withinBalance += bal;
        const ds = r.due_date;
        if (!row.earliestDue || ds < row.earliestDue) row.earliestDue = ds;
      }
    }
    return Array.from(map.values());
  }, [withinTerms, overdue]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'desc' ? -1 : 1;
    return [...vendorRows].sort((a, b) => {
      const av = a[sortBy as keyof VendorRow];
      const bv = b[sortBy as keyof VendorRow];
      if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
      return dir * String(av ?? '').localeCompare(String(bv ?? ''));
    });
  }, [vendorRows, sortBy, sortDir]);

  const totalBalance = vendorRows.reduce((s, r) => s + r.totalBalance, 0);
  const totalOverdue = vendorRows.reduce((s, r) => s + r.overdueBalance, 0);
  const totalWithin = vendorRows.reduce((s, r) => s + r.withinBalance, 0);
  const overdueVendors = vendorRows.filter(r => r.overdueBalance > 0).length;

  function handleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
  }

  const SortTh = ({ col, label, right }: { col: string; label: string; right?: boolean }) => (
    <th onClick={() => handleSort(col)} className={`px-4 py-2.5 font-medium whitespace-nowrap cursor-pointer select-none bg-gray-50 ${right ? 'text-right' : 'text-left'} ${sortBy === col ? 'text-gray-900' : 'text-gray-500'}`}>
      {label} <span className="text-[10px] opacity-50">{sortBy === col ? (sortDir === 'desc' ? '↓' : '↑') : '⇅'}</span>
    </th>
  );

  function fmtDate(d: string): string {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Vendor Aging</div>
          <div className="text-xs text-gray-500 mt-1">One row per vendor · outstanding balance split by overdue vs within terms · click headers to sort</div>
        </div>
        <select value={site} onChange={e => setSite(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
          <option value="All">All Sites</option>
          {SITES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-6">
            {[
              { label: 'Total Outstanding', value: formatINR(totalBalance), sub: `${vendorRows.length} vendors with balance`, accent: '#1a3c5e', bg: '#eff6ff' },
              { label: 'Overdue', value: formatINR(totalOverdue), sub: `${overdueVendors} vendor${overdueVendors !== 1 ? 's' : ''} past their due date`, accent: '#dc2626', bg: '#fef2f2' },
              { label: 'Within Terms', value: formatINR(totalWithin), sub: 'balance not yet due', accent: '#15803d', bg: '#dcfce7' },
              { label: 'Total Vendors', value: String(vendorRows.length), sub: 'with pending invoices', accent: '#6b21a8', bg: '#f3e8ff' },
            ].map(k => (
              <div key={k.label} className="rounded-xl p-[18px]" style={{ background: k.bg, border: `1px solid ${k.accent}22` }}>
                <div className="text-[11px] font-medium uppercase tracking-wider mb-2" style={{ color: k.accent }}>{k.label}</div>
                <div className="text-xl font-semibold leading-none mb-1" style={{ color: k.accent }}>{k.value}</div>
                <div className="text-[11px]" style={{ color: k.accent, opacity: 0.7 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Vendor table */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <SortTh col="vendor" label="Vendor" />
                  <th className="px-4 py-2.5 text-center font-medium text-gray-500 bg-gray-50">Terms</th>
                  <th className="px-4 py-2.5 text-center font-medium text-gray-500 bg-gray-50">Invoices</th>
                  <SortTh col="totalBalance" label="Total Balance" right />
                  <SortTh col="withinBalance" label="Within Terms" right />
                  <SortTh col="overdueBalance" label="Overdue Balance" right />
                  <SortTh col="maxDaysPast" label="Max Days Past Due" right />
                  <th className="px-4 py-2.5 text-left font-medium text-gray-500 bg-gray-50">Next Due</th>
                  <th className="px-4 py-2.5 text-center font-medium text-gray-500 bg-gray-50">Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => {
                  const hasOv = r.overdueBalance > 0;
                  const statusLabel = !hasOv ? 'On track' : r.maxDaysPast > 60 ? 'Critical' : r.maxDaysPast > 30 ? 'At risk' : 'Overdue';
                  const statusColor = !hasOv ? 'text-green-700 bg-green-50' : r.maxDaysPast > 60 ? 'text-red-800 bg-red-200' : r.maxDaysPast > 30 ? 'text-orange-700 bg-orange-100' : 'text-red-700 bg-red-100';

                  return (
                    <tr key={r.vendor} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate" title={r.vendor}>{r.vendor}</td>
                      <td className="px-4 py-3 text-center text-gray-500 text-xs">{r.terms}d</td>
                      <td className="px-4 py-3 text-center text-gray-500 text-xs">{r.invoiceCount}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatINR(r.totalBalance)}</td>
                      <td className="px-4 py-3 text-right" style={{ color: r.withinBalance > 0 ? '#15803d' : undefined }}>{r.withinBalance > 0 ? formatINR(r.withinBalance) : '—'}</td>
                      <td className="px-4 py-3 text-right font-medium" style={{ color: hasOv ? '#dc2626' : undefined }}>{hasOv ? formatINR(r.overdueBalance) : '—'}</td>
                      <td className="px-4 py-3 text-right" style={{ color: r.maxDaysPast > 0 ? '#dc2626' : undefined, fontWeight: r.maxDaysPast > 0 ? 500 : 400 }}>{r.maxDaysPast > 0 ? `${r.maxDaysPast}d` : '—'}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{r.earliestDue ? fmtDate(r.earliestDue) : '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[11px] font-medium px-2.5 py-1 rounded-lg ${statusColor}`}>{statusLabel}</span>
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">No pending vendor balances.</td></tr>}
              </tbody>
              {sorted.length > 0 && (
                <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                  <tr>
                    <td colSpan={3} className="px-4 py-2.5 font-medium text-gray-900">Total</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{formatINR(totalBalance)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-green-700">{formatINR(totalWithin)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-red-600">{formatINR(totalOverdue)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}
