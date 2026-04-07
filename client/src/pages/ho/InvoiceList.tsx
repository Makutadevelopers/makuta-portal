import { useState, useMemo, useEffect, useRef, FormEvent, ChangeEvent, DragEvent } from 'react';
import { useInvoices } from '../../hooks/useInvoices';
import { useAgingCalc } from '../../hooks/useAgingCalc';
import { useVendors } from '../../hooks/useVendors';
import { pushInvoice, undoPushInvoice, bulkFinalizeInvoices, getInvoiceHistory, AuditLogEntry, createInvoice, updateInvoice, deleteInvoice as deleteInvoiceApi } from '../../api/invoices';
import { uploadAttachment, getAttachments, Attachment } from '../../api/attachments';
import { createPayment, getPayments } from '../../api/payments';
import { formatINR, formatDate } from '../../utils/formatters';
import { SITES, PURPOSES, PAYMENT_TYPES, BANKS } from '../../utils/constants';
import { Invoice } from '../../types/invoice';
import { Payment } from '../../types/payment';
import AppShell from '../../components/layout/AppShell';
import BulkImportModal from '../../components/shared/BulkImportModal';
import AttachmentViewer from '../../components/shared/AttachmentViewer';
import { useToast } from '../../context/ToastContext';

export default function InvoiceList() {
  const { invoices, loading, refresh } = useInvoices();
  const { withinTerms, overdue } = useAgingCalc();
  const { vendors } = useVendors();

  const [showForm, setShowForm] = useState(false);
  const [editInv, setEditInv] = useState<Invoice | null>(null);

  const [search, setSearch] = useState('');
  const [fSite, setFSite] = useState('All');
  const [fStatus, setFStatus] = useState('All');
  const [fPurpose, setFPurpose] = useState('All');
  const [fMonth, setFMonth] = useState('');

  // Selection state for bulk actions
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Payment modal state
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  // History panel state
  const [historyInvoice, setHistoryInvoice] = useState<Invoice | null>(null);
  const [historyPayments, setHistoryPayments] = useState<Payment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Attachment viewer
  const [docsInvoice, setDocsInvoice] = useState<Invoice | null>(null);
  // Invoice info/history panel
  const [infoInvoice, setInfoInvoice] = useState<Invoice | null>(null);
  const [infoHistory, setInfoHistory] = useState<AuditLogEntry[]>([]);
  const [infoLoading, setInfoLoading] = useState(false);
  const { notify } = useToast();

  const agingMap = useMemo(() => {
    const map = new Map<string, { balance: number; daysLabel: string; daysNum: number }>();
    for (const r of overdue) {
      map.set(r.invoice_id, { balance: Number(r.balance), daysLabel: `${r.days_past_due}d`, daysNum: r.days_past_due });
    }
    for (const r of withinTerms) {
      map.set(r.invoice_id, { balance: Number(r.balance), daysLabel: `${r.days_left}d`, daysNum: -r.days_left });
    }
    return map;
  }, [withinTerms, overdue]);

  const filtered = useMemo(() => invoices.filter(i => {
    if (fSite !== 'All' && i.site !== fSite) return false;
    if (fStatus !== 'All' && i.payment_status !== fStatus) return false;
    if (fPurpose !== 'All' && i.purpose !== fPurpose) return false;
    if (fMonth) {
      const invMonth = (i.month || i.invoice_date || '').slice(0, 7);
      if (invMonth !== fMonth) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      if (!`${i.vendor_name} ${i.invoice_no} ${i.po_number ?? ''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [invoices, fSite, fStatus, fPurpose, fMonth, search]);

  // Selectable = filtered invoices that are not yet finalized (draft)
  const selectableIds = useMemo(() => filtered.filter(i => !i.pushed).map(i => i.id), [filtered]);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds));
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkFinalize() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkLoading(true);
    try {
      const result = await bulkFinalizeInvoices(ids);
      notify(`Finalized ${result.finalized} invoices`);
      setSelected(new Set());
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Bulk finalize failed');
    } finally {
      setBulkLoading(false);
    }
  }

  async function handlePush(id: string) {
    await pushInvoice(id);
    notify('Invoice finalized');
    refresh();
  }

  async function handleUndo(id: string) {
    await undoPushInvoice(id);
    notify('Finalization reverted');
    refresh();
  }

  async function handleDelete(inv: Invoice) {
    if (!confirm(`Delete invoice #${inv.invoice_no}? This cannot be undone.`)) return;
    try {
      await deleteInvoiceApi(inv.id);
      notify('Invoice deleted');
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  async function openInfo(inv: Invoice) {
    setInfoInvoice(inv);
    setInfoLoading(true);
    try {
      const history = await getInvoiceHistory(inv.id);
      setInfoHistory(history);
    } catch { setInfoHistory([]); }
    setInfoLoading(false);
  }

  async function openHistory(inv: Invoice) {
    setHistoryInvoice(inv);
    setHistoryLoading(true);
    try {
      const payments = await getPayments(inv.id);
      setHistoryPayments(payments);
    } catch { setHistoryPayments([]); }
    setHistoryLoading(false);
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="text-lg font-medium text-gray-900">All Invoices</div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(true)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Bulk Import
          </button>
          <a href="/api/export/invoices" target="_blank" rel="noopener noreferrer"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Export PDF
          </a>
          <button onClick={() => { setEditInv(null); setShowForm(true); }}
            className="px-4 py-2 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d]">
            + New Invoice
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendor, invoice no, PO..."
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        <select value={fSite} onChange={e => setFSite(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
          <option value="All">All Sites</option>
          {SITES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
          <option value="All">All Statuses</option>
          <option>Paid</option><option>Partial</option><option>Not Paid</option>
        </select>
        <select value={fPurpose} onChange={e => setFPurpose(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
          <option value="All">All Categories</option>
          {PURPOSES.map(p => <option key={p}>{p}</option>)}
        </select>
        <input type="month" value={fMonth} onChange={e => setFMonth(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} records</span>
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-blue-50 rounded-lg border border-blue-100">
          <span className="text-sm font-medium text-blue-800">{selected.size} invoice{selected.size > 1 ? 's' : ''} selected</span>
          <button onClick={handleBulkFinalize} disabled={bulkLoading}
            className="px-4 py-1.5 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d] disabled:opacity-50">
            {bulkLoading ? 'Finalizing...' : `Finalize ${selected.size} Invoice${selected.size > 1 ? 's' : ''}`}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-gray-500 hover:text-gray-700">Clear</button>
        </div>
      )}

      {/* Invoice Form */}
      {showForm && (
        <HOInvoiceForm
          key={editInv?.id ?? 'new'}
          vendors={vendors}
          editInvoice={editInv}
          onCancel={() => { setShowForm(false); setEditInv(null); }}
          onSaved={() => { setShowForm(false); setEditInv(null); notify(editInv ? 'Invoice updated' : 'Invoice added'); refresh(); }}
        />
      )}

      {/* Bulk Import Modal */}
      {showImport && (
        <BulkImportModal
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); refresh(); }}
        />
      )}

      {/* Payment Modal */}
      {payInvoice && (
        <PaymentModal
          invoice={payInvoice}
          balance={agingMap.get(payInvoice.id)?.balance ?? Number(payInvoice.invoice_amount)}
          onClose={() => setPayInvoice(null)}
          onSaved={() => { setPayInvoice(null); notify('Payment recorded'); refresh(); }}
        />
      )}

      {/* Attachment Viewer */}
      {docsInvoice && (
        <AttachmentViewer
          invoiceId={docsInvoice.id}
          invoiceNo={docsInvoice.invoice_no}
          onClose={() => setDocsInvoice(null)}
        />
      )}

      {/* Invoice Info / Audit History */}
      {infoInvoice && (
        <InvoiceInfoPanel
          invoice={infoInvoice}
          history={infoHistory}
          loading={infoLoading}
          onClose={() => setInfoInvoice(null)}
        />
      )}

      {/* Payment History */}
      {historyInvoice && (
        <PaymentHistoryPanel
          invoice={historyInvoice}
          payments={historyPayments}
          loading={historyLoading}
          onClose={() => setHistoryInvoice(null)}
          onAddPayment={() => { setHistoryInvoice(null); setPayInvoice(historyInvoice); }}
        />
      )}

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                    className="rounded border-gray-300 text-[#1a3c5e] focus:ring-blue-200"
                    title="Select all draft invoices" />
                </th>
                {['Date', 'Vendor', 'Inv. No', 'PO No', 'Category', 'Site', 'Amount', 'Balance', 'Days', 'Status', 'Docs', 'Actions'].map(h => (
                  <th key={h} className={`px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap ${h === 'Amount' || h === 'Balance' ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const aging = agingMap.get(inv.id);
                const isPaid = inv.payment_status === 'Paid';
                const isPartial = inv.payment_status === 'Partial';
                const isNotPaid = inv.payment_status === 'Not Paid';
                const isOverdue = aging && aging.daysNum > 0;

                return (
                  <tr key={inv.id} className={`border-t border-gray-50 hover:bg-gray-50/50 ${selected.has(inv.id) ? 'bg-blue-50/50' : ''}`}>
                    <td className="px-4 py-3">
                      {!inv.pushed ? (
                        <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleSelect(inv.id)}
                          className="rounded border-gray-300 text-[#1a3c5e] focus:ring-blue-200" />
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-[180px] truncate" title={inv.vendor_name}>{inv.vendor_name}</td>
                    <td className="px-4 py-3">{inv.invoice_no}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-[120px] truncate" title={inv.po_number ?? ''}>{inv.po_number ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{inv.purpose}</td>
                    <td className="px-4 py-3">{inv.site}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatINR(Number(inv.invoice_amount))}</td>
                    <td className="px-4 py-3 text-right">
                      {isPaid ? <span className="text-green-600">—</span>
                        : aging ? <span className="font-medium text-red-600">{formatINR(aging.balance)}</span>
                          : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {isPaid ? <span className="text-green-600">—</span>
                        : aging ? <span className={`text-xs font-medium ${isOverdue ? 'text-red-600' : 'text-green-600'}`}>{aging.daysLabel}</span>
                          : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          isPaid ? 'bg-green-50 text-green-700' : isPartial ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'
                        }`}>{inv.payment_status}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          inv.pushed ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'
                        }`}>{inv.pushed ? 'Master' : 'Draft'}</span>
                        {inv.minor_payment && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 text-orange-600">site</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(inv.attachment_count ?? 0) > 0
                        ? <button onClick={() => setDocsInvoice(inv)} className="text-xs font-medium text-blue-600 hover:underline" title={`${inv.attachment_count} file(s) — click to view`}>{inv.attachment_count} file{(inv.attachment_count ?? 0) > 1 ? 's' : ''}</button>
                        : <span className="text-xs font-medium text-red-500">N/A</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {!inv.pushed && (
                          <>
                            <button onClick={() => { setEditInv(inv); setShowForm(true); }} className="text-xs text-gray-600 hover:underline">Edit</button>
                            <button onClick={() => handlePush(inv.id)} className="text-xs text-blue-600 hover:underline">Final</button>
                            <button onClick={() => handleDelete(inv)} className="text-xs text-red-500 hover:underline">Del</button>
                          </>
                        )}
                        {inv.pushed && (
                          <button onClick={() => handleUndo(inv.id)} className="text-xs text-orange-600 hover:underline">Undo</button>
                        )}
                        {isNotPaid && (
                          <button onClick={() => setPayInvoice(inv)} className="text-xs text-green-600 hover:underline">Mark Paid</button>
                        )}
                        {isPartial && (
                          <>
                            <button onClick={() => setPayInvoice(inv)} className="text-xs text-green-600 hover:underline">Add Payment</button>
                            <button onClick={() => openHistory(inv)} className="text-xs text-gray-500 hover:underline">History</button>
                          </>
                        )}
                        {isPaid && (
                          <button onClick={() => openHistory(inv)} className="text-xs text-gray-500 hover:underline">History</button>
                        )}
                        <button onClick={() => openInfo(inv)} className="text-xs text-purple-600 hover:underline">Info</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={14} className="px-4 py-10 text-center text-gray-400 text-sm">No invoices match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

// ── Payment Modal ───────────────────────────────────────────────────────────
function PaymentModal({ invoice, balance, onClose, onSaved }: {
  invoice: Invoice; balance: number; onClose: () => void; onSaved: () => void;
}) {
  const [mode, setMode] = useState<'full' | 'part'>('full');
  const [amount, setAmount] = useState(String(balance));
  const [paymentType, setPaymentType] = useState('NEFT');
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [bank, setBank] = useState('HDFC');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [prevPayments, setPrevPayments] = useState<Payment[]>([]);

  // Load previous payments
  useState(() => {
    getPayments(invoice.id).then(setPrevPayments).catch(() => {});
  });

  const numAmount = Number(amount) || 0;
  const balanceAfter = balance - numAmount;
  const isOverpay = numAmount > balance;

  function handleModeChange(m: 'full' | 'part') {
    setMode(m);
    if (m === 'full') setAmount(String(balance));
    else setAmount('');
  }

  async function handleSubmit() {
    if (numAmount <= 0) { setError('Enter a valid amount'); return; }
    if (isOverpay) { setError('Amount exceeds balance'); return; }

    setSaving(true);
    setError('');
    try {
      await createPayment(invoice.id, {
        amount: numAmount,
        payment_type: paymentType,
        payment_ref: paymentRef.trim() || null,
        payment_date: paymentDate,
        bank: bank || null,
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

        {/* Previous payments */}
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
              <span>{formatINR(Number(invoice.invoice_amount) - balance)}</span>
            </div>
          </div>
        )}

        {/* Full / Part toggle */}
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

        {/* Amount */}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Amount (₹)</label>
          {mode === 'full' ? (
            <div className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 font-medium">{formatINR(balance)}</div>
          ) : (
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} min="1" max={balance}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          )}
          {mode === 'part' && numAmount > 0 && !isOverpay && (
            <div className="text-xs text-gray-500 mt-1">Balance after this payment: {formatINR(balanceAfter)}</div>
          )}
          {isOverpay && <div className="text-xs text-red-600 mt-1">Amount exceeds outstanding balance</div>}
        </div>

        {/* Payment details */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Payment Type</label>
            <select value={paymentType} onChange={e => setPaymentType(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white">
              {PAYMENT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Reference / TXN No</label>
            <input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="Cheque / TXN number"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Payment Date</label>
            <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Bank</label>
            <select value={bank} onChange={e => setBank(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white">
              {BANKS.map(b => <option key={b}>{b}</option>)}
            </select>
          </div>
        </div>

        {/* Actions */}
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

// ── Invoice Info Panel ─────────────────────────────────────────────────────
function InvoiceInfoPanel({ invoice, history, loading, onClose }: {
  invoice: Invoice; history: AuditLogEntry[]; loading: boolean; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl mx-4 p-4 sm:p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-base font-medium text-gray-900">Invoice Details</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {invoice.vendor_name} · #{invoice.invoice_no}
              {invoice.internal_no && <span className="ml-2 font-mono text-purple-600">{invoice.internal_no}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&#10005;</button>
        </div>

        {/* Invoice summary */}
        <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500">Internal No</div>
            <div className="font-mono font-medium text-purple-700">{invoice.internal_no ?? '—'}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500">Amount</div>
            <div className="font-medium">{formatINR(Number(invoice.invoice_amount))}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500">Status</div>
            <div className="font-medium">{invoice.pushed ? 'Finalized' : 'Draft'}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500">Created</div>
            <div className="font-medium">{formatDate(invoice.created_at)}</div>
          </div>
        </div>

        {/* Activity log */}
        <div className="text-sm font-medium text-gray-900 mb-3">Activity Log</div>
        {loading ? (
          <div className="text-gray-500 text-sm py-6 text-center">Loading...</div>
        ) : history.length === 0 ? (
          <div className="text-gray-400 text-sm py-6 text-center">No activity recorded yet.</div>
        ) : (
          <div className="space-y-3">
            {history.map(log => (
              <div key={log.id} className="flex items-start gap-3 border-l-2 border-purple-200 pl-3 py-1">
                <div className="flex-1">
                  <div className="text-sm text-gray-900">{log.action}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    by <span className="font-medium text-gray-700">{log.user_name}</span> on {new Date(log.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Payment History Panel ───────────────────────────────────────────────────
function PaymentHistoryPanel({ invoice, payments, loading, onClose, onAddPayment }: {
  invoice: Invoice; payments: Payment[]; loading: boolean; onClose: () => void; onAddPayment: () => void;
}) {
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Number(invoice.invoice_amount) - totalPaid;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl mx-4 p-4 sm:p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-base font-medium text-gray-900">Payment History</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {invoice.vendor_name} · #{invoice.invoice_no} · Invoice {formatINR(Number(invoice.invoice_amount))}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&#10005;</button>
        </div>

        {loading ? (
          <div className="text-gray-500 text-sm py-8 text-center">Loading...</div>
        ) : payments.length === 0 ? (
          <div className="text-gray-400 text-sm py-8 text-center">No payments recorded yet.</div>
        ) : (
          <table className="w-full text-[13px] mb-4">
            <thead className="bg-gray-50">
              <tr>
                {['Date', 'Amount', 'Type', 'Reference', 'Bank'].map(h => (
                  <th key={h} className={`px-4 py-2.5 font-medium text-gray-500 ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-t border-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(p.payment_date)}</td>
                  <td className="px-4 py-3 text-right font-medium text-green-700">{formatINR(Number(p.amount))}</td>
                  <td className="px-4 py-3">{p.payment_type}</td>
                  <td className="px-4 py-3 text-gray-500">{p.payment_ref || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{p.bank || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50">
              <tr>
                <td className="px-4 py-2.5 font-medium text-gray-900">Total Paid</td>
                <td className="px-4 py-2.5 text-right font-semibold text-green-700">{formatINR(totalPaid)}</td>
                <td colSpan={3} className="px-4 py-2.5 text-right text-sm">
                  {balance > 0
                    ? <span className="text-red-600 font-medium">Balance remaining: {formatINR(balance)}</span>
                    : <span className="text-green-600 font-medium">Fully paid</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        <div className="flex items-center gap-3">
          {balance > 0 && (
            <button onClick={onAddPayment} className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
              Add Payment
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── HO Invoice Form ────────────────────────────────────────────────────────
interface Vendor { id: string; name: string; payment_terms: number; category: string | null; }

function HOInvoiceForm({ vendors, editInvoice, onCancel, onSaved }: {
  vendors: Vendor[];
  editInvoice: Invoice | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editInvoice;
  const today = new Date().toISOString().split('T')[0];
  const currentMonth = today.slice(0, 7);

  const [vendorId, setVendorId] = useState(editInvoice?.vendor_id ?? '');
  const [vendorName, setVendorName] = useState(editInvoice?.vendor_name ?? '');
  const [vendorSearch, setVendorSearch] = useState('');
  const [invoiceNo, setInvoiceNo] = useState(editInvoice?.invoice_no ?? '');
  const [poNumber, setPoNumber] = useState(editInvoice?.po_number ?? '');
  const [purpose, setPurpose] = useState(editInvoice?.purpose ?? 'Steel');
  const [site, setSite] = useState(editInvoice?.site ?? 'Nirvana');
  const [invoiceDate, setInvoiceDate] = useState(editInvoice?.invoice_date?.split('T')[0] ?? today);
  const [month, setMonth] = useState(editInvoice?.month?.split('T')[0] ?? `${currentMonth}-01`);
  const [amount, setAmount] = useState(editInvoice ? String(editInvoice.invoice_amount) : '');
  const [remarks, setRemarks] = useState(editInvoice?.remarks ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editInvoice) {
      getAttachments(editInvoice.id).then(setExistingAttachments).catch(() => {});
    }
  }, [editInvoice]);

  function handleVendorChange(id: string) {
    setVendorId(id);
    const v = vendors.find(v => v.id === id);
    if (v) {
      setVendorName(v.name);
      if (v.category) setPurpose(v.category);
    }
  }

  function handleDateChange(d: string) {
    setInvoiceDate(d);
    if (d.length >= 7) setMonth(`${d.slice(0, 7)}-01`);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!vendorId && !vendorName.trim()) { setError('Select a vendor'); return; }
    if (!invoiceNo.trim()) { setError('Invoice number is required'); return; }
    if (!amount || Number(amount) <= 0) { setError('Enter a valid amount'); return; }

    setSaving(true);
    try {
      const data = {
        month, invoice_date: invoiceDate, vendor_id: vendorId || undefined, vendor_name: vendorName,
        invoice_no: invoiceNo.trim(), po_number: poNumber.trim() || null,
        purpose, site, invoice_amount: Number(amount), remarks: remarks.trim() || null,
      };

      let invoiceId: string;
      if (isEdit) {
        const updated = await updateInvoice(editInvoice.id, data);
        invoiceId = updated.id;
      } else {
        const created = await createInvoice(data);
        invoiceId = created.id;
      }

      if (pendingFiles.length > 0) {
        setUploading(true);
        for (const file of pendingFiles) await uploadAttachment(invoiceId, file);
        setUploading(false);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
      <div className="text-base font-medium text-gray-900 mb-5">{isEdit ? 'Edit Invoice' : 'New Invoice Entry'}</div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Month</label>
            <div className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-700 bg-gray-50">
              {new Date(month + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Invoice Date</label>
            <input type="date" value={invoiceDate} onChange={e => handleDateChange(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">
            Vendor Name *
            {vendorId && <span className="text-green-600 ml-2">&#10003; {vendorName}</span>}
          </label>
          <div className="relative">
            <input value={vendorSearch} onChange={e => { setVendorSearch(e.target.value); if (!e.target.value) { setVendorId(''); setVendorName(''); } }}
              placeholder={vendorId ? vendorName : 'Type to search vendor...'}
              onFocus={() => setVendorSearch(vendorSearch || vendorName)}
              onBlur={() => setTimeout(() => setVendorSearch(''), 200)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            {vendorSearch && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {vendors.filter(v => v.name.toLowerCase().includes(vendorSearch.toLowerCase())).map(v => (
                  <div key={v.id} onMouseDown={() => { handleVendorChange(v.id); setVendorSearch(''); }}
                    className="px-3 py-2 hover:bg-blue-50 cursor-pointer flex items-center justify-between">
                    <span className="text-sm text-gray-900">{v.name}</span>
                    <span className="text-xs text-gray-400">{v.category} · {v.payment_terms}d</span>
                  </div>
                ))}
                {vendors.filter(v => v.name.toLowerCase().includes(vendorSearch.toLowerCase())).length === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-400">No matching vendor</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Invoice No *</label>
            <input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} placeholder="Invoice number"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">PO Number</label>
            <input value={poNumber} onChange={e => setPoNumber(e.target.value)} placeholder="PO reference"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select value={purpose} onChange={e => setPurpose(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
              {PURPOSES.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Site Location</label>
            <select value={site} onChange={e => setSite(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
              {SITES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Invoice Amount (*)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" min="1" step="0.01"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Remarks</label>
          <textarea value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Notes..." rows={2}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none" />
        </div>

        <div className="mb-5">
          <label className="block text-xs text-gray-500 mb-1">Invoice copies & documents</label>
          <div
            onDragOver={(e: DragEvent) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setPendingFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]); }}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-300">
            <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple className="hidden"
              onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.files) { setPendingFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; } }} />
            <div className="text-sm text-gray-600 font-medium">Drag & drop or click to browse</div>
            <div className="text-xs text-gray-400 mt-1">PDF, JPG, PNG — max 10 MB each</div>
          </div>
          {existingAttachments.length > 0 && (
            <div className="mt-3 space-y-2">
              {existingAttachments.map(att => (
                <div key={att.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                  <a href={att.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline font-medium">{att.file_name}</a>
                  <span className="text-xs text-gray-400">{att.file_size ? `${Math.round(att.file_size / 1024)} KB` : ''}</span>
                </div>
              ))}
            </div>
          )}
          {pendingFiles.length > 0 && (
            <div className="mt-3 space-y-2">
              {pendingFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 bg-blue-50 rounded-lg">
                  <div className="text-sm font-medium text-gray-900">{f.name} <span className="text-xs text-gray-400">{Math.round(f.size / 1024)} KB</span></div>
                  <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-sm">&#10005;</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving || uploading}
            className="px-5 py-2.5 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d] disabled:opacity-50">
            {saving ? 'Saving...' : uploading ? 'Uploading files...' : 'Save Invoice'}
          </button>
          <button type="button" onClick={onCancel} className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
        </div>
      </form>
    </div>
  );
}
