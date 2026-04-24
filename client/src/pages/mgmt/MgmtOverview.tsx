import { useMemo } from 'react';
import { useDashboardData } from '../../hooks/useDashboardData';
import { useInvoices } from '../../hooks/useInvoices';
import { formatINR, formatDate } from '../../utils/formatters';
import AppShell from '../../components/layout/AppShell';

export default function MgmtOverview() {
  const data = useDashboardData();
  const { invoices } = useInvoices();

  const disputeSummary = useMemo(() => {
    const disputed = invoices.filter(i => i.disputed);
    const major = disputed.filter(i => i.dispute_severity === 'major');
    const minor = disputed.filter(i => i.dispute_severity === 'minor');
    const amount = disputed.reduce((s, i) => s + Number(i.invoice_amount ?? 0), 0);
    return { disputed, major, minor, amount };
  }, [invoices]);

  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <AppShell>
      <div className="max-w-[1100px]">
        <div className="mb-5 sm:mb-7">
          <div className="text-lg sm:text-xl font-medium text-gray-900">Overview</div>
          <div className="text-[11px] sm:text-xs text-gray-500 mt-1 truncate">{todayStr} · Accounting Module · All Sites</div>
        </div>

        {data.loading ? (
          <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
        ) : data.error ? (
          <div className="text-red-600 text-sm py-12 text-center">{data.error}</div>
        ) : (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: 'Total Invoiced', value: formatINR(data.kpis.totalInvoiced), sub: 'all time · all sites', accent: '#1a3c5e', bg: '#e8eef5' },
                { label: 'Total Paid', value: formatINR(data.kpis.totalPaid), sub: 'payments made to date', accent: '#15803d', bg: '#dcfce7' },
                { label: 'Outstanding', value: formatINR(data.kpis.outstanding), sub: 'balance owed to vendors', accent: '#1a3c5e', bg: '#eff6ff' },
                { label: 'Overdue', value: formatINR(data.kpis.overdueAmount), sub: `${data.kpis.overdueCount} invoices past due`, accent: '#dc2626', bg: '#fef2f2' },
                { label: 'Part-Paid Invoices', value: String(data.kpis.partPaidCount), sub: 'invoices with partial payment', accent: '#c2410c', bg: '#fff7ed' },
                {
                  label: 'Disputed',
                  value: String(disputeSummary.disputed.length),
                  sub: disputeSummary.disputed.length === 0
                    ? 'no disputes raised'
                    : `${disputeSummary.major.length} major · ${disputeSummary.minor.length} minor`,
                  accent: disputeSummary.major.length > 0 ? '#b91c1c' : '#b45309',
                  bg: disputeSummary.major.length > 0 ? '#fef2f2' : '#fffbeb',
                },
              ].map(c => (
                <div key={c.label} className="rounded-xl p-3 sm:p-5" style={{ background: c.bg, border: `1px solid ${c.accent}22` }}>
                  <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-wider mb-1.5 sm:mb-2.5" style={{ color: c.accent }}>{c.label}</div>
                  <div className="text-base sm:text-[22px] font-semibold leading-none mb-1 sm:mb-1.5 truncate" style={{ color: c.accent }}>{c.value}</div>
                  <div className="text-[10px] sm:text-[11px] truncate" style={{ color: c.accent, opacity: 0.7 }}>{c.sub}</div>
                </div>
              ))}
            </div>

            {/* Site-wise Position */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="text-sm font-medium text-gray-900">Site-wise Position</div>
                <div className="text-[11px] text-gray-500 mt-0.5">Invoiced, paid and outstanding balance per project site</div>
              </div>
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50">
                  <tr>
                    {['Site', 'Invoices', 'Total Invoiced', 'Paid', 'Outstanding', 'Overdue'].map((h, i) => (
                      <th key={h} className={`px-5 py-2.5 font-medium text-gray-500 whitespace-nowrap ${i > 1 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.siteRows.map(r => (
                    <tr key={r.site} className="border-t border-gray-100">
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-gray-900">{r.site}</div>
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
                        {r.overdue > 0 ? <span className="font-medium text-red-600">{formatINR(r.overdue)}</span> : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                  <tr>
                    <td className="px-5 py-2.5 font-medium text-gray-900">All Sites</td>
                    <td className="px-5 py-2.5 text-gray-500 text-xs">{data.kpis.invoiceCount}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-gray-900">{formatINR(data.kpis.totalInvoiced)}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-green-700">{formatINR(data.kpis.totalPaid)}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-[#1a3c5e]">{formatINR(data.kpis.outstanding)}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-red-600">{formatINR(data.kpis.overdueAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Due soon + Overdue */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Payments Due Next 15 Days */}
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 bg-blue-50">
                  <div className="text-sm font-medium text-[#1a3c5e]">Payments Due — Next 15 Days</div>
                  <div className="text-[11px] text-[#1a3c5e] opacity-70 mt-0.5">
                    {data.dueSoon.length} invoice{data.dueSoon.length !== 1 ? 's' : ''} · {formatINR(data.dueSoon.reduce((s, r) => s + r.balance, 0))}
                  </div>
                </div>
                {data.dueSoon.length === 0 ? (
                  <div className="py-7 text-center text-sm text-green-600">No payments falling due in the next 15 days</div>
                ) : data.dueSoon.map((r, i) => (
                  <div key={r.invoiceId} className={`px-5 py-3.5 flex items-center justify-between ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                    <div className="flex-1 min-w-0 mr-3">
                      <div className="font-medium text-sm text-gray-900 truncate">{r.vendorName}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">{r.site} · Due {formatDate(r.dueDate)}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[15px] font-semibold text-gray-900">{formatINR(r.balance)}</div>
                      <span className={`inline-block mt-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${
                        r.daysLeft <= 3 ? 'text-red-700 bg-red-100' : r.daysLeft <= 7 ? 'text-orange-700 bg-orange-100' : 'text-[#1a3c5e] bg-blue-50'
                      }`}>{r.daysLeft === 0 ? 'Due today' : `${r.daysLeft}d left`}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Overdue */}
              <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-red-200 bg-red-50">
                  <div className="text-sm font-medium text-red-700">Overdue — Action Required</div>
                  <div className="text-[11px] text-red-600 opacity-70 mt-0.5">
                    {data.kpis.overdueCount} invoice{data.kpis.overdueCount !== 1 ? 's' : ''} · {formatINR(data.kpis.overdueAmount)}
                  </div>
                </div>
                {data.overdueByVendor.length === 0 ? (
                  <div className="py-7 text-center text-sm text-green-600">No overdue invoices</div>
                ) : data.overdueByVendor.map((r, i) => (
                  <div key={r.vendorName} className={`px-5 py-3.5 flex items-center justify-between ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                    <div className="flex-1 min-w-0 mr-3">
                      <div className="font-medium text-sm text-gray-900 truncate">{r.vendorName}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">{r.invoiceCount} invoice{r.invoiceCount !== 1 ? 's' : ''} · max {r.maxDaysPastDue} days overdue</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[15px] font-semibold text-red-600">{formatINR(r.totalBalance)}</div>
                      <span className="inline-block mt-1 text-[11px] font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-md">overdue</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Disputed Invoices */}
            {disputeSummary.disputed.length > 0 && (
              <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-red-200 bg-red-50 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-red-700">Disputed Invoices</div>
                    <div className="text-[11px] text-red-600 opacity-70 mt-0.5">
                      {disputeSummary.disputed.length} flagged · {formatINR(disputeSummary.amount)} total
                      {disputeSummary.major.length > 0 && ` · ${disputeSummary.major.length} major`}
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Severity', 'Vendor', 'Invoice', 'Site', 'Amount', 'Reason', 'Flagged'].map((h, i) => (
                          <th key={h} className={`px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap ${i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...disputeSummary.major, ...disputeSummary.minor].map(inv => (
                        <tr
                          key={inv.id}
                          className={`border-t border-gray-100 ${inv.dispute_severity === 'major' ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-amber-400'}`}
                        >
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                              inv.dispute_severity === 'major' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                            }`}>{inv.dispute_severity}</span>
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-900">{inv.vendor_name}</td>
                          <td className="px-4 py-3 text-gray-600">{inv.invoice_no ?? inv.internal_no ?? '—'}</td>
                          <td className="px-4 py-3 text-gray-500">{inv.site}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatINR(Number(inv.invoice_amount))}</td>
                          <td className="px-4 py-3 text-xs text-gray-600 max-w-[320px] truncate" title={inv.dispute_reason ?? ''}>{inv.dispute_reason ?? '—'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{inv.disputed_at ? formatDate(inv.disputed_at) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
