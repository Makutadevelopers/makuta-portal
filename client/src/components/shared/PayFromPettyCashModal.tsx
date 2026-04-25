import { useEffect, useState, FormEvent } from 'react';
import { Invoice } from '../../types/invoice';
import { createExpense, getSiteBalance } from '../../api/pettyCash';
import { formatINR } from '../../utils/formatters';

const MINOR_LIMIT = 50000;

interface Props {
  invoice: Invoice;
  onClose: () => void;
  onDone: () => void;
}

export default function PayFromPettyCashModal({ invoice, onClose, onDone }: Props) {
  const today = new Date().toISOString().split('T')[0];
  const remaining = Number(invoice.effective_payable ?? invoice.invoice_amount);

  const [amount, setAmount] = useState(String(Math.min(remaining, MINOR_LIMIT)));
  const [spentOn, setSpentOn] = useState(today);
  const [remarks, setRemarks] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSiteBalance(invoice.site)
      .then(b => setBalance(Number(b.balance)))
      .catch(() => setBalance(0));
  }, [invoice.site]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const amt = Number(amount);
    if (!(amt > 0)) { setError('Amount must be greater than zero'); return; }
    if (amt > MINOR_LIMIT) {
      setError(`Site accountants can only pay up to ${formatINR(MINOR_LIMIT)} per invoice`);
      return;
    }
    if (balance !== null && amt > balance) {
      setError(`Amount exceeds available petty cash balance (${formatINR(balance)})`);
      return;
    }

    setPaying(true);
    try {
      await createExpense({
        site: invoice.site,
        amount: amt,
        spent_on: spentOn,
        purpose: `Payment: ${invoice.vendor_name} · ${invoice.invoice_no}`,
        invoice_id: invoice.id,
        remarks: remarks.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pay from petty cash');
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md p-6 shadow-lg space-y-3">
        <div className="text-base font-medium text-gray-900 mb-1">Pay Invoice from Petty Cash</div>

        <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 leading-relaxed">
          <div><span className="text-gray-500">Vendor:</span> <span className="font-medium text-gray-900">{invoice.vendor_name}</span></div>
          <div><span className="text-gray-500">Invoice:</span> #{invoice.invoice_no} · {formatINR(Number(invoice.invoice_amount))}</div>
          {Number(invoice.allocated_credits ?? 0) > 0 && (
            <div><span className="text-gray-500">After credit notes:</span> {formatINR(remaining)}</div>
          )}
        </div>

        <div className="text-xs text-gray-500">
          Balance available: <span className="font-medium text-gray-700">{balance === null ? '…' : formatINR(balance)}</span>
          {' · '}
          Site limit per payment: <span className="font-medium text-gray-700">{formatINR(MINOR_LIMIT)}</span>
        </div>

        {error && <div className="p-2 bg-red-50 text-red-700 rounded text-xs">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Amount (₹)</label>
            <input type="number" min="1" step="1" value={amount}
              onChange={e => setAmount(e.target.value)} required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date</label>
            <input type="date" value={spentOn}
              onChange={e => setSpentOn(e.target.value)} required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Remarks (optional)</label>
          <input value={remarks} onChange={e => setRemarks(e.target.value)}
            placeholder="e.g. Paid in cash to delivery boy"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="px-3 py-2 text-sm text-gray-600">Cancel</button>
          <button type="submit" disabled={paying || balance === null}
            className="px-4 py-2 bg-[#1a3c5e] text-white text-sm rounded-lg hover:bg-[#15304d] disabled:opacity-50">
            {paying ? 'Paying…' : 'Pay from Petty Cash'}
          </button>
        </div>
      </form>
    </div>
  );
}
