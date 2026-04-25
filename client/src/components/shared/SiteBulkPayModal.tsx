import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Invoice } from '../../types/invoice';
import { createExpense, getSiteBalance } from '../../api/pettyCash';
import { formatINR } from '../../utils/formatters';

const MINOR_LIMIT = 50000;

interface Props {
  invoices: Invoice[];
  site: string;
  onClose: () => void;
  onDone: (paidCount: number, failedCount: number) => void;
}

export default function SiteBulkPayModal({ invoices, site, onClose, onDone }: Props) {
  const today = new Date().toISOString().split('T')[0];

  const initialAllocs = useMemo(() => {
    const m: Record<string, string> = {};
    for (const inv of invoices) {
      const remaining = Number(inv.effective_payable ?? inv.invoice_amount);
      m[inv.id] = String(Math.min(remaining, MINOR_LIMIT));
    }
    return m;
  }, [invoices]);

  const [allocs, setAllocs] = useState<Record<string, string>>(initialAllocs);
  const [spentOn, setSpentOn] = useState(today);
  const [remarks, setRemarks] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [perRowError, setPerRowError] = useState<Record<string, string>>({});

  useEffect(() => {
    getSiteBalance(site)
      .then(b => setBalance(Number(b.balance)))
      .catch(() => setBalance(0));
  }, [site]);

  const total = Object.values(allocs).reduce((s, v) => s + (Number(v) || 0), 0);
  const overLimitIds = invoices.filter(inv => Number(allocs[inv.id] || 0) > MINOR_LIMIT).map(i => i.id);
  const overBalance = balance !== null && total > balance;
  const blocked = overLimitIds.length > 0 || overBalance || total <= 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setPerRowError({});
    if (blocked) {
      if (overLimitIds.length > 0) setError(`${overLimitIds.length} invoice(s) above the ₹${MINOR_LIMIT.toLocaleString('en-IN')} site limit`);
      else if (overBalance) setError(`Total exceeds available petty cash balance (${formatINR(balance ?? 0)})`);
      else setError('Enter a non-zero amount for at least one invoice');
      return;
    }

    setPaying(true);
    const errors: Record<string, string> = {};
    let paid = 0;
    for (const inv of invoices) {
      const amt = Number(allocs[inv.id] || 0);
      if (!(amt > 0)) continue;
      try {
        await createExpense({
          site,
          amount: amt,
          spent_on: spentOn,
          purpose: `Payment: ${inv.vendor_name} · ${inv.invoice_no}`,
          invoice_id: inv.id,
          remarks: remarks.trim() || null,
        });
        paid++;
      } catch (err) {
        errors[inv.id] = err instanceof Error ? err.message : 'Failed';
      }
    }
    setPerRowError(errors);
    setPaying(false);

    const failed = Object.keys(errors).length;
    if (failed === 0) {
      onDone(paid, 0);
    } else if (paid === 0) {
      setError(`All ${failed} payment(s) failed — see per-row errors below`);
    } else {
      onDone(paid, failed);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-base font-medium text-gray-900">Bulk Pay from Petty Cash</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {invoices.length} invoice{invoices.length > 1 ? 's' : ''} · Each ≤ {formatINR(MINOR_LIMIT)}
              {' · '}Balance: <span className="font-medium text-gray-700">{balance === null ? '…' : formatINR(balance)}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {error && <div className="p-2 bg-red-50 text-red-700 rounded text-xs">{error}</div>}

          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Vendor</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Invoice</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Amount</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 w-36">Pay (₹)</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const remaining = Number(inv.effective_payable ?? inv.invoice_amount);
                  const cur = Number(allocs[inv.id] || 0);
                  const overLimit = cur > MINOR_LIMIT;
                  const rowErr = perRowError[inv.id];
                  return (
                    <tr key={inv.id} className={`border-t border-gray-50 ${rowErr ? 'bg-red-50/40' : ''}`}>
                      <td className="px-3 py-2 font-medium text-gray-900 max-w-[180px] truncate" title={inv.vendor_name}>{inv.vendor_name}</td>
                      <td className="px-3 py-2 text-gray-500">#{inv.invoice_no}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatINR(remaining)}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number" min="0" step="1"
                          value={allocs[inv.id] ?? ''}
                          onChange={e => setAllocs(prev => ({ ...prev, [inv.id]: e.target.value }))}
                          className={`w-full px-2 py-1.5 border rounded text-sm text-right ${overLimit ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                        />
                        {overLimit && <div className="text-[10px] text-red-600 mt-0.5">Above ₹{MINOR_LIMIT.toLocaleString('en-IN')}</div>}
                        {rowErr && <div className="text-[10px] text-red-600 mt-0.5">{rowErr}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-100">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right font-medium text-gray-700">Total</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatINR(total)}</td>
                </tr>
                {overBalance && (
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-xs text-red-600">
                      Exceeds petty cash balance by {formatINR(total - (balance ?? 0))}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date</label>
              <input type="date" value={spentOn} onChange={e => setSpentOn(e.target.value)} required
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Remarks (optional)</label>
              <input value={remarks} onChange={e => setRemarks(e.target.value)}
                placeholder="Applied to all selected invoices"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-600">Cancel</button>
          <button type="submit" disabled={paying || balance === null || blocked}
            className="px-4 py-2 bg-[#1a3c5e] text-white text-sm rounded-lg hover:bg-[#15304d] disabled:opacity-50">
            {paying ? 'Paying…' : `Pay ${formatINR(total)}`}
          </button>
        </div>
      </form>
    </div>
  );
}
