import { useState, useEffect, useMemo } from 'react';
import { getAnalytics, AnalyticsResponse } from '../../api/analytics';
import { formatINR } from '../../utils/formatters';
import { SITES } from '../../utils/constants';
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

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

export default function Analytics() {
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

  const totals = useMemo(() => {
    return data.vendors.reduce(
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

  const scopeLabel = `${fSite === 'All' ? 'all sites' : fSite}${fMonth === 'All' ? '' : ` · ${monthLabel(fMonth)}`}`;

  return (
    <AppShell>
      <div className="max-w-[1100px]">
        {/* Heading + filters */}
        <div className="flex items-start justify-between mb-5 sm:mb-7 flex-wrap gap-3">
          <div className="min-w-0">
            <div className="text-lg sm:text-xl font-medium text-gray-900 truncate">Invoice Analytics</div>
            <div className="text-[11px] sm:text-xs text-gray-500 mt-1 truncate">
              Invoices raised, billed, paid &amp; outstanding · {scopeLabel}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
            <select
              value={fSite}
              onChange={e => setFSite(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600"
            >
              <option value="All">All Projects</option>
              {SITES.map(s => <option key={s} value={s}>{s}</option>)}
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
            <MonthlyChart chartData={chartData} />
            <VendorTable data={data} totals={totals} />
          </div>
        )}
      </div>
    </AppShell>
  );
}

interface ChartPoint {
  name: string;
  invoiced: number;
  paid: number;
  balance: number;
  count: number;
}

function MonthlyChart({ chartData }: { chartData: ChartPoint[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-sm font-medium text-gray-900">Monthly Invoice Analysis</div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          Bars: total invoiced (navy), paid (green) &amp; balance (red) per month · Line: number of invoices raised
        </div>
      </div>
      <div className="px-5 py-4">
        {chartData.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">No invoices for this selection</div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis
                yAxisId="amount"
                tickFormatter={(v: number) => formatINR(v)}
                tick={{ fontSize: 11, fill: '#6b7280' }}
                width={80}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                allowDecimals={false}
                tick={{ fontSize: 11, fill: '#6b7280' }}
                width={40}
              />
              <Tooltip
                formatter={(value, name) =>
                  name === 'Invoices'
                    ? [String(value), name]
                    : [formatINR(Number(value ?? 0)), name]
                }
                labelStyle={{ fontWeight: 600, color: '#111827' }}
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="amount" dataKey="invoiced" fill="#1a3c5e" name="Invoiced" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="amount" dataKey="paid" fill="#22c55e" name="Paid" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="amount" dataKey="balance" fill="#dc2626" name="Balance" radius={[4, 4, 0, 0]} />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="count"
                stroke="#c2410c"
                strokeWidth={2}
                name="Invoices"
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

interface VendorTotals {
  invoiceCount: number;
  totalInvoiced: number;
  clearedCount: number;
  totalCleared: number;
  balance: number;
}

function VendorTable({ data, totals }: { data: AnalyticsResponse; totals: VendorTotals }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-sm font-medium text-gray-900">Vendor-wise Breakdown</div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          Invoices raised, total billed, invoices cleared, amount paid &amp; outstanding balance per vendor
        </div>
      </div>
      <table className="w-full text-[13px]">
        <thead className="bg-gray-50">
          <tr>
            {['Vendor', 'Invoices', 'Total Invoiced', 'Cleared', 'Total Cleared', 'Balance'].map((h, i) => (
              <th key={h} className={`px-5 py-2.5 font-medium text-gray-500 whitespace-nowrap ${i > 0 ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.vendors.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-5 py-8 text-center text-sm text-gray-400">No vendors for this selection</td>
            </tr>
          ) : (
            data.vendors.map(v => (
              <tr key={v.vendorName} className="border-t border-gray-100">
                <td className="px-5 py-3.5 font-medium text-gray-900">{v.vendorName}</td>
                <td className="px-5 py-3.5 text-right text-gray-500 text-xs">{v.invoiceCount}</td>
                <td className="px-5 py-3.5 text-right font-medium text-gray-900">{formatINR(Number(v.totalInvoiced))}</td>
                <td className="px-5 py-3.5 text-right text-gray-500 text-xs">{v.clearedCount} / {v.invoiceCount}</td>
                <td className="px-5 py-3.5 text-right font-medium text-green-700">{formatINR(Number(v.totalCleared))}</td>
                <td className="px-5 py-3.5 text-right">
                  {Number(v.balance) > 0
                    ? <span className="font-medium text-red-600">{formatINR(Number(v.balance))}</span>
                    : <span className="text-green-600 text-xs">Settled</span>}
                </td>
              </tr>
            ))
          )}
        </tbody>
        {data.vendors.length > 0 && (
          <tfoot className="border-t-2 border-gray-200 bg-gray-50">
            <tr>
              <td className="px-5 py-2.5 font-medium text-gray-900">All Vendors</td>
              <td className="px-5 py-2.5 text-right text-gray-500 text-xs">{totals.invoiceCount}</td>
              <td className="px-5 py-2.5 text-right font-semibold text-gray-900">{formatINR(totals.totalInvoiced)}</td>
              <td className="px-5 py-2.5 text-right text-gray-500 text-xs">{totals.clearedCount} / {totals.invoiceCount}</td>
              <td className="px-5 py-2.5 text-right font-semibold text-green-700">{formatINR(totals.totalCleared)}</td>
              <td className="px-5 py-2.5 text-right font-semibold text-red-600">{formatINR(totals.balance)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
