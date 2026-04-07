import { useState } from 'react';
import { useAgingCalc } from '../../hooks/useAgingCalc';
import { formatINR, formatDate } from '../../utils/formatters';
import { SITES } from '../../utils/constants';
import AppShell from '../../components/layout/AppShell';

export default function PaymentAging() {
  const [site, setSite] = useState('All');
  const { withinTerms, overdue, loading } = useAgingCalc(site);

  const totalOutstanding = [...withinTerms, ...overdue].reduce((s, r) => s + Number(r.balance), 0);
  const withinTotal = withinTerms.reduce((s, r) => s + Number(r.balance), 0);
  const overdueTotal = overdue.reduce((s, r) => s + Number(r.balance), 0);

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Payment Aging</div>
          <div className="text-xs text-gray-500 mt-1">Due dates are calculated from each vendor's individual payment terms</div>
        </div>
        <div className="flex items-center gap-2">
          <select value={site} onChange={e => setSite(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
            <option value="All">All Sites</option>
            {SITES.map(s => <option key={s}>{s}</option>)}
          </select>
          <a href={`/api/export/aging?site=${encodeURIComponent(site)}`} target="_blank" rel="noopener noreferrer"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Export PDF
          </a>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Total Outstanding</div>
              <div className="text-2xl font-semibold text-gray-900">{formatINR(totalOutstanding)}</div>
              <div className="text-xs text-gray-400 mt-1">{withinTerms.length + overdue.length} invoices pending</div>
            </div>
            <div className="bg-green-50 rounded-xl border border-green-100 p-5">
              <div className="text-xs font-medium text-green-700 uppercase tracking-wider mb-2">Within Terms</div>
              <div className="text-2xl font-semibold text-green-700">{formatINR(withinTotal)}</div>
              <div className="text-xs text-green-600 mt-1">{withinTerms.length} — payment not yet due</div>
            </div>
            <div className="bg-red-50 rounded-xl border border-red-100 p-5">
              <div className="text-xs font-medium text-red-700 uppercase tracking-wider mb-2">Overdue</div>
              <div className="text-2xl font-semibold text-red-600">{formatINR(overdueTotal)}</div>
              <div className="text-xs text-red-500 mt-1">{overdue.length} — past vendor due date</div>
            </div>
          </div>

          {/* Within Terms table */}
          <AgingTable
            title="Within Terms — payment not yet due"
            subtitle={`${withinTerms.length} invoices · ${formatINR(withinTotal)}`}
            rows={withinTerms}
            isOverdue={false}
          />

          {/* Overdue table */}
          <AgingTable
            title="Overdue — past vendor due date"
            subtitle={`${overdue.length} invoices · ${formatINR(overdueTotal)}`}
            rows={overdue}
            isOverdue={true}
          />
        </>
      )}
    </AppShell>
  );
}

interface AgingRow {
  invoice_id: string;
  invoice_no: string;
  vendor_name: string;
  site: string;
  invoice_date: string;
  invoice_amount: number;
  payment_terms: number;
  due_date: string;
  total_paid: number;
  balance: number;
  days_past_due: number;
  days_left: number;
  overdue: boolean;
  payment_status: string;
}

function AgingTable({ title, subtitle, rows, isOverdue }: {
  title: string; subtitle: string; rows: AgingRow[]; isOverdue: boolean;
}) {
  const [sortCol, setSortCol] = useState<string>('due_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(isOverdue ? 'desc' : 'asc');

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'desc' ? -1 : 1;
    const av = a[sortCol as keyof AgingRow];
    const bv = b[sortCol as keyof AgingRow];
    if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
    return dir * String(av).localeCompare(String(bv));
  });

  const totalBalance = rows.reduce((s, r) => s + Number(r.balance), 0);
  const accent = isOverdue ? 'text-red-600' : 'text-green-700';

  const SortTh = ({ col, label, right }: { col: string; label: string; right?: boolean }) => (
    <th
      onClick={() => handleSort(col)}
      className={`px-4 py-2.5 font-medium whitespace-nowrap cursor-pointer select-none ${right ? 'text-right' : 'text-left'} ${sortCol === col ? 'text-gray-900' : 'text-gray-500'}`}
    >
      {label} <span className="text-[10px] opacity-50">{sortCol === col ? (sortDir === 'desc' ? '↓' : '↑') : '⇅'}</span>
    </th>
  );

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className={`text-sm font-medium ${accent}`}>{title}</span>
          <span className="text-xs text-gray-400 ml-3">{subtitle}</span>
        </div>
        <span className="text-[11px] text-gray-400">Click column headers to sort</span>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-gray-50">
            <tr>
              <SortTh col="vendor_name" label="Vendor" />
              <th className="px-4 py-2.5 text-left font-medium text-gray-500">Site</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500">Category</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500">Invoice No</th>
              <SortTh col="invoice_date" label="Invoice Date" />
              <th className="px-4 py-2.5 text-center font-medium text-gray-500">Terms</th>
              <SortTh col="due_date" label="Due Date" />
              <SortTh col={isOverdue ? 'days_past_due' : 'days_left'} label={isOverdue ? 'Days Past Due' : 'Days Left'} right />
              <SortTh col="invoice_amount" label="Invoice Amt" right />
              <SortTh col="balance" label="Balance" right />
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.invoice_id} className="border-t border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 font-medium text-gray-900 max-w-[180px] truncate" title={r.vendor_name}>{r.vendor_name}</td>
                <td className="px-4 py-3 text-gray-500">{r.site}</td>
                <td className="px-4 py-3 text-gray-500">—</td>
                <td className="px-4 py-3">{r.invoice_no}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.invoice_date)}</td>
                <td className="px-4 py-3 text-center text-gray-500">{r.payment_terms}d</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.due_date)}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`text-xs font-medium ${isOverdue ? 'text-red-600' : 'text-green-600'}`}>
                    {isOverdue ? `${r.days_past_due} days` : `${r.days_left} days`}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">{formatINR(Number(r.invoice_amount))}</td>
                <td className="px-4 py-3 text-right font-medium">{formatINR(Number(r.balance))}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400 text-sm">No invoices in this category.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-gray-200 bg-gray-50">
              <tr>
                <td colSpan={9} className="px-4 py-2.5 font-medium text-gray-900">Total</td>
                <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{formatINR(totalBalance)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
