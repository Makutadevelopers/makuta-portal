import { useState, useMemo, useEffect, useRef, Fragment, FormEvent, DragEvent, ChangeEvent } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useInvoices } from '../../hooks/useInvoices';
import { useVendors } from '../../hooks/useVendors';
import { createInvoice, updateInvoice } from '../../api/invoices';
import { uploadAttachment, getAttachments, deleteAttachment, Attachment } from '../../api/attachments';
import { Invoice } from '../../types/invoice';
import { formatINR, formatDate } from '../../utils/formatters';
import { PURPOSES } from '../../utils/constants';
import AppShell from '../../components/layout/AppShell';
import BulkImportModal from '../../components/shared/BulkImportModal';
import DisputeModal from '../../components/shared/DisputeModal';
import PayFromPettyCashModal from '../../components/shared/PayFromPettyCashModal';
import SiteBulkPayModal from '../../components/shared/SiteBulkPayModal';
import { useToast } from '../../context/ToastContext';

const MINOR_LIMIT = 50000;

export default function MyInvoices() {
  const { user } = useAuth();
  const { invoices, loading, refresh } = useInvoices();
  const { vendors } = useVendors();
  const [search, setSearch] = useState('');
  const [fPurpose, setFPurpose] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [expandedEditId, setExpandedEditId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [disputeInv, setDisputeInv] = useState<Invoice | null>(null);
  const [payInv, setPayInv] = useState<Invoice | null>(null);
  const [bulkPayOpen, setBulkPayOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { notify } = useToast();
  const selectedInvoices = useMemo(
    () => invoices.filter(i => selectedIds.has(i.id)),
    [invoices, selectedIds]
  );
  const selectedInvoice = selectedIds.size === 1 ? selectedInvoices[0] ?? null : null;
  const bulkPayable = selectedInvoices.filter(i => !i.pushed && i.payment_status !== 'Paid');

  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  const filtered = useMemo(() => invoices.filter(i => {
    if (fPurpose !== 'All' && i.purpose !== fPurpose) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${i.vendor_name} ${i.invoice_no} ${i.po_number ?? ''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [invoices, fPurpose, search]);

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="text-lg font-medium text-gray-900">My Invoices</div>
        <div className="flex items-center gap-2 flex-wrap">
          {selectedIds.size > 0 && (
            <span className="text-xs text-gray-500 mr-1">
              {selectedIds.size} selected · <button type="button" onClick={clearSelection} className="text-blue-600 hover:underline">clear</button>
            </span>
          )}
          {bulkPayable.length > 0 && (
            <button
              onClick={() => setBulkPayOpen(true)}
              className="px-3 py-2 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800"
              title="Pay selected invoices from petty cash (each ≤ ₹50,000)"
            >
              Pay Selected ({bulkPayable.length})
            </button>
          )}
          {selectedInvoice && (
            <button
              onClick={() => setDisputeInv(selectedInvoice)}
              className={`px-3 py-2 text-white text-sm font-medium rounded-lg ${
                selectedInvoice.disputed ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
              }`}
              title={`${selectedInvoice.disputed ? 'Clear dispute on' : 'Raise dispute on'} #${selectedInvoice.invoice_no}`}
            >
              {selectedInvoice.disputed ? 'Clear Dispute' : 'Raise Dispute'}
            </button>
          )}
          <button onClick={() => setShowImport(true)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Bulk Import
          </button>
          <button
            onClick={() => { setExpandedEditId(null); setShowForm(true); }}
            className="px-4 py-2 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d]"
          >
            + New Invoice
          </button>
        </div>
      </div>

      {/* Bulk Import Modal */}
      {showImport && (
        <BulkImportModal
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); refresh(); }}
        />
      )}

      {/* Dispute modal */}
      {disputeInv && (
        <DisputeModal
          invoice={disputeInv}
          onClose={() => setDisputeInv(null)}
          onDone={() => {
            const wasDisputed = disputeInv.disputed;
            setDisputeInv(null);
            notify(wasDisputed ? 'Dispute cleared' : 'Invoice disputed');
            refresh();
          }}
        />
      )}

      {/* Pay from petty cash modal */}
      {payInv && (
        <PayFromPettyCashModal
          invoice={payInv}
          onClose={() => setPayInv(null)}
          onDone={() => {
            const amt = Number(payInv.invoice_amount);
            setPayInv(null);
            notify(`Paid ${formatINR(amt)} from petty cash`);
            refresh();
          }}
        />
      )}

      {/* Bulk pay from petty cash modal */}
      {bulkPayOpen && bulkPayable.length > 0 && (
        <SiteBulkPayModal
          invoices={bulkPayable}
          site={user?.site ?? ''}
          onClose={() => setBulkPayOpen(false)}
          onDone={(paid, failed) => {
            setBulkPayOpen(false);
            clearSelection();
            if (failed === 0) notify(`Paid ${paid} invoice${paid > 1 ? 's' : ''} from petty cash`);
            else notify(`${paid} paid, ${failed} failed`, 'error');
            refresh();
          }}
        />
      )}

      {/* New Invoice Form (top). Edit opens inline below the row — see table below. */}
      {showForm && (
        <InvoiceForm
          key="new"
          site={user?.site ?? ''}
          vendors={vendors}
          editInvoice={null}
          onCancel={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); notify('Invoice added'); refresh(); }}
        />
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search vendor, invoice no, PO..."
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <select value={fPurpose} onChange={e => setFPurpose(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
          <option value="All">All Categories</option>
          {PURPOSES.map(p => <option key={p}>{p}</option>)}
        </select>
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} records</span>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 w-8">
                  {(() => {
                    const eligible = filtered.filter(i => !i.pushed && i.payment_status !== 'Paid');
                    const allSelected = eligible.length > 0 && eligible.every(i => selectedIds.has(i.id));
                    const someSelected = eligible.some(i => selectedIds.has(i.id));
                    return (
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                        disabled={eligible.length === 0}
                        onChange={() => {
                          if (allSelected) clearSelection();
                          else setSelectedIds(new Set(eligible.map(i => i.id)));
                        }}
                        className="rounded border-gray-300 text-[#1a3c5e] focus:ring-blue-200"
                        title="Select all draft, unpaid invoices"
                      />
                    );
                  })()}
                </th>
                {['#', 'Int. No', 'Date', 'Vendor', 'Inv. No', 'PO No', 'Category', 'Amount', 'Status', 'Actions'].map(h => (
                  <th key={h} className={`px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap ${h === 'Amount' ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => (
                <Fragment key={inv.id}>
                <tr className={`border-t border-gray-50 hover:bg-gray-50/50 ${selectedIds.has(inv.id) ? 'bg-blue-50/60' : ''} ${inv.disputed ? (inv.dispute_severity === 'major' ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-amber-400') : ''}`}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(inv.id)}
                      onChange={() => toggleSelected(inv.id)}
                      className="rounded border-gray-300 text-[#1a3c5e] focus:ring-blue-200"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-400">{inv.sl_no}</td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-500">{inv.internal_no ?? '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 max-w-[180px] truncate" title={inv.vendor_name}>{inv.vendor_name}</td>
                  <td className="px-4 py-3">{inv.invoice_no}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[140px] truncate" title={inv.po_number ?? ''}>{inv.po_number ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{inv.purpose}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {formatINR(Number(inv.invoice_amount))}
                    {Number(inv.allocated_credits ?? 0) > 0 && (
                      <div className="text-[10px] font-normal text-purple-600" title={`Credit note applied: ₹${Number(inv.allocated_credits).toLocaleString('en-IN')}`}>
                        − CN {formatINR(Number(inv.allocated_credits))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        inv.pushed ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'
                      }`}>{inv.pushed ? 'Finalized' : 'Draft'}</span>
                      {inv.disputed && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            inv.dispute_severity === 'major' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                          }`}
                          title={inv.dispute_reason ?? ''}
                        >
                          Disputed · {inv.dispute_severity}
                        </span>
                      )}
                      {inv.payment_status && (() => {
                        const label = inv.payment_status === 'Not Paid' ? 'Pending' : inv.payment_status;
                        const tone =
                          inv.payment_status === 'Paid'    ? 'bg-green-50 text-green-700'   :
                          inv.payment_status === 'Partial' ? 'bg-amber-50 text-amber-700'   :
                                                             'bg-gray-100 text-gray-600';
                        return <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${tone}`}>{label}</span>;
                      })()}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {!inv.pushed && (
                        <span
                          onClick={() => setExpandedEditId(expandedEditId === inv.id ? null : inv.id)}
                          className="text-xs text-blue-600 cursor-pointer hover:underline"
                        >{expandedEditId === inv.id ? 'Close' : 'Edit'}</span>
                      )}
                      {!inv.pushed
                        && inv.payment_status !== 'Paid'
                        && Number(inv.effective_payable ?? inv.invoice_amount) <= MINOR_LIMIT && (
                        <span
                          onClick={() => setPayInv(inv)}
                          className="text-xs text-green-700 cursor-pointer hover:underline"
                          title="Pay this invoice from your petty cash float"
                        >Pay</span>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedEditId === inv.id && (
                  <tr className="bg-gray-50/60 border-t border-gray-100">
                    <td colSpan={11} className="px-4 py-4">
                      <InvoiceForm
                        key={`edit-${inv.id}`}
                        site={user?.site ?? ''}
                        vendors={vendors}
                        editInvoice={inv}
                        onCancel={() => setExpandedEditId(null)}
                        onSaved={() => { setExpandedEditId(null); notify('Invoice updated'); refresh(); }}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-400 text-sm">No invoices match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

// ── Invoice Form ────────────────────────────────────────────────────────────
interface Vendor { id: string; name: string; payment_terms: number; category: string | null; }

function InvoiceForm({ site, vendors, editInvoice, onCancel, onSaved }: {
  site: string;
  vendors: Vendor[];
  editInvoice: Invoice | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editInvoice;
  const { notify } = useToast();
  const today = new Date().toISOString().split('T')[0];
  const currentMonth = today.slice(0, 7);
  const DRAFT_KEY = `makuta:invoice-draft:${site}`;

  // Read draft synchronously on the first render so initial state matches it,
  // avoiding a race with the persist effect under React.StrictMode.
  const draftRef = useRef<Record<string, unknown> | null | undefined>(undefined);
  if (draftRef.current === undefined) {
    draftRef.current = null;
    if (!isEdit) {
      try {
        const saved = typeof window !== 'undefined' ? window.localStorage.getItem(DRAFT_KEY) : null;
        if (saved) draftRef.current = JSON.parse(saved) as Record<string, unknown>;
      } catch {
        /* ignore corrupted drafts */
      }
    }
  }
  const dInit = draftRef.current;
  const dStr = (k: string, fallback = '') =>
    typeof dInit?.[k] === 'string' ? (dInit[k] as string) : fallback;
  const dBool = (k: string, fallback = false) =>
    typeof dInit?.[k] === 'boolean' ? (dInit[k] as boolean) : fallback;

  const [vendorId, setVendorId] = useState(editInvoice?.vendor_id ?? dStr('vendorId'));
  const [vendorName, setVendorName] = useState(editInvoice?.vendor_name ?? dStr('vendorName'));
  const [freeTextMode, setFreeTextMode] = useState(dBool('freeTextMode'));
  const [vendorDropdownOpen, setVendorDropdownOpen] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState(editInvoice?.invoice_no ?? dStr('invoiceNo'));
  const [poNumber, setPoNumber] = useState(editInvoice?.po_number ?? dStr('poNumber'));
  const [purpose, setPurpose] = useState(editInvoice?.purpose ?? dStr('purpose', 'Steel'));
  const [invoiceDate, setInvoiceDate] = useState(editInvoice?.invoice_date?.split('T')[0] ?? dStr('invoiceDate', today));
  const [month, setMonth] = useState(editInvoice?.month?.split('T')[0] ?? dStr('month', `${currentMonth}-01`));
  const [baseAmount, setBaseAmount] = useState(
    editInvoice ? String(editInvoice.base_amount ?? editInvoice.invoice_amount) : dStr('baseAmount')
  );
  const [cgstPct, setCgstPct] = useState(editInvoice && Number(editInvoice.cgst_pct) ? String(editInvoice.cgst_pct) : dStr('cgstPct'));
  const [sgstPct, setSgstPct] = useState(editInvoice && Number(editInvoice.sgst_pct) ? String(editInvoice.sgst_pct) : dStr('sgstPct'));
  const [igstPct, setIgstPct] = useState(editInvoice && Number(editInvoice.igst_pct) ? String(editInvoice.igst_pct) : dStr('igstPct'));

  const [addlChargeOn, setAddlChargeOn] = useState(
    editInvoice ? Number(editInvoice.additional_charge) > 0 : dBool('addlChargeOn')
  );
  const [addlCharge, setAddlCharge] = useState(
    editInvoice && Number(editInvoice.additional_charge) > 0 ? String(editInvoice.additional_charge) : dStr('addlCharge')
  );
  const [addlGstOn, setAddlGstOn] = useState(
    editInvoice
      ? Number(editInvoice.additional_charge_cgst_pct) > 0 ||
        Number(editInvoice.additional_charge_sgst_pct) > 0 ||
        Number(editInvoice.additional_charge_igst_pct) > 0
      : dBool('addlGstOn')
  );
  const [addlCgstPct, setAddlCgstPct] = useState(editInvoice && Number(editInvoice.additional_charge_cgst_pct) ? String(editInvoice.additional_charge_cgst_pct) : dStr('addlCgstPct'));
  const [addlSgstPct, setAddlSgstPct] = useState(editInvoice && Number(editInvoice.additional_charge_sgst_pct) ? String(editInvoice.additional_charge_sgst_pct) : dStr('addlSgstPct'));
  const [addlIgstPct, setAddlIgstPct] = useState(editInvoice && Number(editInvoice.additional_charge_igst_pct) ? String(editInvoice.additional_charge_igst_pct) : dStr('addlIgstPct'));
  const [addlReason, setAddlReason] = useState(editInvoice?.additional_charge_reason ?? dStr('addlReason'));

  const baseNum = Number(baseAmount) || 0;
  const cgstNum = Number(cgstPct) || 0;
  const sgstNum = Number(sgstPct) || 0;
  const igstNum = Number(igstPct) || 0;
  const cgstAmt = +(baseNum * cgstNum / 100).toFixed(2);
  const sgstAmt = +(baseNum * sgstNum / 100).toFixed(2);
  const igstAmt = +(baseNum * igstNum / 100).toFixed(2);
  const addlChargeNum = addlChargeOn ? (Number(addlCharge) || 0) : 0;
  const addlCgstNum = addlChargeOn && addlGstOn ? (Number(addlCgstPct) || 0) : 0;
  const addlSgstNum = addlChargeOn && addlGstOn ? (Number(addlSgstPct) || 0) : 0;
  const addlIgstNum = addlChargeOn && addlGstOn ? (Number(addlIgstPct) || 0) : 0;
  const addlCgstAmt = +(addlChargeNum * addlCgstNum / 100).toFixed(2);
  const addlSgstAmt = +(addlChargeNum * addlSgstNum / 100).toFixed(2);
  const addlIgstAmt = +(addlChargeNum * addlIgstNum / 100).toFixed(2);
  const addlLineTotal = +(addlChargeNum + addlCgstAmt + addlSgstAmt + addlIgstAmt).toFixed(2);
  const totalAmount = +(baseNum + cgstAmt + sgstAmt + igstAmt + addlLineTotal).toFixed(2);
  const [remarks, setRemarks] = useState(editInvoice?.remarks ?? dStr('remarks'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [draftRestored, setDraftRestored] = useState(!isEdit && !!dInit);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing attachments when editing
  useEffect(() => {
    if (editInvoice) {
      getAttachments(editInvoice.id).then(setExistingAttachments).catch(() => {});
    }
  }, [editInvoice]);

  // Persist draft on every change (new invoice only).
  // If the form has no user-entered content, remove the key so a fresh visit
  // doesn't show a "Draft restored" banner over an empty form.
  useEffect(() => {
    if (isEdit) return;
    const hasContent =
      !!vendorId || !!vendorName.trim() ||
      !!invoiceNo.trim() || !!poNumber.trim() ||
      !!baseAmount || !!cgstPct || !!sgstPct || !!igstPct ||
      addlChargeOn || !!addlCharge || !!addlReason.trim() ||
      !!remarks.trim();
    try {
      if (hasContent) {
        const draft = {
          vendorId, vendorName, freeTextMode,
          invoiceNo, poNumber, purpose,
          invoiceDate, month,
          baseAmount, cgstPct, sgstPct, igstPct,
          addlChargeOn, addlCharge, addlGstOn,
          addlCgstPct, addlSgstPct, addlIgstPct, addlReason,
          remarks,
        };
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } else {
        window.localStorage.removeItem(DRAFT_KEY);
      }
    } catch {}
  }, [
    isEdit, DRAFT_KEY,
    vendorId, vendorName, freeTextMode,
    invoiceNo, poNumber, purpose,
    invoiceDate, month,
    baseAmount, cgstPct, sgstPct, igstPct,
    addlChargeOn, addlCharge, addlGstOn,
    addlCgstPct, addlSgstPct, addlIgstPct, addlReason,
    remarks,
  ]);

  function discardDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch {}
    setVendorId(''); setVendorName(''); setFreeTextMode(false);
    setInvoiceNo(''); setPoNumber(''); setPurpose('Steel');
    setInvoiceDate(today); setMonth(`${currentMonth}-01`);
    setBaseAmount(''); setCgstPct(''); setSgstPct(''); setIgstPct('');
    setAddlChargeOn(false); setAddlCharge(''); setAddlGstOn(false);
    setAddlCgstPct(''); setAddlSgstPct(''); setAddlIgstPct(''); setAddlReason('');
    setRemarks(''); setPendingFiles([]); setDraftRestored(false);
  }

  function handleVendorChange(id: string) {
    setVendorId(id);
    const v = vendors.find(v => v.id === id);
    if (v) {
      setVendorName(v.name);
      if (v.category) setPurpose(v.category);
    }
  }

  // Update month when invoice date changes
  function handleDateChange(d: string) {
    setInvoiceDate(d);
    if (d.length >= 7) {
      setMonth(`${d.slice(0, 7)}-01`);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!vendorId && !vendorName.trim()) { setError('Select or enter a vendor name'); return; }
    if (!invoiceNo.trim()) { setError('Invoice number is required'); return; }
    if (baseNum <= 0) { setError('Enter a valid base amount'); return; }
    if (totalAmount <= 0) { setError('Total amount must be greater than zero'); return; }
    if (addlChargeOn && addlChargeNum > 0 && !addlReason.trim()) {
      setError('Reason is required when additional charge is entered');
      return;
    }

    setSaving(true);
    try {
      const data = {
        month,
        invoice_date: invoiceDate,
        vendor_id: vendorId || undefined,
        vendor_name: vendorName,
        invoice_no: invoiceNo.trim(),
        po_number: poNumber.trim() || null,
        purpose,
        site,
        invoice_amount: totalAmount,
        base_amount: baseNum,
        cgst_pct: cgstNum,
        sgst_pct: sgstNum,
        igst_pct: igstNum,
        additional_charge: addlChargeNum,
        additional_charge_cgst_pct: addlCgstNum,
        additional_charge_sgst_pct: addlSgstNum,
        additional_charge_igst_pct: addlIgstNum,
        additional_charge_reason: addlChargeNum > 0 ? addlReason.trim() : null,
        remarks: remarks.trim() || null,
      };

      let invoiceId: string;
      if (isEdit) {
        const updated = await updateInvoice(editInvoice.id, data);
        invoiceId = updated.id;
      } else {
        const created = await createInvoice(data);
        invoiceId = created.id;
      }

      // Upload pending files
      if (pendingFiles.length > 0) {
        setUploading(true);
        for (const file of pendingFiles) {
          await uploadAttachment(invoiceId, file);
        }
        setUploading(false);
      }

      if (!isEdit) {
        try { window.localStorage.removeItem(DRAFT_KEY); } catch {}
      }
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setError(msg);
      notify(msg);
    } finally {
      setSaving(false);
    }
  }

  function monthLabel(d: string): string {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div className="text-base font-medium text-gray-900">{isEdit ? 'Edit Invoice' : 'New Invoice Entry'}</div>
        {!isEdit && draftRestored && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg flex items-center gap-2">
            <span>Draft restored from your last session</span>
            <button type="button" onClick={discardDraft} className="text-red-600 hover:underline">Discard</button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Row 1: Month + Invoice Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Month</label>
            <div className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-700 bg-gray-50">
              {monthLabel(month)}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Invoice Date</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={e => handleDateChange(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
        </div>

        {/* Row 2: Vendor */}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">
            Vendor Name *
            {vendorId && !freeTextMode && (() => {
              const v = vendors.find(v => v.id === vendorId);
              return v ? <span className="text-green-600 ml-2">&#10003; In Vendor Master · {v.payment_terms}-day terms</span> : null;
            })()}
            {freeTextMode && vendorName.trim() && (
              <span className="text-orange-600 ml-2">&#9888; Not in Vendor Master — will default to 30-day terms</span>
            )}
          </label>
          {freeTextMode ? (
            <div className="flex gap-2">
              <input
                value={vendorName}
                onChange={e => { setVendorName(e.target.value); setVendorId(''); }}
                placeholder="Enter vendor name..."
                className="w-full px-3 py-2.5 border-2 border-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 bg-orange-50"
              />
              <button type="button" onClick={() => { setFreeTextMode(false); setVendorName(''); setVendorId(''); }}
                className="text-xs text-blue-600 whitespace-nowrap hover:underline px-2">Back to list</button>
            </div>
          ) : (
            <div className="relative">
              <input
                value={vendorName}
                onChange={e => {
                  setVendorName(e.target.value);
                  setVendorId('');
                  setVendorDropdownOpen(true);
                }}
                onFocus={() => setVendorDropdownOpen(true)}
                onBlur={() => setTimeout(() => setVendorDropdownOpen(false), 150)}
                placeholder="Type to search or select vendor..."
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              {vendorDropdownOpen && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {vendors
                    .filter(v => v.name.toLowerCase().includes(vendorName.toLowerCase()))
                    .map(v => (
                      <div
                        key={v.id}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { handleVendorChange(v.id); setVendorDropdownOpen(false); }}
                        className="px-3 py-2 hover:bg-blue-50 cursor-pointer flex items-center justify-between"
                      >
                        <span className="text-sm text-gray-900">{v.name}</span>
                        <span className="text-xs text-gray-400">{v.category} · {v.payment_terms}d</span>
                      </div>
                    ))}
                  {vendorName.trim() && vendors.filter(v => v.name.toLowerCase().includes(vendorName.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2">
                      <div className="text-xs text-gray-400 mb-1">No matching vendor found</div>
                      <button type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { setFreeTextMode(true); setVendorId(''); setVendorDropdownOpen(false); }}
                        className="text-xs text-orange-600 hover:underline">Enter "{vendorName}" as new vendor</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Row 3: Invoice No + PO + Category */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Invoice No *</label>
            <input
              value={invoiceNo}
              onChange={e => setInvoiceNo(e.target.value)}
              placeholder="Invoice number"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">PO Number</label>
            <input
              value={poNumber}
              onChange={e => setPoNumber(e.target.value)}
              placeholder="PO reference"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {PURPOSES.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* Row 4: Site */}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Site Location</label>
          <div className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-700 bg-gray-50">
            {site}
          </div>
        </div>

        {/* Row 5: Tax split */}
        <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
          <div className="text-xs font-medium text-gray-600 mb-3">Invoice Amount Breakdown</div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Base Amount (₹) *</label>
              <input
                type="number"
                value={baseAmount}
                onChange={e => setBaseAmount(e.target.value)}
                placeholder="0"
                min="0"
                step="0.01"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">CGST %</label>
              <input
                type="number"
                value={cgstPct}
                onChange={e => setCgstPct(e.target.value)}
                placeholder="0"
                min="0"
                max="100"
                step="0.01"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <div className="text-[11px] text-gray-400 mt-1">{formatINR(cgstAmt)}</div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">SGST %</label>
              <input
                type="number"
                value={sgstPct}
                onChange={e => setSgstPct(e.target.value)}
                placeholder="0"
                min="0"
                max="100"
                step="0.01"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <div className="text-[11px] text-gray-400 mt-1">{formatINR(sgstAmt)}</div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">IGST %</label>
              <input
                type="number"
                value={igstPct}
                onChange={e => setIgstPct(e.target.value)}
                placeholder="0"
                min="0"
                max="100"
                step="0.01"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <div className="text-[11px] text-gray-400 mt-1">{formatINR(igstAmt)}</div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
            <span className="text-sm text-gray-600">Sub-total (base + GST)</span>
            <span className="text-sm font-medium text-gray-800">
              {formatINR(+(baseNum + cgstAmt + sgstAmt + igstAmt).toFixed(2))}
            </span>
          </div>
        </div>

        {/* Additional charge */}
        <div className="mb-4 p-4 bg-amber-50/40 rounded-lg border border-amber-100">
          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={addlChargeOn}
              onChange={e => setAddlChargeOn(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-xs font-medium text-gray-700">Additional charge (transport, loading, etc.)</span>
          </label>

          {addlChargeOn && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Amount (₹) *</label>
                  <input
                    type="number"
                    value={addlCharge}
                    onChange={e => setAddlCharge(e.target.value)}
                    placeholder="0"
                    min="0"
                    step="0.01"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 cursor-pointer mt-6">
                    <input
                      type="checkbox"
                      checked={addlGstOn}
                      onChange={e => setAddlGstOn(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-xs text-gray-700">Apply GST to this charge</span>
                  </label>
                </div>
              </div>

              {addlGstOn && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">CGST %</label>
                    <input
                      type="number" value={addlCgstPct} onChange={e => setAddlCgstPct(e.target.value)}
                      placeholder="0" min="0" max="100" step="0.01"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
                    />
                    <div className="text-[11px] text-gray-400 mt-1">{formatINR(addlCgstAmt)}</div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">SGST %</label>
                    <input
                      type="number" value={addlSgstPct} onChange={e => setAddlSgstPct(e.target.value)}
                      placeholder="0" min="0" max="100" step="0.01"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
                    />
                    <div className="text-[11px] text-gray-400 mt-1">{formatINR(addlSgstAmt)}</div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">IGST %</label>
                    <input
                      type="number" value={addlIgstPct} onChange={e => setAddlIgstPct(e.target.value)}
                      placeholder="0" min="0" max="100" step="0.01"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
                    />
                    <div className="text-[11px] text-gray-400 mt-1">{formatINR(addlIgstAmt)}</div>
                  </div>
                </div>
              )}

              <div className="mb-1">
                <label className="block text-xs text-gray-500 mb-1">Reason *</label>
                <input
                  value={addlReason}
                  onChange={e => setAddlReason(e.target.value)}
                  placeholder="e.g. Transport, loading, packing, handling..."
                  maxLength={500}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
              </div>

              <div className="mt-2 pt-2 border-t border-amber-200 flex items-center justify-between">
                <span className="text-xs text-gray-600">Additional line total</span>
                <span className="text-sm font-medium text-amber-800">{formatINR(addlLineTotal)}</span>
              </div>
            </>
          )}
        </div>

        {/* Grand total */}
        <div className="mb-4 flex items-center justify-between px-4 py-3 bg-[#1a3c5e]/5 rounded-lg">
          <span className="text-sm font-medium text-gray-700">Total Invoice Amount</span>
          <span className="text-lg font-semibold text-[#1a3c5e]">{formatINR(totalAmount)}</span>
        </div>

        {/* Row 5: Remarks */}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Remarks</label>
          <textarea
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            placeholder="Notes..."
            rows={2}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
          />
        </div>

        {/* File upload area */}
        <div className="mb-5">
          <label className="block text-xs text-gray-500 mb-1">Invoice copies & supporting documents</label>
          <div
            onDragOver={(e: DragEvent) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={async (e: DragEvent) => {
              e.preventDefault();
              e.stopPropagation();
              const files = Array.from(e.dataTransfer.files);
              if (isEdit) {
                setUploading(true);
                try {
                  for (const file of files) await uploadAttachment(editInvoice!.id, file);
                  const fresh = await getAttachments(editInvoice!.id);
                  setExistingAttachments(fresh);
                  notify(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Upload failed');
                } finally { setUploading(false); }
              } else {
                setPendingFiles(prev => [...prev, ...files]);
                notify(`Added ${files.length} file${files.length > 1 ? 's' : ''} — will upload on save`);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-300 transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              multiple
              className="hidden"
              onChange={async (e: ChangeEvent<HTMLInputElement>) => {
                if (!e.target.files) return;
                const files = Array.from(e.target.files);
                e.target.value = '';
                if (isEdit) {
                  setUploading(true);
                  try {
                    for (const file of files) await uploadAttachment(editInvoice!.id, file);
                    const fresh = await getAttachments(editInvoice!.id);
                    setExistingAttachments(fresh);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Upload failed');
                  } finally { setUploading(false); }
                } else {
                  setPendingFiles(prev => [...prev, ...files]);
                }
              }}
            />
            <div className="text-gray-400 mb-1">
              <svg className="w-6 h-6 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            </div>
            <div className="text-sm text-gray-600 font-medium">Drag & drop or click to browse</div>
            <div className="text-xs text-gray-400 mt-1">PDF, JPG, PNG — max 10 MB each</div>
          </div>

          {/* Existing attachments (edit mode) */}
          {existingAttachments.length > 0 && (
            <div className="mt-3 space-y-2">
              {existingAttachments.map(att => {
                const fullUrl = att.url.startsWith('http') ? att.url : `${window.location.origin}${att.url}`;
                return (
                  <div key={att.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-red-500 text-sm">&#128196;</span>
                      <span className="text-sm font-medium text-gray-900 truncate">{att.file_name}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">{att.file_size ? `${Math.round(att.file_size / 1024)} KB` : ''}</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded">View</a>
                      <a href={`${fullUrl}${fullUrl.includes('?') ? '&' : '?'}download=1`} className="px-2 py-1 text-xs text-green-600 hover:bg-green-50 rounded">Download</a>
                      <button type="button" onClick={() => { navigator.clipboard.writeText(fullUrl); alert('Link copied'); }} className="px-2 py-1 text-xs text-purple-600 hover:bg-purple-50 rounded">Share</button>
                      <button type="button" onClick={async () => {
                        if (!confirm(`Delete ${att.file_name}?`)) return;
                        try {
                          await deleteAttachment(editInvoice!.id, att.id);
                          setExistingAttachments(prev => prev.filter(a => a.id !== att.id));
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed to delete');
                        }
                      }} className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded">Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pending files (to upload) */}
          {pendingFiles.length > 0 && (
            <div className="mt-3 space-y-2">
              {pendingFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 bg-blue-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-blue-500 text-sm">&#128196;</span>
                    <div>
                      <div className="text-sm font-medium text-gray-900">{f.name}</div>
                      <div className="text-xs text-gray-400">{Math.round(f.size / 1024)} KB</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                    className="text-red-400 hover:text-red-600 text-sm"
                  >&#10005;</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inline error right above the actions so it's never out of view */}
        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || uploading}
            className="px-5 py-2.5 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d] disabled:opacity-50"
          >
            {saving ? 'Saving...' : uploading ? 'Uploading files...' : 'Save Invoice'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
