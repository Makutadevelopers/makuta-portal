import { useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useInvoices } from '../../hooks/useInvoices';
import { formatINR, formatDate } from '../../utils/formatters';
import AppShell from '../../components/layout/AppShell';

export default function SiteDashboard() {
  const { user } = useAuth();
  const { invoices, loading } = useInvoices();
  const [trendSite, setTrendSite] = useState<string>('all');

  // KPI computations
  const totalInvoices = invoices.length;
  const totalAmount = invoices.reduce((s, i) => s + Number(i.invoice_amount), 0);
  const categoriesUsed = new Set(invoices.map(i => i.purpose)).size;
  const vendorsUsed = new Set(invoices.map(i => i.vendor_name)).size;

  // Monthly trend: group invoices by YYYY-MM, optionally scoped to a single
  // site so multi-site accountants can see one project at a time.
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const inv of invoices) {
      if (trendSite !== 'all' && inv.site !== trendSite) continue;
      const ym = inv.month?.slice(0, 7);
      if (!ym) continue;
      map.set(ym, (map.get(ym) ?? 0) + Number(inv.invoice_amount));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, total]) => ({ ym, total }));
  }, [invoices, trendSite]);

  const maxMonthly = Math.max(...monthlyTrend.map(m => m.total), 1);

  // Top 5 categories
  const topCategories = useMemo(() => {
    const map = new Map<string, number>();
    for (const inv of invoices) {
      map.set(inv.purpose, (map.get(inv.purpose) ?? 0) + Number(inv.invoice_amount));
    }
    return Array.from(map.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [invoices]);

  const maxCategory = Math.max(...topCategories.map(c => c.total), 1);

  // Top 5 vendors
  const topVendors = useMemo(() => {
    const map = new Map<string, number>();
    for (const inv of invoices) {
      map.set(inv.vendor_name, (map.get(inv.vendor_name) ?? 0) + Number(inv.invoice_amount));
    }
    return Array.from(map.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [invoices]);

  const maxVendor = Math.max(...topVendors.map(v => v.total), 1);

  // Recent 10 invoices (sorted by date descending)
  const recentInvoices = useMemo(() => {
    return [...invoices]
      .sort((a, b) => new Date(b.invoice_date).getTime() - new Date(a.invoice_date).getTime())
      .slice(0, 10);
  }, [invoices]);

  function monthLabel(ym: string): string {
    const [y, m] = ym.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
  }

  const userSites = user?.sites && user.sites.length > 0
    ? user.sites
    : (user?.site ? [user.site] : []);
  const isMulti = userSites.length > 1;

  // Per-site breakdown — render even for single-site accountants so the
  // "outstanding per project" surfaces on every site dashboard.
  const perSite = useMemo(() => {
    const map = new Map<string, { count: number; total: number; outstanding: number }>();
    for (const s of userSites) map.set(s, { count: 0, total: 0, outstanding: 0 });
    for (const inv of invoices) {
      const cur = map.get(inv.site);
      if (!cur) continue;
      cur.count += 1;
      cur.total += Number(inv.invoice_amount);
      cur.outstanding += Number(inv.balance ?? 0);
    }
    return userSites.map(s => ({ site: s, ...(map.get(s) ?? { count: 0, total: 0, outstanding: 0 }) }));
  }, [invoices, userSites]);

  return (
    <AppShell>
      <div className="mb-6">
        <div className="text-lg font-medium text-gray-900">
          Dashboard — {isMulti ? `${userSites.length} sites` : userSites[0] ?? ''}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {isMulti
            ? `Aggregated view for: ${userSites.join(', ')} · cashflow and aging managed by Head Office`
            : 'Invoice summary for your site · cashflow and aging managed by Head Office'}
        </div>
      </div>

      {perSite.length > 0 && (
        <div className={`grid gap-3 mb-5 ${isMulti ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
          {perSite.map(s => (
            <div key={s.site} className="bg-blue-50/50 border border-blue-100 rounded-xl p-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[#1a3c5e] mb-1">{s.site}</div>
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-[#1a3c5e]">{formatINR(s.total)}</div>
                  <div className="text-[11px] text-[#1a3c5e] opacity-70">{s.count} invoice{s.count === 1 ? '' : 's'} invoiced</div>
                </div>
                <div className="text-right">
                  <div className={`text-base font-semibold ${s.outstanding > 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {formatINR(s.outstanding)}
                  </div>
                  <div className="text-[11px] text-gray-500">outstanding</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Total Invoices</div>
              <div className="text-2xl font-semibold text-gray-900">{totalInvoices}</div>
              <div className="text-xs text-gray-400 mt-1">invoices submitted</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Total Invoiced</div>
              <div className="text-2xl font-semibold text-gray-900">{formatINR(totalAmount)}</div>
              <div className="text-xs text-gray-400 mt-1">cumulative amount</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Categories Used</div>
              <div className="text-2xl font-semibold text-gray-900">{categoriesUsed}</div>
              <div className="text-xs text-gray-400 mt-1">distinct material types</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Vendors Used</div>
              <div className="text-2xl font-semibold text-gray-900">{vendorsUsed}</div>
              <div className="text-xs text-gray-400 mt-1">distinct vendors</div>
            </div>
          </div>

          {/* Monthly Invoice Trend */}
          <div className="bg-white rounded-xl border border-gray-100 mb-6">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-gray-900">
                Monthly Invoice Trend
                {trendSite !== 'all' && (
                  <span className="text-xs text-gray-500 font-normal ml-2">· {trendSite}</span>
                )}
              </div>
              {isMulti && (
                <select
                  value={trendSite}
                  onChange={e => setTrendSite(e.target.value)}
                  className="text-xs px-2 py-1 border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                  title="Filter the chart to a single site"
                >
                  <option value="all">All sites</option>
                  {userSites.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>
            <div className="px-5 py-4">
              {monthlyTrend.length === 0 ? (
                <div className="py-5 text-center text-sm text-gray-400">No data</div>
              ) : (
                <div className="flex items-end gap-2 h-48 overflow-x-auto">
                  {monthlyTrend.map(m => {
                    const barH = (m.total / maxMonthly) * 100;
                    return (
                      <div key={m.ym} className="flex flex-col items-center flex-1 min-w-[48px]">
                        <div className="text-[10px] text-gray-500 font-medium mb-1">{formatINR(m.total)}</div>
                        <div className="w-full flex items-end justify-center" style={{ height: '140px' }}>
                          <div
                            className="w-8 rounded-t-md bg-[#1a3c5e]"
                            style={{ height: `${Math.max(barH, 2)}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-gray-500 mt-1.5 whitespace-nowrap">{monthLabel(m.ym)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Top 5 Categories + Top 5 Vendors side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Top 5 Categories */}
            <div className="bg-white rounded-xl border border-gray-100">
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="text-sm font-medium text-gray-900">Top 5 Categories</div>
              </div>
              <div className="px-5 py-3 space-y-4">
                {topCategories.map(row => {
                  const barW = (row.total / maxCategory) * 100;
                  return (
                    <div key={row.name}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-gray-900">{row.name}</span>
                        <span className="text-sm font-semibold text-gray-900">{formatINR(row.total)}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-[#1a3c5e]" style={{ width: `${barW}%` }} />
                      </div>
                    </div>
                  );
                })}
                {topCategories.length === 0 && (
                  <div className="py-5 text-center text-sm text-gray-400">No data</div>
                )}
              </div>
            </div>

            {/* Top 5 Vendors */}
            <div className="bg-white rounded-xl border border-gray-100">
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="text-sm font-medium text-gray-900">Top 5 Vendors</div>
              </div>
              <div className="px-5 py-3 space-y-4">
                {topVendors.map(row => {
                  const barW = (row.total / maxVendor) * 100;
                  return (
                    <div key={row.name}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-gray-900">{row.name}</span>
                        <span className="text-sm font-semibold text-gray-900">{formatINR(row.total)}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-emerald-600" style={{ width: `${barW}%` }} />
                      </div>
                    </div>
                  );
                })}
                {topVendors.length === 0 && (
                  <div className="py-5 text-center text-sm text-gray-400">No data</div>
                )}
              </div>
            </div>
          </div>

          {/* Recent Invoices Table */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-sm font-medium text-gray-900">Recent Invoices</div>
            </div>
            <div className="overflow-y-auto overflow-x-hidden">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col style={{ width: '20%' }} />{/* Invoice Date */}
                  <col style={{ width: '38%' }} />{/* Vendor */}
                  <col style={{ width: '24%' }} />{/* Category */}
                  <col style={{ width: '18%' }} />{/* Amount */}
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice Date</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Vendor</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recentInvoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-gray-50/50">
                      <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                      <td className="px-5 py-3 text-gray-900 font-medium truncate">{inv.vendor_name}</td>
                      <td className="px-5 py-3 text-gray-600 truncate">{inv.purpose}</td>
                      <td className="px-5 py-3 text-gray-900 font-semibold text-right">{formatINR(Number(inv.invoice_amount))}</td>
                    </tr>
                  ))}
                  {recentInvoices.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-sm text-gray-400">No invoices found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            Amounts shown are invoice values submitted from your site. Cashflow and aging are managed exclusively by Head Office.
          </div>
        </>
      )}
    </AppShell>
  );
}
