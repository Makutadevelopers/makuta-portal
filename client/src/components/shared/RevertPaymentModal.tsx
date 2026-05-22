import { useState } from 'react';
import { revertPayments } from '../../api/payments';
import { useToast } from '../../context/ToastContext';

export interface RevertTarget {
  id: string;
  invoice_no?: string | null;
  vendor_name?: string | null;
  payment_status?: string;
}

/**
 * Confirms reversing ALL payments on an invoice (→ Not Paid) and captures a
 * mandatory reason (cheque bounce, wrong entry, …) for the audit log. The
 * payments are hard-deleted server-side; the reason lives in the Activity Log.
 *
 * Render with `invoice={null}` when closed. `onReverted(id)` fires after a
 * successful reversal so the caller can refresh that row.
 */
export default function RevertPaymentModal({
  invoice,
  onClose,
  onReverted,
}: {
  invoice: RevertTarget | null;
  onClose: () => void;
  onReverted: (invoiceId: string) => void;
}) {
  const { notify } = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (!invoice) return null;

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= 3 && !saving;

  async function submit() {
    if (!invoice || !canSubmit) return;
    setSaving(true);
    try {
      const res = await revertPayments(invoice.id, trimmed);
      notify(`Payments reversed — invoice marked ${res.invoice_payment_status}`);
      onReverted(invoice.id);
      setReason('');
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to revert payments', 'error');
    } finally {
      setSaving(false);
    }
  }

  const label = invoice.invoice_no
    ? `#${invoice.invoice_no}`
    : invoice.vendor_name || 'this invoice';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={() => !saving && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-2">
          <div className="text-base font-semibold text-gray-900">Mark as Not Paid?</div>
          <div className="mt-2 text-sm text-gray-600">
            This removes <span className="font-medium">all payments</span> on {label}
            {invoice.vendor_name && invoice.invoice_no ? ` (${invoice.vendor_name})` : ''} and sets it back to
            {' '}<span className="font-medium">Not Paid</span>. Use this for a cheque bounce or a payment entered by mistake.
            A cheque covering other invoices keeps their share.
          </div>
          <label className="mt-4 block text-xs font-medium text-gray-500">Reason (required)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
            placeholder="e.g. Cheque #123456 bounced / entered against wrong invoice"
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:opacity-50"
          >
            {saving ? 'Reverting…' : 'Mark as Not Paid'}
          </button>
        </div>
      </div>
    </div>
  );
}
