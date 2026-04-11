import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDashboardData, Kpis, SiteRow, DueSoonRow, VendorOverdue, CategorySpend, MonthTrend } from '../../hooks/useDashboardData';
import { getDuplicateVendors, mergeVendors, DuplicatePair } from '../../api/vendors';
import { formatINR, formatDate } from '../../utils/formatters';
import AppShell from '../../components/layout/AppShell';
import { useToast } from '../../context/ToastContext';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

function getTimelineRange(tl: string, dateFrom: string, dateTo: string): { from: string; to: string } | null {
  if (tl === 'all') return null;
  if (tl === 'custom') {
    if (dateFrom || dateTo) return { from: dateFrom, to: dateTo };
    return null;
  }
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const today = `${yyyy}-${mm}-${dd}`;
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  if (tl === 'today') return { from: today, to: today };
  if (tl === 'week') {
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { from: fmt(mon), to: fmt(sun) };
  }
  if (tl === 'month') {
    const lastDay = new Date(yyyy, now.getMonth() + 1, 0).getDate();
    return { from: `${yyyy}-${mm}-01`, to: `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}` };
  }
  if (tl === 'quarter') {
    const qStart = new Date(yyyy, Math.floor(now.getMonth() / 3) * 3, 1);
    const qEnd = new Date(yyyy, Math.floor(now.getMonth() / 3) * 3 + 3, 0);
    return { from: fmt(qStart), to: fmt(qEnd) };
  }
  if (tl === 'year') {
    return { from: `${yyyy}-01-01`, to: `${yyyy}-12-31` };
  }
  return null;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [timeline, setTimeline] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const range = useMemo(() => getTimelineRange(timeline, dateFrom, dateTo), [timeline, dateFrom, dateTo]);
  const data = useDashboardData(range);

  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const timelineLabel = timeline === 'all' ? '' :
    timeline === 'today' ? ' · today' :
    timeline === 'week' ? ' · this week' :
    timeline === 'month' ? ' · this month' :
    timeline === 'quarter' ? ' · this quarter' :
    timeline === 'year' ? ' · this year' :
    timeline === 'custom' && (dateFrom || dateTo) ? ` · ${dateFrom || '...'} to ${dateTo || '...'}` : '';

  return (
    <AppShell>
      <div className="max-w-[1100px]">
        {/* Page heading */}
        <div className="flex items-start justify-between mb-5 sm:mb-7 flex-wrap gap-3">
          <div className="min-w-0">
            <div className="text-lg sm:text-xl font-medium text-gray-900 truncate">Invoice Dashboard</div>
            <div className="text-[11px] sm:text-xs text-gray-500 mt-1 truncate">{todayStr} · summary across all sites{timelineLabel}</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
            <select value={timeline} onChange={e => { setTimeline(e.target.value); if (e.target.value !== 'custom') { setDateFrom(''); setDateTo(''); } }}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="quarter">This Quarter</option>
              <option value="year">This Year</option>
              <option value="custom">Custom Range</option>
            </select>
            {timeline === 'custom' && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">From</span>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">To</span>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600" />
                </div>
              </>
            )}
            <button onClick={() => navigate('/invoices')}
              className="px-3 sm:px-4 py-2 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d]">
              + New Invoice
            </button>
          </div>
        </div>

        {data.loading ? (
          <div className="text-gray-500 text-sm py-12 text-center">Loading dashboard...</div>
        ) : data.error ? (
          <div className="text-red-600 text-sm py-12 text-center">{data.error}</div>
        ) : (
          <div className="space-y-6">
            <KpiCards kpis={data.kpis} periodLabel={timelineLabel ? timelineLabel.replace(' · ', '') : 'all time'} />
            <VendorDedupPanel />
            <SiteExpenditureTable rows={data.siteRows} kpis={data.kpis} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <DueSoonPanel rows={data.dueSoon} />
              <OverduePanel rows={data.overdueByVendor} totalOverdue={data.kpis.overdueAmount} overdueCount={data.kpis.overdueCount} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <SpendByCategoryPanel rows={data.spendByCategory} />
              <MonthlyTrendPanel rows={data.monthlyTrend} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ── Section 1: KPI Cards ────────────────────────────────────────────────────
function KpiCards({ kpis, periodLabel }: { kpis: Kpis; periodLabel: string }) {
  const cards = [
    { label: 'Total Invoiced', value: formatINR(kpis.totalInvoiced), sub: `${periodLabel} · all sites`, accent: '#1a3c5e', bg: '#e8eef5' },
    { label: 'Total Paid', value: formatINR(kpis.totalPaid), sub: 'payments made to date', accent: '#15803d', bg: '#dcfce7' },
    { label: 'Outstanding', value: formatINR(kpis.outstanding), sub: 'balance owed to vendors', accent: '#1a3c5e', bg: '#eff6ff' },
    { label: 'Overdue', value: formatINR(kpis.overdueAmount), sub: `${kpis.overdueCount} invoices past due`, accent: '#dc2626', bg: '#fef2f2' },
    { label: 'Part-Paid Invoices', value: String(kpis.partPaidCount), sub: 'invoices with partial payment', accent: '#c2410c', bg: '#fff7ed' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map(c => (
        <div
          key={c.label}
          className="rounded-xl p-3 sm:p-5"
          style={{ background: c.bg, border: `1px solid ${c.accent}22` }}
        >
          <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-wider mb-1.5 sm:mb-2.5" style={{ color: c.accent }}>
            {c.label}
          </div>
          <div className="text-base sm:text-[22px] font-semibold leading-none mb-1 sm:mb-1.5 truncate" style={{ color: c.accent }}>
            {c.value}
          </div>
          <div className="text-[10px] sm:text-[11px] truncate" style={{ color: c.accent, opacity: 0.7 }}>
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Vendor Dedup Alert Panel ────────────────────────────────────────────────
function VendorDedupPanel() {
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState<string | null>(null);
  const { notify } = useToast();

  const loadPairs = useCallback(async () => {
    try {
      const data = await getDuplicateVendors();
      setPairs(data);
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => { loadPairs(); }, [loadPairs]);

  const visible = pairs.filter(p => {
    const key = [p.vendorA.id, p.vendorB.id].sort().join(':');
    return !dismissed.has(key);
  });

  if (visible.length === 0) return null;

  function dismiss(pair: DuplicatePair) {
    const key = [pair.vendorA.id, pair.vendorB.id].sort().join(':');
    setDismissed(prev => new Set(prev).add(key));
  }

  async function handleMerge(keepId: string, removeId: string, keepName: string, pair: DuplicatePair) {
    const key = [pair.vendorA.id, pair.vendorB.id].sort().join(':');
    setMerging(key);
    try {
      await mergeVendors(keepId, removeId);
      notify(`Merged into "${keepName}"`);
      setPairs(prev => prev.filter(p => {
        const k = [p.vendorA.id, p.vendorB.id].sort().join(':');
        return k !== key;
      }));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setMerging(null);
    }
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-amber-200">
        <div className="text-sm font-medium text-amber-800">Possible Duplicate Vendors</div>
        <div className="text-[11px] text-amber-700 mt-0.5">
          {visible.length} pair{visible.length !== 1 ? 's' : ''} detected — review and merge if they are the same vendor
        </div>
      </div>
      <div className="divide-y divide-amber-100">
        {visible.map(pair => {
          const key = [pair.vendorA.id, pair.vendorB.id].sort().join(':');
          const isMerging = merging === key;

          return (
            <div key={key} className="px-5 py-3.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900">
                    <span className="font-medium">{pair.vendorA.name}</span>
                    <span className="text-amber-600 mx-2">↔</span>
                    <span className="font-medium">{pair.vendorB.name}</span>
                  </div>
                  <div className="text-[11px] text-amber-700 mt-0.5">{pair.reason}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    disabled={isMerging}
                    onClick={() => handleMerge(pair.vendorA.id, pair.vendorB.id, pair.vendorA.name, pair)}
                    className="px-2.5 py-1.5 text-xs font-medium bg-white border border-amber-300 rounded-lg text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {isMerging ? 'Merging...' : `Keep "${pair.vendorA.name.slice(0, 20)}"`}
                  </button>
                  <button
                    disabled={isMerging}
                    onClick={() => handleMerge(pair.vendorB.id, pair.vendorA.id, pair.vendorB.name, pair)}
                    className="px-2.5 py-1.5 text-xs font-medium bg-white border border-amber-300 rounded-lg text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {isMerging ? 'Merging...' : `Keep "${pair.vendorB.name.slice(0, 20)}"`}
                  </button>
                  <button
                    onClick={() => dismiss(pair)}
                    className="px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                    title="Not duplicates — dismiss"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section 2: Site-wise Expenditure Table ──────────────────────────────────
function SiteExpenditureTable({ rows, kpis }: { rows: SiteRow[]; kpis: Kpis }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-sm font-medium text-gray-900">Site-wise Expenditure</div>
        <div className="text-[11px] text-gray-500 mt-0.5">Invoiced, paid and outstanding balance per project site</div>
      </div>
      <table className="w-full text-[13px]">
        <thead className="bg-gray-50">
          <tr>
            {['Site', 'Invoices', 'Total Invoiced', 'Paid', 'Outstanding', 'Overdue'].map((h, i) => (
              <th key={h} className={`px-5 py-2.5 font-medium text-gray-500 whitespace-nowrap ${i > 1 ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.site} className="border-t border-gray-100">
              <td className="px-5 py-3.5">
                <div className="font-medium text-gray-900 text-[13px]">{r.site}</div>
                <div className="mt-1.5 h-1 rounded-full bg-gray-100 w-24">
                  <div className="h-full rounded-full bg-green-500" style={{ width: `${r.settlementPct}%` }} />
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">{r.settlementPct}% settled</div>
              </td>
              <td className="px-5 py-3.5 text-gray-500 text-xs">{r.invoiceCount}</td>
              <td className="px-5 py-3.5 text-right font-medium text-gray-900">{formatINR(r.totalInvoiced)}</td>
              <td className="px-5 py-3.5 text-right font-medium text-green-700">{formatINR(r.totalPaid)}</td>
              <td className="px-5 py-3.5 text-right font-medium text-[#1a3c5e]">{formatINR(r.outstanding)}</td>
              <td className="px-5 py-3.5 text-right">
                {r.overdue > 0
                  ? <span className="font-medium text-red-600">{formatINR(r.overdue)}</span>
                  : <span className="text-green-600 text-xs">—</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-gray-200 bg-gray-50">
          <tr>
            <td className="px-5 py-2.5 font-medium text-gray-900">All Sites</td>
            <td className="px-5 py-2.5 text-gray-500 text-xs">{kpis.invoiceCount}</td>
            <td className="px-5 py-2.5 text-right font-semibold text-gray-900">{formatINR(kpis.totalInvoiced)}</td>
            <td className="px-5 py-2.5 text-right font-semibold text-green-700">{formatINR(kpis.totalPaid)}</td>
            <td className="px-5 py-2.5 text-right font-semibold text-[#1a3c5e]">{formatINR(kpis.outstanding)}</td>
            <td className="px-5 py-2.5 text-right font-semibold text-red-600">{formatINR(kpis.overdueAmount)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Section 3: Payments Due Next 15 Days ────────────────────────────────────
function DueSoonPanel({ rows }: { rows: DueSoonRow[] }) {
  const total = rows.reduce((s, r) => s + r.balance, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 bg-blue-50">
        <div className="text-sm font-medium text-[#1a3c5e]">Payments Due — Next 15 Days</div>
        <div className="text-[11px] text-[#1a3c5e] opacity-70 mt-0.5">
          {rows.length} invoice{rows.length !== 1 ? 's' : ''} · {formatINR(total)}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="py-7 text-center text-sm text-green-600">No payments falling due in the next 15 days</div>
      ) : (
        rows.map((r, i) => (
          <div key={r.invoiceId} className={`px-5 py-3.5 flex items-center justify-between ${i > 0 ? 'border-t border-gray-100' : ''}`}>
            <div className="flex-1 min-w-0 mr-3">
              <div className="font-medium text-sm text-gray-900 truncate">{r.vendorName}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">{r.site} · Due {formatDate(r.dueDate)}</div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-[15px] font-semibold text-gray-900">{formatINR(r.balance)}</div>
              <span className={`inline-block mt-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${
                r.daysLeft <= 3 ? 'text-red-700 bg-red-100'
                  : r.daysLeft <= 7 ? 'text-orange-700 bg-orange-100'
                    : 'text-[#1a3c5e] bg-blue-50'
              }`}>
                {r.daysLeft === 0 ? 'Due today' : `${r.daysLeft}d left`}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Section 4: Overdue — Action Required ────────────────────────────────────
function OverduePanel({ rows, totalOverdue, overdueCount }: { rows: VendorOverdue[]; totalOverdue: number; overdueCount: number }) {
  return (
    <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-red-200 bg-red-50">
        <div className="text-sm font-medium text-red-700">Overdue — Action Required</div>
        <div className="text-[11px] text-red-600 opacity-70 mt-0.5">
          {overdueCount} invoice{overdueCount !== 1 ? 's' : ''} · {formatINR(totalOverdue)}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="py-7 text-center text-sm text-green-600">No overdue invoices</div>
      ) : (
        <>
          {rows.slice(0, 6).map((r, i) => (
            <div key={r.vendorName} className={`px-5 py-3.5 flex items-center justify-between ${i > 0 ? 'border-t border-gray-100' : ''}`}>
              <div className="flex-1 min-w-0 mr-3">
                <div className="font-medium text-sm text-gray-900 truncate">{r.vendorName}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {r.invoiceCount} invoice{r.invoiceCount !== 1 ? 's' : ''} · max {r.maxDaysPastDue} days overdue
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[15px] font-semibold text-red-600">{formatINR(r.totalBalance)}</div>
                <span className="inline-block mt-1 text-[11px] font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-md">
                  overdue
                </span>
              </div>
            </div>
          ))}
          {rows.length > 6 && (
            <div className="px-5 py-3 border-t border-gray-100 text-center">
              <Link to="/payment-aging" className="text-xs text-blue-600 hover:underline">+{rows.length - 6} more — see Payment Aging tab</Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Section 5: Spend by Category ────────────────────────────────────────────
function SpendByCategoryPanel({ rows }: { rows: CategorySpend[] }) {
  const top7 = rows.slice(0, 7);
  const chartData = top7.map(r => ({
    name: r.purpose,
    paid: r.totalPaid,
    outstanding: r.outstanding,
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-sm font-medium text-gray-900">Spend by Category</div>
        <div className="text-[11px] text-gray-500 mt-0.5">Top categories by total invoiced — green bar = paid, navy = outstanding</div>
      </div>
      <div className="px-5 py-3">
        {rows.length === 0 ? (
          <div className="py-5 text-center text-sm text-gray-400">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={top7.length * 50 + 40}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis type="number" tickFormatter={(v: number) => formatINR(v)} tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12, fill: '#374151' }} />
              <Tooltip
                formatter={(value) => formatINR(Number(value ?? 0))}
                labelStyle={{ fontWeight: 600, color: '#111827' }}
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}
              />
              <Bar dataKey="paid" stackId="a" fill="#22c55e" name="Paid" radius={[0, 0, 0, 0]} />
              <Bar dataKey="outstanding" stackId="a" fill="#1a3c5e" name="Outstanding" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ── Section 6: Monthly Trend ────────────────────────────────────────────────
function MonthlyTrendPanel({ rows }: { rows: MonthTrend[] }) {
  function monthLabel(ym: string): string {
    const [y, m] = ym.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(m, 10) - 1]} ${y.slice(2)}`;
  }

  const chartData = rows.map(r => ({
    name: monthLabel(r.month),
    invoiced: r.totalInvoiced,
    paid: r.totalPaid,
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-sm font-medium text-gray-900">Monthly Trend</div>
        <div className="text-[11px] text-gray-500 mt-0.5">Invoice value booked vs actual payments made each month</div>
      </div>
      <div className="px-5 py-3">
        {rows.length === 0 ? (
          <div className="py-5 text-center text-sm text-gray-400">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tickFormatter={(v: number) => formatINR(v)} tick={{ fontSize: 11, fill: '#6b7280' }} width={80} />
              <Tooltip
                formatter={(value) => formatINR(Number(value ?? 0))}
                labelStyle={{ fontWeight: 600, color: '#111827' }}
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}
              />
              <Bar dataKey="invoiced" fill="#1a3c5e" name="Invoiced" radius={[4, 4, 0, 0]} />
              <Bar dataKey="paid" fill="#22c55e" name="Paid" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
