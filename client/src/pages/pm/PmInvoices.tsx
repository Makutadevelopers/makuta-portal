import { useState, useEffect, useMemo, useCallback } from 'react';
import AppShell from '../../components/layout/AppShell';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { getInvoices } from '../../api/invoices';
import { downloadAuthenticated } from '../../api/client';
import { Invoice } from '../../types/invoice';
import { formatINR, formatDate } from '../../utils/formatters';
import PmInvoiceDrawer from './PmInvoiceDrawer';

// Read-only expenditure list for project managers. The server already scopes
// GET /invoices to the PM's assigned sites AND returns the full projection
// (amounts, balance, aging) — so this page just renders what it receives. No
// create/edit/delete/pay controls: PMs view expenditure, they never enter it.

const STATUS_OPTIONS = ['All', 'Paid', 'Partial', 'Not Paid'];

function statusBadge(status?: string) {
  const s = status ?? 'Not Paid';
  const cls = s === 'Paid'
    ? 'bg-green-100 text-green-800'
    : s === 'Partial'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-gray-100 text-gray-700';
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{s}</span>;
}

export default function PmInvoices() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const userSites = useMemo(
    () => (user?.sites && user.sites.length > 0 ? user.sites : (user?.site ? [user.site] : [])),
    [user],
  );

  const [site, setSite] = useState('All');
  const [status, setStatus] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Invoice | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInvoices(await getInvoices());
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load invoices', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter(inv => {
      if (site !== 'All' && inv.site !== site) return false;
      if (status !== 'All' && (inv.payment_status ?? 'Not Paid') !== status) return false;
      if (q) {
        const hay = `${inv.vendor_name} ${inv.invoice_no ?? ''} ${inv.po_number ?? ''} ${inv.purpose}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, site, status, search]);

  const totals = useMemo(() => {
    let amount = 0;
    let balance = 0;
    for (const inv of filtered) {
      amount += Number(inv.invoice_amount) || 0;
      balance += Number(inv.balance ?? 0) || 0;
    }
    return { amount, balance, count: filtered.length };
  }, [filtered]);

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format: 'csv' });
      if (site !== 'All') params.set('site', site);
      if (status !== 'All') params.set('status', status);
      if (search.trim()) params.set('search', search.trim());
      await downloadAuthenticated(`/export/invoices?${params.toString()}`, 'invoices.csv');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell>
      <div className="max-w-[1200px]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-lg font-medium text-gray-900">Invoices</div>
            <div className="text-xs text-gray-500 mt-1">
              Read-only expenditure for {userSites.length === 1 ? userSites[0] : `${userSites.length} assigned sites`}
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting || filtered.length === 0}
            className="px-4 py-2 bg-[#1a3c5e] text-white text-sm rounded-lg hover:bg-[#15324e] disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <select value={site} onChange={e => setSite(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="All">All my sites</option>
            {userSites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s === 'All' ? 'All statuses' : s}</option>)}
          </select>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search vendor, invoice no, PO…"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm flex-1 min-w-[180px]"
          />
        </div>

        {/* Summary */}
        <div className="flex flex-wrap gap-4 mb-3 text-sm">
          <div className="text-gray-500">{totals.count} invoice{totals.count === 1 ? '' : 's'}</div>
          <div className="text-gray-700">Total: <span className="font-medium">{formatINR(totals.amount)}</span></div>
          <div className="text-gray-700">Outstanding: <span className="font-medium">{formatINR(totals.balance)}</span></div>
        </div>

        {/* Table */}
        <div className="bg-white border border-gray-100 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Vendor</th>
                <th className="px-3 py-2 font-medium">Invoice No</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Site</th>
                <th className="px-3 py-2 font-medium text-right">Amount</th>
                <th className="px-3 py-2 font-medium text-right">Balance</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">No invoices match these filters.</td></tr>
              ) : (
                filtered.map(inv => (
                  <tr key={inv.id} onClick={() => setSelected(inv)}
                    className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                    <td className="px-3 py-2">{inv.vendor_name}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{inv.invoice_no || '—'}</td>
                    <td className="px-3 py-2">{inv.purpose}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{inv.site}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatINR(Number(inv.invoice_amount))}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatINR(Number(inv.balance ?? 0))}</td>
                    <td className="px-3 py-2">{statusBadge(inv.payment_status)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PmInvoiceDrawer invoice={selected} onClose={() => setSelected(null)} />
    </AppShell>
  );
}
