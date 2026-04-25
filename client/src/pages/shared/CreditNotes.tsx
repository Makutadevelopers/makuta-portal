import { useState, useEffect, useCallback, FormEvent, useRef, Fragment } from 'react';
import AppShell from '../../components/layout/AppShell';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { getVendors } from '../../api/vendors';
import { getInvoices } from '../../api/invoices';
import {
  getCreditNotes,
  createCreditNote,
  deleteCreditNote,
  addAllocation,
  removeAllocation,
  uploadCreditNoteAttachment,
  getCreditNoteAttachments,
  deleteCreditNoteAttachment,
  CreditNoteAttachment,
} from '../../api/creditNotes';
import { Vendor } from '../../types/vendor';
import { Invoice } from '../../types/invoice';
import { CreditNote } from '../../types/creditNote';
import { formatINR, formatDate } from '../../utils/formatters';
import { SITES } from '../../utils/constants';

export default function CreditNotes() {
  const { user } = useAuth();
  const { notify } = useToast();
  const role = user?.role;
  const isSite = role === 'site';

  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cns, vs, invs] = await Promise.all([
        getCreditNotes(),
        getVendors(),
        getInvoices(),
      ]);
      setCreditNotes(cns);
      setVendors(vs);
      setInvoices(invs);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load credit notes');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(cn: CreditNote) {
    if (!confirm(`Delete credit note #${cn.cn_no}? Allocations will be reversed.`)) return;
    try {
      await deleteCreditNote(cn.id);
      notify('Credit note deleted');
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Credit Notes</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Record vendor credit notes for returns, rate corrections, and discounts
          </div>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ New Credit Note'}
        </button>
      </div>

      {showForm && (
        <CreditNoteForm
          vendors={vendors}
          invoices={invoices}
          defaultSite={user?.site ?? SITES[0]}
          isSite={isSite}
          onCancel={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : creditNotes.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 py-16 text-center">
          <div className="text-gray-300 text-4xl mb-3">&#128221;</div>
          <div className="text-gray-500 text-sm">No credit notes yet</div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50">
              <tr>
                {['CN Date', 'CN No', 'Vendor', 'Site', 'Total', 'Allocated', 'Unallocated', 'Remarks', 'Actions'].map((h) => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap ${
                      ['Total', 'Allocated', 'Unallocated'].includes(h) ? 'text-right' : 'text-left'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {creditNotes.map((cn) => {
                const allocated = Number(cn.total_amount) - Number(cn.unallocated_balance);
                const isExpanded = expandedId === cn.id;
                return (
                  <Fragment key={cn.id}>
                    <tr className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 whitespace-nowrap">{formatDate(cn.cn_date)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{cn.cn_no}</td>
                      <td className="px-4 py-3">{cn.vendor_name}</td>
                      <td className="px-4 py-3">{cn.site}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatINR(Number(cn.total_amount))}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{formatINR(allocated)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={Number(cn.unallocated_balance) > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'}>
                          {formatINR(Number(cn.unallocated_balance))}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate" title={cn.remarks ?? ''}>
                        {cn.remarks ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : cn.id)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {isExpanded ? 'Hide' : 'Details'}
                          </button>
                          {role === 'ho' && (
                            <button
                              onClick={() => handleDelete(cn)}
                              className="text-xs text-red-500 hover:underline"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-blue-50/40 border-t border-blue-100">
                        <td colSpan={9} className="px-4 py-4">
                          <CreditNoteDetail
                            cn={cn}
                            invoices={invoices.filter((i) => i.vendor_id === cn.vendor_id)}
                            canAllocate={role === 'ho' || isSite}
                            canUnallocate={role === 'ho'}
                            onChanged={load}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

// ── Form ────────────────────────────────────────────────────
function CreditNoteForm({
  vendors,
  invoices,
  defaultSite,
  isSite,
  onCancel,
  onSaved,
}: {
  vendors: Vendor[];
  invoices: Invoice[];
  defaultSite: string;
  isSite: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const today = new Date().toISOString().split('T')[0];

  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [cnNo, setCnNo] = useState('');
  const [cnDate, setCnDate] = useState(today);
  const [site, setSite] = useState(defaultSite);
  const [baseAmount, setBaseAmount] = useState('');
  const [cgstPct, setCgstPct] = useState('');
  const [sgstPct, setSgstPct] = useState('');
  const [igstPct, setIgstPct] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [allocMode, setAllocMode] = useState<'hold' | 'apply'>('hold');
  const [allocations, setAllocations] = useState<{ invoice_id: string; allocated_amount: string }[]>([]);

  const baseNum = Number(baseAmount) || 0;
  const cgstNum = Number(cgstPct) || 0;
  const sgstNum = Number(sgstPct) || 0;
  const igstNum = Number(igstPct) || 0;
  const cgstAmt = +((baseNum * cgstNum) / 100).toFixed(2);
  const sgstAmt = +((baseNum * sgstNum) / 100).toFixed(2);
  const igstAmt = +((baseNum * igstNum) / 100).toFixed(2);
  const totalAmount = +(baseNum + cgstAmt + sgstAmt + igstAmt).toFixed(2);

  const vendorInvoices = invoices.filter(
    (i) => i.vendor_id === vendorId && (!isSite || i.site === site) && (i.effective_payable ?? i.invoice_amount) > 0
  );

  function handleVendorSelect(id: string) {
    setVendorId(id);
    const v = vendors.find((x) => x.id === id);
    if (v) setVendorName(v.name);
  }

  function addAllocationRow() {
    setAllocations((a) => [...a, { invoice_id: '', allocated_amount: '' }]);
  }
  function updateAllocRow(idx: number, key: 'invoice_id' | 'allocated_amount', value: string) {
    setAllocations((a) => a.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  }
  function removeAllocRow(idx: number) {
    setAllocations((a) => a.filter((_, i) => i !== idx));
  }

  const allocSum = allocations.reduce((s, a) => s + (Number(a.allocated_amount) || 0), 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!vendorId) return setError('Please select a vendor');
    if (!cnNo.trim()) return setError('Credit note number is required');
    if (baseNum <= 0) return setError('Base amount must be > 0');
    if (totalAmount <= 0) return setError('Total must be > 0');

    let finalAllocations: { invoice_id: string; allocated_amount: number }[] = [];
    if (allocMode === 'apply') {
      for (const a of allocations) {
        if (!a.invoice_id) return setError('Pick an invoice for every allocation row');
        const amt = Number(a.allocated_amount);
        if (!(amt > 0)) return setError('Allocation amount must be > 0');
        finalAllocations.push({ invoice_id: a.invoice_id, allocated_amount: amt });
      }
      if (allocSum > totalAmount + 0.01) return setError('Allocations exceed credit note total');
    }

    setSaving(true);
    try {
      const cn = await createCreditNote({
        cn_no: cnNo.trim(),
        cn_date: cnDate,
        vendor_id: vendorId,
        vendor_name: vendorName,
        site,
        base_amount: baseNum,
        cgst_pct: cgstNum,
        sgst_pct: sgstNum,
        igst_pct: igstNum,
        total_amount: totalAmount,
        remarks: remarks.trim() || null,
        allocations: finalAllocations.length ? finalAllocations : undefined,
      });
      for (const f of pendingFiles) {
        await uploadCreditNoteAttachment(cn.id, f);
      }
      notify(`Credit note #${cn.cn_no} saved`);
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setError(msg);
      notify(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
      <div className="text-base font-medium text-gray-900 mb-5">New Credit Note</div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">CN Date</label>
            <input
              type="date"
              value={cnDate}
              onChange={(e) => setCnDate(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Site</label>
            <select
              value={site}
              onChange={(e) => setSite(e.target.value)}
              disabled={isSite}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50"
            >
              {SITES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">
            Vendor *
            {vendorId && <span className="text-green-600 ml-2">&#10003; {vendorName}</span>}
          </label>
          <div className="relative">
            <input
              value={vendorSearch}
              onChange={(e) => {
                setVendorSearch(e.target.value);
                if (!e.target.value) {
                  setVendorId('');
                  setVendorName('');
                }
              }}
              placeholder={vendorName || 'Type to search vendor...'}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            {vendorSearch && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {vendors
                  .filter((v) => v.name.toLowerCase().includes(vendorSearch.toLowerCase()))
                  .map((v) => (
                    <div
                      key={v.id}
                      onMouseDown={() => {
                        handleVendorSelect(v.id);
                        setVendorSearch('');
                      }}
                      className="px-3 py-2 hover:bg-blue-50 cursor-pointer"
                    >
                      <span className="text-sm text-gray-900">{v.name}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">CN No *</label>
            <input
              value={cnNo}
              onChange={(e) => setCnNo(e.target.value)}
              placeholder="Vendor's credit note number"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Base Amount (₹)</label>
            <input
              type="number"
              step="0.01"
              value={baseAmount}
              onChange={(e) => setBaseAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">CGST %</label>
            <input
              type="number"
              step="0.01"
              value={cgstPct}
              onChange={(e) => setCgstPct(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
            />
            <div className="text-[11px] text-gray-400 mt-1">₹{cgstAmt.toLocaleString('en-IN')}</div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">SGST %</label>
            <input
              type="number"
              step="0.01"
              value={sgstPct}
              onChange={(e) => setSgstPct(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
            />
            <div className="text-[11px] text-gray-400 mt-1">₹{sgstAmt.toLocaleString('en-IN')}</div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">IGST %</label>
            <input
              type="number"
              step="0.01"
              value={igstPct}
              onChange={(e) => setIgstPct(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
            />
            <div className="text-[11px] text-gray-400 mt-1">₹{igstAmt.toLocaleString('en-IN')}</div>
          </div>
        </div>

        <div className="mb-4 p-3 bg-gray-50 rounded-lg flex justify-between items-center">
          <span className="text-sm text-gray-500">Total credit</span>
          <span className="text-lg font-semibold text-gray-900">{formatINR(totalAmount)}</span>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Remarks</label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            placeholder="Reason: return of damaged goods / rate correction / discount..."
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
          />
        </div>

        {/* Allocation mode */}
        <div className="mb-4 border-t border-gray-100 pt-4">
          <div className="text-sm font-medium text-gray-700 mb-3">How should this credit be used?</div>
          <div className="flex gap-3">
            <label className={`flex-1 flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer text-sm ${allocMode === 'hold' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
              <input type="radio" checked={allocMode === 'hold'} onChange={() => setAllocMode('hold')} />
              Hold as vendor credit (apply later)
            </label>
            <label className={`flex-1 flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer text-sm ${allocMode === 'apply' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
              <input type="radio" checked={allocMode === 'apply'} onChange={() => setAllocMode('apply')} />
              Apply to specific invoice(s) now
            </label>
          </div>
        </div>

        {allocMode === 'apply' && (
          <div className="mb-4 p-3 border border-gray-200 rounded-lg">
            {!vendorId ? (
              <div className="text-xs text-gray-500">Select a vendor first to pick invoices</div>
            ) : vendorInvoices.length === 0 ? (
              <div className="text-xs text-gray-500">No open invoices found for this vendor{isSite ? ' at your site' : ''}.</div>
            ) : (
              <>
                {allocations.map((a, idx) => {
                  const inv = vendorInvoices.find((x) => x.id === a.invoice_id);
                  const maxAmt = inv ? Number(inv.effective_payable ?? inv.invoice_amount) : 0;
                  return (
                    <div key={idx} className="flex gap-2 mb-2 items-start">
                      <select
                        value={a.invoice_id}
                        onChange={(e) => updateAllocRow(idx, 'invoice_id', e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      >
                        <option value="">— pick invoice —</option>
                        {vendorInvoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            #{inv.invoice_no} · {formatDate(inv.invoice_date)} · payable {formatINR(Number(inv.effective_payable ?? inv.invoice_amount))}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        max={maxAmt}
                        value={a.allocated_amount}
                        onChange={(e) => updateAllocRow(idx, 'allocated_amount', e.target.value)}
                        placeholder="Amount"
                        className="w-36 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => removeAllocRow(idx)}
                        className="px-2 py-2 text-gray-400 hover:text-red-600"
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={addAllocationRow}
                  className="text-xs text-blue-600 hover:underline"
                >
                  + Add invoice
                </button>
                <div className="mt-3 text-xs text-gray-500">
                  Allocated so far: {formatINR(allocSum)} / {formatINR(totalAmount)}
                  {totalAmount > allocSum && (
                    <span className="ml-2 text-amber-600">
                      ({formatINR(totalAmount - allocSum)} will be held as vendor credit)
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Attachments */}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Attachments (vendor CN copy, proof of return, etc.)</label>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []))}
            className="text-sm"
          />
          {pendingFiles.length > 0 && (
            <div className="mt-2 text-xs text-gray-500">{pendingFiles.length} file(s) selected</div>
          )}
        </div>

        {/* Inline error right above the actions so it's never out of view */}
        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Credit Note'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Detail (allocations + attachments) ────────────────────
function CreditNoteDetail({
  cn,
  invoices,
  canAllocate,
  canUnallocate,
  onChanged,
}: {
  cn: CreditNote;
  invoices: Invoice[];
  canAllocate: boolean;
  canUnallocate: boolean;
  onChanged: () => void;
}) {
  const { notify } = useToast();
  const [attachments, setAttachments] = useState<CreditNoteAttachment[]>([]);
  const [newAllocInvoice, setNewAllocInvoice] = useState('');
  const [newAllocAmount, setNewAllocAmount] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAttachments = useCallback(async () => {
    try {
      setAttachments(await getCreditNoteAttachments(cn.id));
    } catch {
      /* ignore */
    }
  }, [cn.id]);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

  async function handleAddAllocation() {
    if (!newAllocInvoice) return notify('Pick an invoice');
    const amt = Number(newAllocAmount);
    if (!(amt > 0)) return notify('Amount must be > 0');
    try {
      await addAllocation(cn.id, { invoice_id: newAllocInvoice, allocated_amount: amt });
      notify('Allocation added');
      setNewAllocInvoice('');
      setNewAllocAmount('');
      onChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Allocation failed');
    }
  }

  async function handleRemoveAllocation(allocId: string) {
    if (!confirm('Remove this allocation?')) return;
    try {
      await removeAllocation(cn.id, allocId);
      notify('Allocation removed');
      onChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Remove failed');
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    for (const f of files) {
      try {
        await uploadCreditNoteAttachment(cn.id, f);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Upload failed');
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    loadAttachments();
  }

  async function handleDeleteAttachment(id: string, name: string) {
    if (!confirm(`Delete ${name}?`)) return;
    try {
      await deleteCreditNoteAttachment(cn.id, id);
      loadAttachments();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const openInvoices = invoices.filter((i) => (i.effective_payable ?? i.invoice_amount) > 0);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div>
        <div className="text-xs font-medium text-gray-600 mb-2">Allocations</div>
        {cn.allocations.length === 0 ? (
          <div className="text-xs text-gray-400 mb-2">No allocations yet — this is unallocated vendor credit.</div>
        ) : (
          <div className="space-y-1 mb-3">
            {cn.allocations.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-xs bg-white rounded px-2 py-1.5 border border-gray-100">
                <span className="text-gray-700">
                  #{a.invoice_no ?? a.invoice_id.slice(0, 8)} — {formatINR(Number(a.allocated_amount))}
                </span>
                {canUnallocate && (
                  <button onClick={() => handleRemoveAllocation(a.id)} className="text-red-500 hover:underline">
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {canAllocate && Number(cn.unallocated_balance) > 0 && (
          <div className="flex gap-2 mt-2 items-center">
            <select
              value={newAllocInvoice}
              onChange={(e) => setNewAllocInvoice(e.target.value)}
              className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs"
            >
              <option value="">— pick invoice —</option>
              {openInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  #{inv.invoice_no} · payable {formatINR(Number(inv.effective_payable ?? inv.invoice_amount))}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              value={newAllocAmount}
              onChange={(e) => setNewAllocAmount(e.target.value)}
              placeholder="Amount"
              className="w-28 px-2 py-1.5 border border-gray-200 rounded text-xs"
            />
            <button
              onClick={handleAddAllocation}
              className="px-2 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
            >
              Apply
            </button>
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-medium text-gray-600 mb-2">Attachments</div>
        {attachments.length === 0 && <div className="text-xs text-gray-400 mb-2">No files attached</div>}
        {attachments.map((att) => (
          <div key={att.id} className="flex items-center justify-between text-xs bg-white rounded px-2 py-1.5 border border-gray-100 mb-1">
            <a href={att.url} target="_blank" rel="noopener" className="text-blue-600 hover:underline truncate">
              {att.file_name}
            </a>
            <button onClick={() => handleDeleteAttachment(att.id, att.file_name)} className="text-red-500 hover:underline ml-2">
              Delete
            </button>
          </div>
        ))}
        <input ref={fileInputRef} type="file" multiple onChange={handleUpload} className="text-xs mt-2" />
      </div>
    </div>
  );
}
