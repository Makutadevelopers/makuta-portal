import { useState, useEffect, useMemo } from 'react';
import { useSites } from '../../hooks/useSites';
import { getAnalytics, AnalyticsResponse } from '../../api/analytics';
import { useReloadOnFocus } from '../../hooks/useReloadOnFocus';
import { useAuth } from '../../hooks/useAuth';
import { formatINR } from '../../utils/formatters';
import AppShell from '../../components/layout/AppShell';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

const EMPTY: AnalyticsResponse = { monthly: [], vendors: [], availableMonths: [] };

const NAVY = '#1a3c5e';
const GREEN = '#22c55e';
const RED = '#dc2626';
const ORANGE = '#c2410c';

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

/** Compact ₹ for axis ticks: ₹2.5L, ₹1.2Cr. Full value lives in the tooltip. */
function shortINR(v: number): string {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v % 1e7 === 0 ? 0 : 1)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v % 1e5 === 0 ? 0 : 1)}L`;
  if (v >= 1e3) return `₹${Math.round(v / 1e3)}K`;
  return `₹${v}`;
}

interface Totals {
  invoiceCount: number;
  totalInvoiced: number;
  clearedCount: number;
  totalCleared: number;
  balance: number;
}

export default function Analytics() {
  // Projects come from the DB-backed Project Master (HO manages them at
  // /projects). useSites falls back to the static seed list while the request
  // is in flight, so this dropdown is never empty.
  const { names: SITES } = useSites();
  const { user } = useAuth();
  // Project managers only see their assigned sites/projects in the picker; the
  // server scopes analytics to those sites regardless.
  const visibleSites = user?.role === 'project_manager' && user.sites?.length ? user.sites : SITES;
  const [data, setData] = useState<AnalyticsResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fSite, setFSite] = useState('All');
  const [fMonth, setFMonth] = useState('All');

  // availableMonths is independent of the month filter, so capture it from the
  // first (or any All-month) load so the dropdown never empties itself.
  const [monthOptions, setMonthOptions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAnalytics(fSite, fMonth)
      .then(res => {
        if (cancelled) return;
        setData(res);
        if (fMonth === 'All') setMonthOptions(res.availableMonths);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load analytics');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fSite, fMonth]);

  // Silent refresh on focus so figures reflect edits made elsewhere (no spinner).
  useReloadOnFocus(() => {
    getAnalytics(fSite, fMonth)
      .then(res => { setData(res); if (fMonth === 'All') setMonthOptions(res.availableMonths); })
      .catch(() => {});
  });

  // Reset month filter when switching site if the selected month vanishes.
  useEffect(() => {
    if (fMonth !== 'All' && monthOptions.length > 0 && !monthOptions.includes(fMonth)) {
      setFMonth('All');
    }
  }, [monthOptions, fMonth]);

  const chartData = useMemo(
    () => data.monthly.map(r => ({
      name: monthLabel(r.month),
      invoiced: Number(r.totalInvoiced),
      paid: Number(r.totalPaid),
      balance: Number(r.balance),
      count: Number(r.invoiceCount),
    })),
    [data.monthly],
  );

  const totals = useMemo<Totals>(() => {
    return data.vendors.reduce<Totals>(
      (acc, v) => ({
        invoiceCount: acc.invoiceCount + Number(v.invoiceCount),
        totalInvoiced: acc.totalInvoiced + Number(v.totalInvoiced),
        clearedCount: acc.clearedCount + Number(v.clearedCount),
        totalCleared: acc.totalCleared + Number(v.totalCleared),
        balance: acc.balance + Number(v.balance),
      }),
      { invoiceCount: 0, totalInvoiced: 0, clearedCount: 0, totalCleared: 0, balance: 0 },
    );
  }, [data.vendors]);

  const settledPct = totals.totalInvoiced > 0
    ? Math.round((totals.totalCleared / totals.totalInvoiced) * 100)
    : 0;

  const scopeLabel = `${fSite === 'All' ? 'All projects' : fSite} · ${fMonth === 'All' ? 'All months' : monthLabel(fMonth)}`;

  return (
    <AppShell>
      <div className="max-w-[1100px]">
        {/* Heading + filters */}
        <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
          <div className="min-w-0">
            <div className="text-lg sm:text-xl font-medium text-gray-900 truncate">Invoice Analytics</div>
            <div className="text-[11px] sm:text-xs text-gray-500 mt-1 truncate">
              How much we billed, how much we have paid, and what is still owed — {scopeLabel}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
            <select
              value={fSite}
              onChange={e => setFSite(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600"
            >
              <option value="All">All Projects</option>
              {visibleSites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={fMonth}
              onChange={e => setFMonth(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600"
            >
              <option value="All">All Months</option>
              {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="text-gray-500 text-sm py-12 text-center">Loading analytics...</div>
        ) : error ? (
          <div className="text-red-600 text-sm py-12 text-center">{error}</div>
        ) : (
          <div className="space-y-6">
            <KpiCards totals={totals} settledPct={settledPct} />
            <MonthlyChart chartData={chartData} singleMonth={fMonth !== 'All'} />
            <VendorTable data={data} totals={totals} />
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ── KPI summary cards ───────────────────────────────────────────────────────
function KpiCards({ totals, settledPct }: { totals: Totals; settledPct: number }) {
  const cards = [
    { label: 'Invoices Raised', value: String(totals.invoiceCount), sub: `${totals.clearedCount} fully cleared`, accent: NAVY, bg: '#e8eef5' },
    { label: 'Total Invoiced', value: formatINR(totals.totalInvoiced), sub: 'gross value billed', accent: NAVY, bg: '#eff6ff' },
    { label: 'Total Paid', value: formatINR(totals.totalCleared), sub: `${settledPct}% of invoiced settled`, accent: '#15803d', bg: '#dcfce7' },
    { label: 'Balance Outstanding', value: formatINR(totals.balance), sub: 'still owed to vendors', accent: RED, bg: '#fef2f2' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(c => (
        <div key={c.label} className="rounded-xl p-3 sm:p-5" style={{ background: c.bg, border: `1px solid ${c.accent}22` }}>
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

// ── Monthly stacked chart ───────────────────────────────────────────────────
interface ChartPoint {
  name: string;
  invoiced: number;
  paid: number;
  balance: number;
  count: number;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string;
  payload?: { payload: ChartPoint }[];
}

function ChartTooltip({ active, label, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const rows: { color: string; label: string; value: string }[] = [
    { color: NAVY, label: 'Invoiced', value: formatINR(p.invoiced) },
    { color: GREEN, label: 'Paid', value: formatINR(p.paid) },
    { color: RED, label: 'Outstanding', value: formatINR(p.balance) },
  ];
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
      <div style={{ fontWeight: 600, color: '#111827', marginBottom: 6 }}>{label}</div>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, marginTop: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#4b5563' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, display: 'inline-block' }} />
            {r.label}
          </span>
          <span style={{ fontWeight: 600, color: '#111827' }}>{r.value}</span>
        </div>
      ))}
      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #f0f0f0', color: '#6b7280' }}>
        {p.count} invoice{p.count !== 1 ? 's' : ''} raised
      </div>
    </div>
  );
}

function MonthlyChart({ chartData, singleMonth }: { chartData: ChartPoint[]; singleMonth: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-sm font-medium text-gray-900">Billed vs Paid by Month</div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          Each bar is the total invoiced that month — <span className="text-green-700 font-medium">green</span> is paid,
          {' '}<span className="text-red-600 font-medium">red</span> is still outstanding. The line tracks how many invoices were raised.
        </div>
      </div>
      <div className="px-5 py-4">
        {chartData.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">No invoices for this selection</div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart
              data={chartData}
              margin={{ top: 10, right: 12, left: 6, bottom: 5 }}
              barCategoryGap={singleMonth ? '60%' : '25%'}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
              <YAxis
                yAxisId="amount"
                tickFormatter={shortINR}
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                allowDecimals={false}
                tick={{ fontSize: 11, fill: ORANGE }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(26,60,94,0.04)' }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Bar yAxisId="amount" dataKey="paid" stackId="money" fill={GREEN} name="Paid" maxBarSize={64} />
              <Bar yAxisId="amount" dataKey="balance" stackId="money" fill={RED} name="Outstanding" radius={[4, 4, 0, 0]} maxBarSize={64} />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="count"
                stroke={ORANGE}
                strokeWidth={2}
                name="Invoices raised"
                dot={{ r: 3, fill: ORANGE }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ── Vendor-wise breakdown ───────────────────────────────────────────────────
function VendorTable({ data, totals }: { data: AnalyticsResponse; totals: Totals }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-y-auto overflow-x-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-sm font-medium text-gray-900">Vendor-wise Breakdown</div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          Per vendor — invoices raised &amp; cleared, total billed, amount paid, and outstanding balance. Sorted by balance owed.
        </div>
      </div>
      <table className="w-full table-fixed text-[13px]">
        <colgroup>
          <col style={{ width: '36%' }} />{/* Vendor */}
          <col style={{ width: '16%' }} />{/* Invoices */}
          <col style={{ width: '16%' }} />{/* Total Invoiced */}
          <col style={{ width: '16%' }} />{/* Paid */}
          <col style={{ width: '16%' }} />{/* Balance */}
        </colgroup>
        <thead className="bg-gray-50">
          <tr>
            {['Vendor', 'Invoices', 'Total Invoiced', 'Paid', 'Balance'].map((h, i) => (
              <th key={h} className={`px-5 py-2.5 font-medium text-gray-500 whitespace-nowrap ${i > 0 ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.vendors.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-400">No vendors for this selection</td>
            </tr>
          ) : (
            data.vendors.map(v => {
              const invoiced = Number(v.totalInvoiced);
              const paid = Number(v.totalCleared);
              const balance = Number(v.balance);
              const pct = invoiced > 0 ? Math.round((paid / invoiced) * 100) : 0;
              return (
                <tr key={v.vendorName} className="border-t border-gray-100">
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-gray-900 text-[13px] truncate max-w-[260px]">{v.vendorName}</div>
                    <div className="mt-1.5 h-1 rounded-full bg-gray-100 w-28">
                      <div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{pct}% paid</div>
                  </td>
                  <td className="px-5 py-3.5 text-right text-gray-600 text-xs whitespace-nowrap">
                    {v.invoiceCount}
                    <span className="text-gray-400"> · {v.clearedCount} cleared</span>
                  </td>
                  <td className="px-5 py-3.5 text-right font-medium text-gray-900">{formatINR(invoiced)}</td>
                  <td className="px-5 py-3.5 text-right font-medium text-green-700">{formatINR(paid)}</td>
                  <td className="px-5 py-3.5 text-right">
                    {balance > 0
                      ? <span className="font-medium text-red-600">{formatINR(balance)}</span>
                      : <span className="inline-block text-[11px] font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-md">Settled</span>}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        {data.vendors.length > 0 && (
          <tfoot className="border-t-2 border-gray-200 bg-gray-50">
            <tr>
              <td className="px-5 py-2.5 font-medium text-gray-900">All Vendors</td>
              <td className="px-5 py-2.5 text-right text-gray-600 text-xs whitespace-nowrap">
                {totals.invoiceCount}
                <span className="text-gray-400"> · {totals.clearedCount} cleared</span>
              </td>
              <td className="px-5 py-2.5 text-right font-semibold text-gray-900">{formatINR(totals.totalInvoiced)}</td>
              <td className="px-5 py-2.5 text-right font-semibold text-green-700">{formatINR(totals.totalCleared)}</td>
              <td className="px-5 py-2.5 text-right font-semibold text-red-600">{formatINR(totals.balance)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
