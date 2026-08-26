import { useState, FormEvent } from 'react';
import { updateDisbursement, updateExpense } from '../../api/pettyCash';
import { PettyCashDisbursement, PettyCashExpense } from '../../types/pettyCash';
import { useToast } from '../../context/ToastContext';

export type PettyCashEditTarget =
  | { kind: 'disbursement'; row: PettyCashDisbursement }
  | { kind: 'expense'; row: PettyCashExpense };

export default function PettyCashEditModal({ target, onClose, onSaved }: {
  target: PettyCashEditTarget | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [saving, setSaving] = useState(false);

  // Local form state, reset whenever a new target is opened via `key` on the form below.
  const [amount, setAmount] = useState(target ? target.row.amount : '');
  const [date, setDate] = useState(target ? (target.kind === 'disbursement' ? target.row.given_on : target.row.spent_on) : '');
  const [mode, setMode] = useState<'cash' | 'bank'>(target?.kind === 'disbursement' ? target.row.mode : 'cash');
  const [reference, setReference] = useState(target?.kind === 'disbursement' ? (target.row.reference ?? '') : '');
  const [purpose, setPurpose] = useState(target?.kind === 'expense' ? target.row.purpose : '');
  const [remarks, setRemarks] = useState(target ? (target.row.remarks ?? '') : '');

  if (!target) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    const amt = Number(amount);
    if (!(amt > 0)) { notify('Amount must be greater than zero', 'error'); return; }
    if (!date) { notify('Date is required', 'error'); return; }
    setSaving(true);
    try {
      if (target.kind === 'disbursement') {
        await updateDisbursement(target.row.id, {
          amount: amt,
          given_on: date,
          mode,
          reference: reference.trim() || null,
          remarks: remarks.trim() || null,
        });
      } else {
        if (!purpose.trim()) { notify('Purpose is required', 'error'); setSaving(false); return; }
        await updateExpense(target.row.id, {
          amount: amt,
          spent_on: date,
          purpose: purpose.trim(),
          remarks: remarks.trim() || null,
        });
      }
      notify('Entry updated');
      onSaved();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update entry', 'error');
    } finally {
      setSaving(false);
    }
  }

  const linkedInvoice = target.kind === 'expense' ? target.row.invoice_no : null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4"
      onClick={e => { e.stopPropagation(); if (!saving) onClose(); }}>
      <form key={target.row.id} onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md p-6 shadow-lg space-y-3">
        <div className="text-base font-medium text-gray-900 mb-1">
          Edit {target.kind === 'disbursement' ? 'Disbursement' : 'Expense'}
        </div>
        <div className="text-xs text-gray-500 mb-2">{target.row.site}</div>

        {linkedInvoice && (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Linked to invoice #{linkedInvoice} — changing the amount also adjusts that payment.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Amount (₹)</label>
            <input type="number" min="1" step="1" value={amount}
              onChange={e => setAmount(e.target.value)} required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date</label>
            <input type="date" value={date}
              onChange={e => setDate(e.target.value)} required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>

        {target.kind === 'disbursement' ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Mode</label>
              <select value={mode} onChange={e => setMode(e.target.value as 'cash' | 'bank')}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm">
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Reference (optional)</label>
              <input value={reference} onChange={e => setReference(e.target.value)}
                placeholder="Cheque / UPI / TXN"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Purpose</label>
            <input value={purpose} onChange={e => setPurpose(e.target.value)} required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-500 mb-1">Remarks (optional)</label>
          <input value={remarks} onChange={e => setRemarks(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-3 py-2 text-sm text-gray-600">Cancel</button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 bg-[#1a3c5e] text-white text-sm rounded-lg hover:bg-[#15304d] disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
