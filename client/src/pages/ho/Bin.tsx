import { useState, useEffect, useCallback } from 'react';
import { getBinInvoices, restoreInvoice, permanentDeleteInvoice, purgeBin } from '../../api/invoices';
import { Invoice } from '../../types/invoice';
import { formatINR, formatDate } from '../../utils/formatters';
import AppShell from '../../components/layout/AppShell';
import ExportButton from '../../components/shared/ExportButton';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { useStickyHeaderHeight } from '../../hooks/useStickyHeaderHeight';
import { useConfirm } from '../../components/ui/ConfirmDialog';

interface BinInvoice extends Invoice {
  deleted_by_name: string | null;
}

export default function Bin() {
  const [invoices, setInvoices] = useState<BinInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const { notify } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { user } = useAuth();
  const canPermanentDelete = user?.role === 'mgmt';
  const canRestore = user?.role === 'ho';
  const { ref: stickyHeaderRef, height: stickyHeaderHeight } = useStickyHeaderHeight();

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
    const ok = await confirm({
      title: `Permanently delete invoice #${inv.invoice_no}?`,
      message: 'This is irreversible — the invoice will be erased from the database, not just hidden.',
      confirmLabel: 'Permanently delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await permanentDeleteInvoice(inv.id);
      notify('Invoice permanently deleted');
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handlePurge() {
    const ok = await confirm({
      title: 'Purge old invoices?',
      message: 'Permanently delete every invoice in the Bin older than 30 days. This is irreversible.',
      confirmLabel: 'Purge old invoices',
      variant: 'danger',
    });
    if (!ok) return;
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
      {confirmDialog}
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-30 bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 -mt-4 sm:-mt-6 pt-4 sm:pt-6 pb-2 mb-4"
      >
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-lg font-medium text-gray-900">Bin</div>
            <div className="text-xs text-gray-500 mt-0.5">Deleted invoices are auto-purged after 30 days</div>
          </div>
          <div className="flex items-center gap-2">
            <ExportButton buildPath={(format) => `/export/bin?format=${format}`} filenameBase="bin" noun="invoice" />
            {invoices.length > 0 && canPermanentDelete && (
              <button onClick={handlePurge}
                className="px-3 py-2 border border-red-200 rounded-lg text-sm text-red-600 hover:bg-red-50">
                Purge Old (30+ days)
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 py-16 text-center">
          <div className="text-gray-300 text-4xl mb-3">&#128465;</div>
          <div className="text-gray-500 text-sm">Bin is empty</div>
        </div>
      ) : (
        <div
          className="bg-white rounded-xl border border-gray-100 overflow-auto"
          style={{ maxHeight: `calc(100vh - ${stickyHeaderHeight + 120}px)` }}
        >
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50">
              <tr>
                {['Invoice Date', 'Vendor', 'Inv. No', 'Site', 'Amount', 'Deleted By', 'Deleted On', 'Auto-purge', 'Actions'].map(h => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap bg-gray-50 sticky top-0 z-20 border-b border-gray-100 ${h === 'Amount' ? 'text-right' : 'text-left'}`}
                  >
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
                      {canRestore && (
                        <button onClick={() => handleRestore(inv)} className="text-xs text-blue-600 hover:underline">Restore</button>
                      )}
                      {canPermanentDelete && (
                        <button onClick={() => handlePermanentDelete(inv)} className="text-xs text-red-500 hover:underline">Delete Forever</button>
                      )}
                      {!canRestore && !canPermanentDelete && (
                        <span className="text-xs text-gray-400">View only</span>
                      )}
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
