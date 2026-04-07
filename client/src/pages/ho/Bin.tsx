import { useState, useEffect, useCallback } from 'react';
import { getBinInvoices, restoreInvoice, permanentDeleteInvoice, purgeBin } from '../../api/invoices';
import { Invoice } from '../../types/invoice';
import { formatINR, formatDate } from '../../utils/formatters';
import AppShell from '../../components/layout/AppShell';
import { useToast } from '../../context/ToastContext';

interface BinInvoice extends Invoice {
  deleted_by_name: string | null;
}

export default function Bin() {
  const [invoices, setInvoices] = useState<BinInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const { notify } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getBinInvoices();
      setInvoices(data);
    } catch { setInvoices([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRestore(inv: BinInvoice) {
    try {
      await restoreInvoice(inv.id);
      notify(`Restored invoice #${inv.invoice_no}`);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Restore failed');
    }
  }

  async function handlePermanentDelete(inv: BinInvoice) {
    if (!confirm(`Permanently delete invoice #${inv.invoice_no}? This cannot be undone.`)) return;
    try {
      await permanentDeleteInvoice(inv.id);
      notify('Invoice permanently deleted');
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handlePurge() {
    if (!confirm('Permanently delete all invoices in bin older than 30 days?')) return;
    try {
      const result = await purgeBin();
      notify(`Purged ${result.purged} old invoices`);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Purge failed');
    }
  }

  function daysLeft(deletedAt: string): number {
    const deleted = new Date(deletedAt);
    const purgeDate = new Date(deleted.getTime() + 30 * 24 * 60 * 60 * 1000);
    const now = new Date();
    return Math.max(0, Math.ceil((purgeDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Bin</div>
          <div className="text-xs text-gray-500 mt-0.5">Deleted invoices are auto-purged after 30 days</div>
        </div>
        {invoices.length > 0 && (
          <button onClick={handlePurge}
            className="px-3 py-2 border border-red-200 rounded-lg text-sm text-red-600 hover:bg-red-50">
            Purge Old (30+ days)
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 py-16 text-center">
          <div className="text-gray-300 text-4xl mb-3">&#128465;</div>
          <div className="text-gray-500 text-sm">Bin is empty</div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50">
              <tr>
                {['Date', 'Vendor', 'Inv. No', 'Site', 'Amount', 'Deleted By', 'Deleted On', 'Auto-purge', 'Actions'].map(h => (
                  <th key={h} className={`px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap ${h === 'Amount' ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 max-w-[180px] truncate" title={inv.vendor_name}>{inv.vendor_name}</td>
                  <td className="px-4 py-3">{inv.invoice_no}</td>
                  <td className="px-4 py-3">{inv.site}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatINR(Number(inv.invoice_amount))}</td>
                  <td className="px-4 py-3 text-gray-500">{inv.deleted_by_name ?? '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                    {inv.deleted_at ? new Date(inv.deleted_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {inv.deleted_at && (
                      <span className={`text-xs font-medium ${daysLeft(inv.deleted_at) <= 7 ? 'text-red-600' : 'text-gray-500'}`}>
                        {daysLeft(inv.deleted_at)}d left
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleRestore(inv)} className="text-xs text-blue-600 hover:underline">Restore</button>
                      <button onClick={() => handlePermanentDelete(inv)} className="text-xs text-red-500 hover:underline">Delete Forever</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
