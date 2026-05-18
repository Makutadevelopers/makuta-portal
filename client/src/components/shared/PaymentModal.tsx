import { useState, useEffect } from 'react';
import { createPayment, getPayments } from '../../api/payments';
import { getInvoiceCreditSuggestions, addAllocation } from '../../api/creditNotes';
import { InvoiceCreditSuggestions } from '../../types/creditNote';
import { Payment } from '../../types/payment';
import { formatINR, formatDate } from '../../utils/formatters';
import { PAYMENT_TYPES } from '../../utils/constants';
import BankSelect from './BankSelect';

export interface PaymentModalInvoice {
  id: string;
  vendor_name: string;
  invoice_no: string | null;
  invoice_amount: number | string;
}

interface Props {
  invoice: PaymentModalInvoice;
  balance: number;
  onClose: () => void;
  onSaved: () => void;
}

export default function PaymentModal({ invoice, balance, onClose, onSaved }: Props) {
  const invoiceAmount = Number(invoice.invoice_amount);
  const [mode, setMode] = useState<'full' | 'part'>('full');
  const [tdsPct, setTdsPct] = useState('0');
  const numTdsPct = Math.max(0, Math.min(10, Number(tdsPct) || 0));
  const tdsAmount = Math.round(invoiceAmount * numTdsPct) / 100;
  const [amount, setAmount] = useState(String(Math.max(0, balance - tdsAmount)));
  const [paymentType, setPaymentType] = useState('Cheque');
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [bank, setBank] = useState('HDFC');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [prevPayments, setPrevPayments] = useState<Payment[]>([]);
  const [creditSuggestions, setCreditSuggestions] = useState<InvoiceCreditSuggestions | null>(null);
  const [applyingCredit, setApplyingCredit] = useState(false);

  useEffect(() => {
    if (mode === 'full') setAmount(String(Math.max(0, balance - tdsAmount)));
  }, [mode, balance, tdsAmount]);

  useEffect(() => {
    getPayments(invoice.id).then(setPrevPayments).catch(() => {});
    getInvoiceCreditSuggestions(invoice.id).then(setCreditSuggestions).catch(() => {});
  }, [invoice.id]);

  async function handleApplyCredit(cnId: string, availableAmount: number) {
    const applyAmount = Math.min(availableAmount, balance);
    if (applyAmount <= 0) return;
    setApplyingCredit(true);
    try {
      await addAllocation(cnId, { invoice_id: invoice.id, allocated_amount: applyAmount });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply credit');
    } finally {
      setApplyingCredit(false);
    }
  }

  const numAmount = Number(amount) || 0;
  const settlement = numAmount + tdsAmount;
  const balanceAfter = balance - settlement;
  const isOverpay = settlement > balance + 0.001;

  function handleModeChange(m: 'full' | 'part') {
    setMode(m);
    if (m === 'full') setAmount(String(Math.max(0, balance - tdsAmount)));
    else setAmount('');
  }

  async function handleSubmit() {
    if (settlement <= 0) { setError('Enter a valid amount or TDS %'); return; }
    if (isOverpay) { setError('Cash + TDS exceeds outstanding balance'); return; }
    if (numAmount > 0 && paymentType !== 'Cash' && !paymentRef.trim()) { setError('Reference / TXN number is required'); return; }

    setSaving(true);
    setError('');
    try {
      await createPayment(invoice.id, {
        amount: numAmount,
        payment_type: paymentType,
        payment_ref: paymentType === 'Cash' ? null : paymentRef.trim(),
        payment_date: paymentDate,
        bank: paymentType === 'Cash' ? null : (bank.trim() || null),
        tds_pct: numTdsPct,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-lg mx-4 p-4 sm:p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-base font-medium text-gray-900">Record Payment</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {invoice.vendor_name} · #{invoice.invoice_no} · Balance {formatINR(balance)}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&#10005;</button>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

        {creditSuggestions && creditSuggestions.unallocated_balance > 0 && (
          <div className="mb-4 p-3 bg-purple-50 border border-purple-100 rounded-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="text-xs font-medium text-purple-800">
                  {invoice.vendor_name} has {formatINR(creditSuggestions.unallocated_balance)} unallocated credit
                </div>
                <div className="text-[11px] text-purple-600 mt-0.5">
                  Apply some of it to reduce this invoice's payable before paying cash.
                </div>
                <div className="mt-2 space-y-1">
                  {creditSuggestions.available_credits.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-xs bg-white rounded px-2 py-1 border border-purple-100">
                      <span className="text-gray-700">
                        CN #{c.cn_no} · {formatDate(c.cn_date)} · available {formatINR(c.unallocated_balance)}
                      </span>
                      <button
                        onClick={() => handleApplyCredit(c.id, c.unallocated_balance)}
                        disabled={applyingCredit}
                        className="text-purple-700 hover:underline disabled:opacity-50"
                      >
                        Apply {formatINR(Math.min(c.unallocated_balance, balance))}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {prevPayments.length > 0 && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="text-xs font-medium text-gray-500 mb-2">Previous payments ({prevPayments.length})</div>
            {prevPayments.map(p => (
              <div key={p.id} className="flex justify-between text-xs text-gray-600 py-1">
                <span>{formatDate(p.payment_date)} · {p.payment_type} · {p.payment_ref || '—'}</span>
                <span className="font-medium text-green-700">{formatINR(Number(p.amount))}</span>
              </div>
            ))}
            <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between text-xs font-medium">
              <span>Total paid so far</span>
              <span>{formatINR(invoiceAmount - balance)}</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => handleModeChange('full')}
            className={`px-4 py-2 text-sm rounded-lg font-medium ${mode === 'full' ? 'bg-[#1a3c5e] text-white' : 'bg-gray-100 text-gray-600'}`}>
            Full Payment
          </button>
          <button onClick={() => handleModeChange('part')}
            className={`px-4 py-2 text-sm rounded-lg font-medium ${mode === 'part' ? 'bg-[#1a3c5e] text-white' : 'bg-gray-100 text-gray-600'}`}>
            Part Payment
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Cash Paid (₹)</label>
            {mode === 'full' ? (
              <div className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 font-medium">{formatINR(Math.max(0, balance - tdsAmount))}</div>
            ) : (
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} min="0" max={balance}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1" title="TDS withheld at source. Computed on the full invoice amount.">TDS %</label>
            <input
              type="number"
              value={tdsPct}
              onChange={e => setTdsPct(e.target.value)}
              min="0"
              max="10"
              step="0.01"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
        </div>
        {(numTdsPct > 0 || numAmount > 0) && (
          <div className="mb-4 -mt-2 p-3 bg-gray-50 border border-gray-100 rounded-lg text-xs text-gray-600 space-y-1">
            <div className="flex justify-between"><span>Cash to vendor</span><span className="font-medium">{formatINR(numAmount)}</span></div>
            {numTdsPct > 0 && (
              <div className="flex justify-between">
                <span>TDS withheld ({numTdsPct}% of {formatINR(invoiceAmount)})</span>
                <span className="font-medium text-amber-700">{formatINR(tdsAmount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-200 pt-1 mt-1">
              <span>Settles</span>
              <span className="font-medium">{formatINR(settlement)}</span>
            </div>
            <div className="flex justify-between">
              <span>Balance after</span>
              <span className={`font-medium ${balanceAfter <= 0 ? 'text-green-700' : 'text-gray-700'}`}>{formatINR(Math.max(0, balanceAfter))}</span>
            </div>
          </div>
        )}
        {isOverpay && <div className="text-xs text-red-600 -mt-2 mb-3">Cash + TDS exceeds outstanding balance of {formatINR(balance)}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Payment Type</label>
            <select value={paymentType} onChange={e => setPaymentType(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white">
              {PAYMENT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          {paymentType !== 'Cash' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Reference / TXN No *</label>
              <input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="Cheque / TXN number"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Payment Date</label>
            <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          {paymentType !== 'Cash' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Bank</label>
              <BankSelect
                value={bank}
                onChange={setBank}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={handleSubmit} disabled={saving || isOverpay || numAmount <= 0}
            className="px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">
            {saving ? 'Recording...' : `Record ${mode === 'full' ? 'Full' : 'Part'} Payment`}
          </button>
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
        </div>
      </div>
    </div>
  );
}
