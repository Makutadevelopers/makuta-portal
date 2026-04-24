import { useState, FormEvent } from 'react';
import { Invoice, DisputeSeverity } from '../../types/invoice';
import { markInvoiceDisputed, clearInvoiceDispute } from '../../api/invoices';

interface Props {
  invoice: Invoice;
  onClose: () => void;
  onDone: (updated: Invoice) => void;
}

export default function DisputeModal({ invoice, onClose, onDone }: Props) {
  const isClearing = invoice.disputed;
  const [severity, setSeverity] = useState<DisputeSeverity>(invoice.dispute_severity ?? 'minor');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }
    setSaving(true);
    try {
      const updated = isClearing
        ? await clearInvoiceDispute(invoice.id, reason.trim())
        : await markInvoiceDisputed(invoice.id, severity, reason.trim());
      onDone(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="text-base font-medium text-gray-900">
            {isClearing ? 'Clear dispute' : 'Mark invoice as disputed'}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={submit} className="p-5">
          <div className="mb-4 text-xs text-gray-500">
            Invoice <span className="font-mono text-gray-800">#{invoice.invoice_no ?? invoice.internal_no ?? invoice.id.slice(0, 8)}</span>
            {' · '}
            <span className="text-gray-700">{invoice.vendor_name}</span>
          </div>

          {isClearing && invoice.dispute_severity && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-600">
              Currently flagged as <strong className={invoice.dispute_severity === 'major' ? 'text-red-600' : 'text-amber-600'}>
                {invoice.dispute_severity}
              </strong>
              {invoice.dispute_reason ? <> — "{invoice.dispute_reason}"</> : null}
            </div>
          )}

          {error && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-xs">{error}</div>}

          {!isClearing && (
            <div className="mb-4">
              <label className="block text-xs text-gray-500 mb-1">Severity</label>
              <div className="flex gap-2">
                <label className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer ${severity === 'minor' ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}>
                  <input type="radio" checked={severity === 'minor'} onChange={() => setSeverity('minor')} />
                  <div>
                    <div className="text-xs font-medium text-gray-900">Minor</div>
                    <div className="text-[11px] text-gray-500">Needs attention, not urgent</div>
                  </div>
                </label>
                <label className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer ${severity === 'major' ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}>
                  <input type="radio" checked={severity === 'major'} onChange={() => setSeverity('major')} />
                  <div>
                    <div className="text-xs font-medium text-gray-900">Major</div>
                    <div className="text-[11px] text-gray-500">Urgent — blocking payment</div>
                  </div>
                </label>
              </div>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1">
              {isClearing ? 'Reason for clearing *' : 'Dispute reason *'}
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={isClearing
                ? 'e.g. Vendor issued credit note, site confirmed receipt, amount corrected...'
                : 'e.g. Quantity mismatch, damaged goods, rate disagreement...'}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={saving}
              className={`px-4 py-2 text-sm font-medium rounded-lg text-white disabled:opacity-50 ${isClearing ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
              {saving ? 'Saving...' : isClearing ? 'Clear dispute' : `Mark as ${severity}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
