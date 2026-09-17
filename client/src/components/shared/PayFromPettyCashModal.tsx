import { useEffect, useState, FormEvent } from 'react';
import { Invoice } from '../../types/invoice';
import { createExpense, getSiteBalance } from '../../api/pettyCash';
import { PettyCashBalance } from '../../types/pettyCash';
import { formatINR } from '../../utils/formatters';
import { useAuth } from '../../hooks/useAuth';

const DEFAULT_MINOR_LIMIT = 50000;

interface Props {
  invoice: Invoice;
  onClose: () => void;
  onDone: () => void;
}

export default function PayFromPettyCashModal({ invoice, onClose, onDone }: Props) {
  const { user } = useAuth();
  // The per-payment cap only binds site accountants (backend mirrors this
  // exactly — see petty-cash.controller.ts). HO has no cap here, same as it
  // has none for a regular bank/cheque payment.
  const capped = user?.role === 'site';
  const today = new Date().toISOString().split('T')[0];
  const remaining = Number(invoice.effective_payable ?? invoice.invoice_amount);
  const missingPoNumber = !invoice.po_number || !invoice.po_number.trim();

  const [amount, setAmount] = useState(String(capped ? Math.min(remaining, DEFAULT_MINOR_LIMIT) : remaining));
  const [spentOn, setSpentOn] = useState(today);
  const [remarks, setRemarks] = useState('');
  const [balanceInfo, setBalanceInfo] = useState<PettyCashBalance | null>(null);
  const [balanceError, setBalanceError] = useState('');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');

  const balance = balanceInfo ? Number(balanceInfo.balance) : null;
  const minorLimit = balanceInfo ? Number(balanceInfo.payment_limit) : DEFAULT_MINOR_LIMIT;

  useEffect(() => {
    setBalanceInfo(null);
    setBalanceError('');
    getSiteBalance(invoice.site)
      .then(setBalanceInfo)
      .catch(err => setBalanceError(err instanceof Error ? err.message : 'Failed to load petty cash balance'));
  }, [invoice.site]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const amt = Number(amount);
    if (!(amt > 0)) { setError('Amount must be greater than zero'); return; }
    if (capped && amt > minorLimit) {
      setError(`Site accountants can only pay up to ${formatINR(minorLimit)} per invoice`);
      return;
    }
    if (balance !== null && amt > balance) {
      setError(`Amount exceeds available petty cash balance (${formatINR(balance)})`);
      return;
    }
    if (missingPoNumber) {
      setError('This invoice has no PO / Work Order number. Add one before paying it from petty cash.');
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
          Balance available: <span className="font-medium text-gray-700">
            {balanceError ? 'unavailable' : balance === null ? '…' : formatINR(balance)}
          </span>
          {capped && (
            <>
              {' · '}
              Site limit per payment: <span className="font-medium text-gray-700">{formatINR(minorLimit)}</span>
            </>
          )}
        </div>

        {balanceError && (
          <div className="p-2 bg-red-50 text-red-700 rounded text-xs">
            Couldn't load petty cash balance: {balanceError}
          </div>
        )}
        {missingPoNumber && (
          <div className="p-2 bg-red-50 text-red-700 rounded text-xs">
            This invoice has no PO / Work Order number. Add one before paying it from petty cash.
          </div>
        )}
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
          <button type="submit" disabled={paying || balance === null || missingPoNumber}
            className="px-4 py-2 bg-[#1a3c5e] text-white text-sm rounded-lg hover:bg-[#15304d] disabled:opacity-50">
            {paying ? 'Paying…' : 'Pay from Petty Cash'}
          </button>
        </div>
      </form>
    </div>
  );
}
