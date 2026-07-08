import { useState } from 'react';
import { useAgingCalc } from '../../hooks/useAgingCalc';
import { downloadAuthenticated } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { formatINR, formatDate } from '../../utils/formatters';
import { SITES } from '../../utils/constants';
import AppShell from '../../components/layout/AppShell';
import { useAuth } from '../../hooks/useAuth';
import { useStickyHeaderHeight } from '../../hooks/useStickyHeaderHeight';
import { useIsMobile } from '../../hooks/useIsMobile';
import { MobileCard, CardField } from '../../components/ui/MobileCard';

export default function PaymentAging() {
  const { user } = useAuth();
  // Project managers only ever see their assigned sites in the picker; every
  // other role sees the full list. The server enforces the same scope anyway.
  const visibleSites = user?.role === 'project_manager' && user.sites?.length ? user.sites : SITES;
  const [site, setSite] = useState('All');
  const [vendorFilter, setVendorFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'within' | 'overdue'>('within');
  const [exporting, setExporting] = useState(false);
  const { notify } = useToast();
  const { withinTerms, overdue, loading } = useAgingCalc(site);
  const { ref: stickyHeaderRef, height: stickyHeaderHeight } = useStickyHeaderHeight();

  // Vendor filter (client-side): case-insensitive substring so it works both
  // as a free-text search and an exact pick from the datalist below.
  const vq = vendorFilter.trim().toLowerCase();
  const matchesVendor = (r: AgingRow) => !vq || r.vendor_name.toLowerCase().includes(vq);
  const filteredWithin = withinTerms.filter(matchesVendor);
  const filteredOverdue = overdue.filter(matchesVendor);

  // Unique vendor names present in the aging data, for the search datalist.
  const vendorOptions = [...new Set([...withinTerms, ...overdue].map(r => r.vendor_name))].sort((a, b) => a.localeCompare(b));

  const totalOutstanding = [...filteredWithin, ...filteredOverdue].reduce((s, r) => s + Number(r.balance), 0);
  const withinTotal = filteredWithin.reduce((s, r) => s + Number(r.balance), 0);
  const overdueTotal = filteredOverdue.reduce((s, r) => s + Number(r.balance), 0);

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ site });
      await downloadAuthenticated(`/export/aging?${params.toString()}`, `payment-aging-${site}.pdf`, true);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell>
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-30 bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 -mt-4 sm:-mt-6 pt-4 sm:pt-6 pb-2 mb-4"
      >
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="text-lg font-medium text-gray-900">Payment Aging</div>
            <div className="text-xs text-gray-500 mt-1">Due dates are calculated from each vendor's individual payment terms</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                value={vendorFilter}
                onChange={e => setVendorFilter(e.target.value)}
                list="aging-vendor-list"
                placeholder="Search / select vendor…"
                className="w-56 pl-3 pr-7 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <datalist id="aging-vendor-list">
                {vendorOptions.map(v => <option key={v} value={v} />)}
              </datalist>
              {vendorFilter && (
                <button
                  type="button"
                  onClick={() => setVendorFilter('')}
                  title="Clear vendor filter"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm px-1"
                >
                  ✕
                </button>
              )}
            </div>
            <select value={site} onChange={e => setSite(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
              <option value="All">All Sites</option>
              {visibleSites.map(s => <option key={s}>{s}</option>)}
            </select>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {exporting ? 'Preparing PDF…' : 'Export PDF'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : (
        <>
          {/* Summary cards — reflect the active vendor filter */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Total Outstanding</div>
              <div className="text-2xl font-semibold text-gray-900">{formatINR(totalOutstanding)}</div>
              <div className="text-xs text-gray-400 mt-1">{filteredWithin.length + filteredOverdue.length} invoices pending{vq ? ' · filtered' : ''}</div>
            </div>
            <div className="bg-green-50 rounded-xl border border-green-100 p-5">
              <div className="text-xs font-medium text-green-700 uppercase tracking-wider mb-2">Within Terms</div>
              <div className="text-2xl font-semibold text-green-700">{formatINR(withinTotal)}</div>
              <div className="text-xs text-green-600 mt-1">{filteredWithin.length} — payment not yet due</div>
            </div>
            <div className="bg-red-50 rounded-xl border border-red-100 p-5">
              <div className="text-xs font-medium text-red-700 uppercase tracking-wider mb-2">Overdue</div>
              <div className="text-2xl font-semibold text-red-600">{formatINR(overdueTotal)}</div>
              <div className="text-xs text-red-500 mt-1">{filteredOverdue.length} — past vendor due date</div>
            </div>
          </div>

          {/* Tabs to switch between the two aging tables */}
          <div className="flex items-center gap-1 mb-4">
            <button
              onClick={() => setActiveTab('within')}
              className={`px-4 py-2 text-sm font-medium rounded-lg ${activeTab === 'within' ? 'bg-[#1a3c5e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              Within Terms ({filteredWithin.length})
            </button>
            <button
              onClick={() => setActiveTab('overdue')}
              className={`px-4 py-2 text-sm font-medium rounded-lg ${activeTab === 'overdue' ? 'bg-[#1a3c5e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              Overdue ({filteredOverdue.length})
            </button>
          </div>

          {activeTab === 'within' ? (
            <AgingTable
              title="Within Terms — payment not yet due"
              subtitle={`${filteredWithin.length} invoices · ${formatINR(withinTotal)}${vq ? ` · ${vendorFilter.trim()}` : ''}`}
              rows={filteredWithin}
              isOverdue={false}
              stickyTop={stickyHeaderHeight}
            />
          ) : (
            <AgingTable
              title="Overdue — past vendor due date"
              subtitle={`${filteredOverdue.length} invoices · ${formatINR(overdueTotal)}${vq ? ` · ${vendorFilter.trim()}` : ''}`}
              rows={filteredOverdue}
              isOverdue={true}
              stickyTop={stickyHeaderHeight}
            />
          )}
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

function AgingTable({ title, subtitle, rows, isOverdue, stickyTop }: {
  // stickyTop = height of the page-level toolbar; used to size the table's
  // own scroll area so its inner sticky <th> pins below the toolbar without
  // overlapping it. The <th> itself uses top:0 inside the scroll context.
  title: string; subtitle: string; rows: AgingRow[]; isOverdue: boolean; stickyTop: number;
}) {
  const isMobile = useIsMobile();
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
      className={`px-4 py-2.5 font-medium whitespace-nowrap cursor-pointer select-none bg-gray-50 sticky top-0 z-20 border-b border-gray-100 ${right ? 'text-right' : 'text-left'} ${sortCol === col ? 'text-gray-900' : 'text-gray-500'}`}
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
        {!isMobile && <span className="text-[11px] text-gray-400">Click column headers to sort</span>}
      </div>
      {isMobile ? (
        <div className="space-y-2">
          {sorted.map(r => (
            <MobileCard
              key={r.invoice_id}
              header={
                <>
                  <span className="font-medium text-gray-900 truncate" title={r.vendor_name}>{r.vendor_name}</span>
                  <span className="text-red-600 font-medium whitespace-nowrap">{formatINR(Number(r.balance))}</span>
                </>
              }
            >
              <CardField label="Invoice No" value={r.invoice_no} />
              <CardField label="Invoice Date" value={formatDate(r.invoice_date)} />
              <CardField label="Due Date" value={formatDate(r.due_date)} />
              <CardField
                label={isOverdue ? 'Days Past Due' : 'Days Left'}
                value={isOverdue ? `${r.days_past_due} days` : `${r.days_left} days`}
                valueClass={`font-medium ${isOverdue ? 'text-red-600' : 'text-green-600'}`}
              />
              <CardField label="Site" value={r.site} />
              <CardField label="Category" value="—" />
              <CardField label="Invoice Amt" value={formatINR(Number(r.invoice_amount))} />
            </MobileCard>
          ))}
          {rows.length === 0 && (
            <div className="px-4 py-10 text-center text-gray-400 text-sm">No invoices in this category.</div>
          )}
        </div>
      ) : (
      <div
        className="bg-white rounded-xl border border-gray-100 overflow-y-auto overflow-x-hidden"
        style={{ maxHeight: `calc(100vh - ${stickyTop + 200}px)` }}
      >
        <table className="w-full table-fixed text-[13px]">
          {/* Fixed proportional widths (sum 100%) so the table never exceeds
              the container width — no horizontal scroll. Text columns truncate. */}
          <colgroup>
            <col style={{ width: '20%' }} />{/* Vendor */}
            <col style={{ width: '11%' }} />{/* Site */}
            <col style={{ width: '11%' }} />{/* Category */}
            <col style={{ width: '11%' }} />{/* Invoice No */}
            <col style={{ width: '9%' }} />{/* Invoice Date */}
            <col style={{ width: '6%' }} />{/* Terms */}
            <col style={{ width: '9%' }} />{/* Due Date */}
            <col style={{ width: '7%' }} />{/* Days */}
            <col style={{ width: '8%' }} />{/* Invoice Amt */}
            <col style={{ width: '8%' }} />{/* Balance */}
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <SortTh col="vendor_name" label="Vendor" />
              <th className="px-4 py-2.5 text-left font-medium text-gray-500 bg-gray-50 sticky top-0 z-20 border-b border-gray-100">Site</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500 bg-gray-50 sticky top-0 z-20 border-b border-gray-100">Category</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500 bg-gray-50 sticky top-0 z-20 border-b border-gray-100">Invoice No</th>
              <SortTh col="invoice_date" label="Invoice Date" />
              <th className="px-4 py-2.5 text-center font-medium text-gray-500 bg-gray-50 sticky top-0 z-20 border-b border-gray-100">Terms</th>
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
                <td className="px-4 py-3 text-gray-500 truncate">{r.site}</td>
                <td className="px-4 py-3 text-gray-500 truncate">—</td>
                <td className="px-4 py-3 truncate">{r.invoice_no}</td>
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
      )}
    </div>
  );
}
