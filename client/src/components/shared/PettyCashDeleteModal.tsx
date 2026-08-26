import { useState } from 'react';
import { deleteDisbursement, deleteExpense } from '../../api/pettyCash';
import { PettyCashDisbursement, PettyCashExpense } from '../../types/pettyCash';
import { formatINR } from '../../utils/formatters';
import { useToast } from '../../context/ToastContext';

export type PettyCashDeleteTarget =
  | { kind: 'disbursement'; row: PettyCashDisbursement }
  | { kind: 'expense'; row: PettyCashExpense };

/**
 * Deleting a petty-cash entry is a soft delete server-side, but it still moves
 * real money out of a site's float (or, for an invoice-linked expense, undoes a
 * payment) — so a reason is required, same as reverting an invoice payment.
 */
export default function PettyCashDeleteModal({ target, onClose, onDeleted }: {
  target: PettyCashDeleteTarget | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { notify } = useToast();
  const [reason, setReason] = useState('');
  const [deleting, setDeleting] = useState(false);

  if (!target) return null;

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= 3 && !deleting;

  async function submit() {
    if (!target || !canSubmit) return;
    setDeleting(true);
    try {
      if (target.kind === 'disbursement') {
        await deleteDisbursement(target.row.id, trimmed);
      } else {
        await deleteExpense(target.row.id, trimmed);
      }
      notify('Entry deleted');
      onDeleted();
      setReason('');
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete entry', 'error');
    } finally {
      setDeleting(false);
    }
  }

  const label = target.kind === 'disbursement'
    ? `${formatINR(Number(target.row.amount))} given to ${target.row.site}`
    : `${formatINR(Number(target.row.amount))} spent at ${target.row.site} — ${target.row.purpose}`;
  const linkedInvoice = target.kind === 'expense' ? target.row.invoice_no : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      onClick={e => { e.stopPropagation(); if (!deleting) onClose(); }} role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white shadow-lg" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-2">
          <div className="text-base font-semibold text-gray-900">Delete this entry?</div>
          <div className="mt-2 text-sm text-gray-600">{label}</div>
          {linkedInvoice && (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This also removes the linked payment on invoice #{linkedInvoice} and recomputes its status.
            </div>
          )}
          <label className="mt-4 block text-xs font-medium text-gray-500">Reason (required)</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            autoFocus
            placeholder="e.g. duplicate entry, wrong site, entered by mistake"
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-3">
          <button type="button" onClick={onClose} disabled={deleting}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!canSubmit}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:opacity-50">
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
