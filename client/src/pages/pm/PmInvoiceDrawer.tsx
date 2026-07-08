// Read-only invoice detail drawer for project managers. Slides in from the
// right when a row in PmInvoices is clicked. Purely presentational — no edit /
// pay / push / delete controls (the server would 403 those anyway). All data
// comes from endpoints already scoped to the PM's assigned sites.

import { useEffect, useState } from 'react';
import { getInvoiceLineItems } from '../../api/invoices';
import { getPayments } from '../../api/payments';
import { Invoice, InvoiceLineItem } from '../../types/invoice';
import { Payment } from '../../types/payment';
import { formatINR, formatDate } from '../../utils/formatters';
import { useToast } from '../../context/ToastContext';

function statusBadge(status?: string) {
  const s = status ?? 'Not Paid';
  const cls = s === 'Paid'
    ? 'bg-green-100 text-green-800'
    : s === 'Partial'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-gray-100 text-gray-700';
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{s}</span>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 text-right">{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium mt-5 mb-1">{children}</div>;
}

export default function PmInvoiceDrawer({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const { notify } = useToast();
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    let cancelled = false;
    setLoading(true);
    setLineItems([]);
    setPayments([]);
    Promise.all([getInvoiceLineItems(invoice.id), getPayments(invoice.id)])
      .then(([items, pays]) => {
        if (cancelled) return;
        setLineItems(items);
        setPayments(pays);
      })
      .catch(err => {
        if (!cancelled) notify(err instanceof Error ? err.message : 'Failed to load invoice detail', 'error');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [invoice, notify]);

  // Close on Escape.
  useEffect(() => {
    if (!invoice) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [invoice, onClose]);

  if (!invoice) return null;

  const amount = Number(invoice.invoice_amount);
  const balance = Number(invoice.balance ?? 0);
  const credits = Number(invoice.allocated_credits ?? 0);
  const gstLine = [
    invoice.cgst_pct ? `CGST ${invoice.cgst_pct}%` : null,
    invoice.sgst_pct ? `SGST ${invoice.sgst_pct}%` : null,
    invoice.igst_pct ? `IGST ${invoice.igst_pct}%` : null,
  ].filter(Boolean).join(' · ') || '—';

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-base font-medium text-gray-900 truncate">{invoice.vendor_name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {invoice.invoice_no || 'No invoice no'} · {invoice.site}
            </div>
          </div>
          <button onClick={onClose} className="ml-3 text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="px-5 pb-8">
          <div className="flex items-center gap-3 mt-4">
            {statusBadge(invoice.payment_status)}
            {invoice.disputed && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-800">Disputed</span>
            )}
            {invoice.pushed && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 text-blue-800">Finalized</span>
            )}
          </div>

          <SectionTitle>Invoice</SectionTitle>
          <Row label="Invoice date" value={formatDate(invoice.invoice_date)} />
          <Row label="Category" value={invoice.purpose} />
          {invoice.po_number && <Row label="PO / WO" value={invoice.po_number} />}
          <Row label="Site" value={invoice.site} />

          <SectionTitle>Amounts</SectionTitle>
          {invoice.base_amount != null && <Row label="Taxable amount" value={formatINR(Number(invoice.base_amount))} />}
          <Row label="GST" value={gstLine} />
          {Number(invoice.additional_charge) > 0 && (
            <Row label="Additional charge" value={formatINR(Number(invoice.additional_charge))} />
          )}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <Row label="Invoice total" value={<span className="font-semibold">{formatINR(amount)}</span>} />
          </div>
          {credits > 0 && <Row label="Credit notes applied" value={`− ${formatINR(credits)}`} />}
          <Row label="Outstanding balance" value={<span className="font-semibold">{formatINR(balance)}</span>} />
          {invoice.last_paid_date && <Row label="Last payment" value={formatDate(invoice.last_paid_date)} />}

          {/* Line items */}
          <SectionTitle>Line items</SectionTitle>
          {loading ? (
            <div className="text-sm text-gray-400 py-2">Loading…</div>
          ) : lineItems.length === 0 ? (
            <div className="text-sm text-gray-400 py-2">No additional line items.</div>
          ) : (
            <div className="space-y-1">
              {lineItems.map(li => (
                <div key={li.id} className="flex justify-between gap-4 text-sm py-1 border-b border-gray-50">
                  <span className="text-gray-700">{li.description || `Line ${li.line_no}`}</span>
                  <span className="text-gray-900 whitespace-nowrap">{formatINR(Number(li.amount))}</span>
                </div>
              ))}
            </div>
          )}

          {/* Payment history */}
          <SectionTitle>Payments</SectionTitle>
          {loading ? (
            <div className="text-sm text-gray-400 py-2">Loading…</div>
          ) : payments.length === 0 ? (
            <div className="text-sm text-gray-400 py-2">No payments recorded.</div>
          ) : (
            <div className="space-y-2">
              {payments.map(p => {
                const tds = Number(p.tds_amount) + Number(p.gst_tds_amount);
                return (
                  <div key={p.id} className="rounded-lg border border-gray-100 px-3 py-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-900 font-medium">{formatINR(Number(p.amount))}</span>
                      <span className="text-gray-500">{formatDate(p.payment_date)}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {p.payment_type}{p.payment_ref ? ` · ${p.payment_ref}` : ''}{p.bank ? ` · ${p.bank}` : ''}
                      {tds > 0 ? ` · TDS ${formatINR(tds)}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {invoice.remarks && (
            <>
              <SectionTitle>Remarks</SectionTitle>
              <div className="text-sm text-gray-700 whitespace-pre-wrap">{invoice.remarks}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
