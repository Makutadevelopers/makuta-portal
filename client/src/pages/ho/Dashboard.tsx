import { useNavigate } from 'react-router-dom';
import { useDashboardData, Kpis, SiteRow, DueSoonRow, VendorOverdue, CategorySpend, MonthTrend } from '../../hooks/useDashboardData';
import { formatINR, formatDate } from '../../utils/formatters';
import AppShell from '../../components/layout/AppShell';

export default function Dashboard() {
  const data = useDashboardData();
  const navigate = useNavigate();

  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <AppShell>
      <div className="max-w-[1100px]">
        {/* Page heading */}
        <div className="flex items-center justify-between mb-7 flex-wrap gap-3">
          <div>
            <div className="text-xl font-medium text-gray-900">Management Dashboard</div>
            <div className="text-xs text-gray-500 mt-1">{todayStr} · Accounting Module</div>
          </div>
          <button onClick={() => navigate('/invoices')}
            className="px-4 py-2 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d]">
            + New Invoice
          </button>
        </div>

        {data.loading ? (
          <div className="text-gray-500 text-sm py-12 text-center">Loading dashboard...</div>
        ) : data.error ? (
          <div className="text-red-600 text-sm py-12 text-center">{data.error}</div>
        ) : (
          <div className="space-y-6">
            <KpiCards kpis={data.kpis} />
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
function KpiCards({ kpis }: { kpis: Kpis }) {
  const cards = [
    { label: 'Total Invoiced', value: formatINR(kpis.totalInvoiced), sub: `all time · all sites`, accent: '#1a3c5e', bg: '#e8eef5' },
    { label: 'Total Paid', value: formatINR(kpis.totalPaid), sub: 'payments made to date', accent: '#15803d', bg: '#dcfce7' },
    { label: 'Outstanding', value: formatINR(kpis.outstanding), sub: 'balance owed to vendors', accent: '#1a3c5e', bg: '#eff6ff' },
    { label: 'Overdue', value: formatINR(kpis.overdueAmount), sub: `${kpis.overdueCount} invoices past due`, accent: '#dc2626', bg: '#fef2f2' },
    { label: 'Part-Paid Invoices', value: String(kpis.partPaidCount), sub: 'invoices with partial payment', accent: '#c2410c', bg: '#fff7ed' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
      {cards.map(c => (
        <div
          key={c.label}
          className="rounded-xl p-5"
          style={{ background: c.bg, border: `1px solid ${c.accent}22` }}
        >
          <div className="text-[11px] font-medium uppercase tracking-wider mb-2.5" style={{ color: c.accent }}>
            {c.label}
          </div>
          <div className="text-[22px] font-semibold leading-none mb-1.5" style={{ color: c.accent }}>
            {c.value}
          </div>
          <div className="text-[11px]" style={{ color: c.accent, opacity: 0.7 }}>
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Section 2: Site-wise Expenditure Table ──────────────────────────────────
function SiteExpenditureTable({ rows, kpis }: { rows: SiteRow[]; kpis: Kpis }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
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
              <a href="/payment-aging" className="text-xs text-blue-600 hover:underline">+{rows.length - 6} more — see Payment Aging tab</a>
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
  const maxInvoiced = Math.max(...top7.map(r => r.totalInvoiced), 1);

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-sm font-medium text-gray-900">Spend by Category</div>
        <div className="text-[11px] text-gray-500 mt-0.5">Top categories by total invoiced — green bar = paid, grey = outstanding</div>
      </div>
      <div className="px-5 py-3 space-y-4">
        {top7.map(r => {
          const barWidth = (r.totalInvoiced / maxInvoiced) * 100;
          const paidPct = r.totalInvoiced > 0 ? (r.totalPaid / r.totalInvoiced) * 100 : 0;

          return (
            <div key={r.purpose}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-gray-900">{r.purpose}</span>
                <span className="text-xs text-gray-500">
                  {formatINR(r.totalInvoiced)}
                  {r.outstanding > 0 && (
                    <span className="text-red-500 ml-1.5">{formatINR(r.outstanding)} outstanding</span>
                  )}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-gray-100" style={{ width: `${barWidth}%` }}>
                <div className="h-full rounded-full bg-green-500" style={{ width: `${paidPct}%` }} />
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="py-5 text-center text-sm text-gray-400">No data</div>
        )}
      </div>
    </div>
  );
}

// ── Section 6: Monthly Trend ────────────────────────────────────────────────
function MonthlyTrendPanel({ rows }: { rows: MonthTrend[] }) {
  const maxVal = Math.max(...rows.map(r => r.totalInvoiced), 1);

  function monthLabel(ym: string): string {
    const [y, m] = ym.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(m, 10) - 1]} ${y.slice(2)}`;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-sm font-medium text-gray-900">Monthly Trend</div>
        <div className="text-[11px] text-gray-500 mt-0.5">Invoice value booked vs actual payments made each month</div>
      </div>
      <div className="px-5 py-3 space-y-4">
        {rows.map(r => {
          const invW = (r.totalInvoiced / maxVal) * 100;
          const paidW = (r.totalPaid / maxVal) * 100;

          return (
            <div key={r.month}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-gray-700 w-14">{monthLabel(r.month)}</span>
                <span className="text-xs text-gray-500">
                  {formatINR(r.totalInvoiced)} invoiced · {formatINR(r.totalPaid)} paid
                  {r.gap > 0 && (
                    <span className="text-red-500 ml-1">(gap {formatINR(r.gap)})</span>
                  )}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-8">Inv.</span>
                  <div className="h-2 rounded-full bg-[#1a3c5e]" style={{ width: `${invW}%` }} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-8">Paid</span>
                  <div className="h-2 rounded-full bg-green-500" style={{ width: `${paidW}%` }} />
                </div>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="py-5 text-center text-sm text-gray-400">No data</div>
        )}
      </div>
    </div>
  );
}
