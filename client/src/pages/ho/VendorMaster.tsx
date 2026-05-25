import { useState, FormEvent, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useVendors } from '../../hooks/useVendors';
import { useInvoices } from '../../hooks/useInvoices';
import { useAuth } from '../../hooks/useAuth';
import {
  createVendor, updateVendor, getSimilarVendors,
  mergeVendors as mergeVendorsApi,
} from '../../api/vendors';
import { formatINR } from '../../utils/formatters';
import CategorySelect from '../../components/shared/CategorySelect';
import { Vendor } from '../../types/vendor';
import AppShell from '../../components/layout/AppShell';
import BulkImportModal from '../../components/shared/BulkImportModal';
import { useToast } from '../../context/ToastContext';
import { highlight } from '../../utils/searchHighlight';
import { useStickyHeaderHeight } from '../../hooks/useStickyHeaderHeight';

const TERM_OPTIONS = [7, 10, 14, 15, 21, 30, 45, 60, 75, 90];

export default function VendorMaster() {
  const { vendors, loading, refresh } = useVendors();
  const { invoices, refresh: refreshInvoices } = useInvoices();
  const { user } = useAuth();
  const isSite = user?.role === 'site';
  const canManage = (v: Vendor) => !isSite || v.created_by === user?.id;
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const { ref: stickyHeaderRef, height: stickyHeaderHeight } = useStickyHeaderHeight();
  // showForm renders the form above the table — used only for "+ Add Vendor"
  // and the unmastered-vendor quick-add buttons. Row-level Edit uses
  // expandedEditId so the form opens inline below the clicked row.
  const [showForm, setShowForm] = useState(false);
  const [expandedEditId, setExpandedEditId] = useState<string | null>(null);
  const [initialName, setInitialName] = useState('');
  const [showUnmastered, setShowUnmastered] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [editingTermsId, setEditingTermsId] = useState<string | null>(null);
  const [savingTermsId, setSavingTermsId] = useState<string | null>(null);
  const [mergeFrom, setMergeFrom] = useState<Vendor | null>(null);
  const { notify } = useToast();

  async function handleQuickTermsChange(v: Vendor, newTerms: number) {
    if (newTerms === v.payment_terms) {
      setEditingTermsId(null);
      return;
    }
    setSavingTermsId(v.id);
    try {
      await updateVendor(v.id, { payment_terms: newTerms });
      notify(`${v.name}: ${newTerms} day terms`);
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update terms', 'error');
    } finally {
      setSavingTermsId(null);
      setEditingTermsId(null);
    }
  }

  // Invoice count and outstanding per vendor. We resolve each invoice to a
  // master vendor by vendor_id first (stable across renames/merges); for the
  // many legacy rows that were never linked (vendor_id NULL) we fall back to
  // matching the denormalised vendor_name (case-insensitive) — otherwise those
  // invoices would never aggregate into any master and every such vendor would
  // read "—". Outstanding sums the actual balance (invoice_amount − payments),
  // not invoice_amount, so Partial invoices aren't double-counted. Invoices
  // that match no master at all are "unmastered" and surfaced in the banner.
  const vendorIdByName = new Map<string, string>();
  for (const v of vendors) vendorIdByName.set(v.name.toLowerCase().trim(), v.id);
  const knownVendorIds = new Set(vendors.map(v => v.id));

  const vendorStats = new Map<string, number>();
  const vendorInvoiceCount = new Map<string, number>();
  for (const inv of invoices) {
    let vid = inv.vendor_id && knownVendorIds.has(inv.vendor_id) ? inv.vendor_id : undefined;
    if (!vid) vid = vendorIdByName.get((inv.vendor_name ?? '').toLowerCase().trim());
    if (!vid) continue;
    vendorInvoiceCount.set(vid, (vendorInvoiceCount.get(vid) ?? 0) + 1);
    const bal = Number(inv.balance ?? 0);
    if (bal > 0) {
      vendorStats.set(vid, (vendorStats.get(vid) ?? 0) + bal);
    }
  }

  const filtered = vendors.filter(v =>
    (!search || v.name.toLowerCase().includes(search.toLowerCase())) &&
    (!categoryFilter || v.category === categoryFilter)
  );

  // An invoice is "mastered" if either
  //   (a) it has a vendor_id pointing to an existing master row, OR
  //   (b) its denormalized vendor_name matches a master name (case-insensitive).
  // Without (a), merges that re-point vendor_id but don't rewrite the legacy
  // vendor_name text would incorrectly resurface the old name in this banner.
  const vendorNames = new Set(vendors.map(v => v.name.toLowerCase()));
  const unmasteredVendors = Array.from(new Set(
    invoices
      .filter(i => !(i.vendor_id && knownVendorIds.has(i.vendor_id)))
      .map(i => i.vendor_name)
      .filter(name => !vendorNames.has(name.toLowerCase()))
  ));

  // 30 days is the default for every vendor, so a yellow pill on every row
  // communicated nothing. Only outliers get colour now; the default reads as
  // quiet neutral text and the eye lands on the rows that need attention.
  function termsBadgeColor(days: number): string {
    if (days < 15) return 'bg-red-50 text-red-700 border-red-200';
    if (days < 30) return 'bg-amber-50 text-amber-700 border-amber-200';
    if (days > 45) return 'bg-green-50 text-green-700 border-green-200';
    if (days > 30) return 'bg-blue-50 text-blue-700 border-blue-200';
    return 'bg-gray-50 text-gray-600 border-gray-200';
  }

  return (
    <AppShell>
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-30 bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 -mt-4 sm:-mt-6 pt-4 sm:pt-6 pb-1 mb-4"
      >
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Vendor Master</div>
          <div className="text-xs text-gray-500 mt-1">Set payment terms per vendor — used to calculate due dates in Payment Aging</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(true)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Bulk Import
          </button>
          <button onClick={() => { setExpandedEditId(null); setInitialName(''); setShowForm(true); }}
            className="px-4 py-2 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d]">
            + Add Vendor
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-0">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendors..."
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        <CategorySelect
          value={categoryFilter || 'All'}
          onChange={v => setCategoryFilter(v === 'All' ? '' : v)}
          includeAll
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} vendors in master</span>
      </div>
      </div>

      {showImport && (
        <BulkImportModal
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); refresh(); }}
        />
      )}

      {/* Unmastered vendor alert */}
      {unmasteredVendors.length > 0 && !showForm && showUnmastered && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg relative">
          <button onClick={() => setShowUnmastered(false)} className="absolute top-2 right-2 text-amber-400 hover:text-amber-600 text-lg leading-none" title="Dismiss">&#10005;</button>
          <div className="text-xs text-amber-800 pr-6">
            <strong>{unmasteredVendors.length}</strong> vendor{unmasteredVendors.length !== 1 ? 's' : ''} in invoices not yet in Vendor Master — defaulting to 30-day terms:
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {unmasteredVendors.map(uName => (
              <button key={uName} onClick={() => { setExpandedEditId(null); setInitialName(uName); setShowForm(true); }}
                className="text-xs px-2.5 py-1 bg-white border border-amber-300 rounded-md text-amber-800 hover:bg-amber-100">
                + {uName}
              </button>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <VendorForm
          key={`new-${initialName}`}
          vendor={null}
          initialName={initialName}
          onCancel={() => { setShowForm(false); setInitialName(''); }}
          onSaved={meta => {
            setShowForm(false);
            setInitialName('');
            const recat = meta?.invoicesRecategorised ?? 0;
            notify(recat > 0 ? `Vendor added · ${recat} invoice${recat === 1 ? '' : 's'} recategorised` : 'Vendor added');
            refresh();
          }}
          onMerged={() => { setShowForm(false); setInitialName(''); notify('Vendors merged'); refresh(); refreshInvoices(); }}
        />
      )}

      {mergeFrom && (
        <MergeIntoModal
          removeVendor={mergeFrom}
          allVendors={vendors}
          onClose={() => setMergeFrom(null)}
          onMerged={(removedName, keptName, collapsedDuplicates) => {
            setMergeFrom(null);
            const suffix = collapsedDuplicates > 0
              ? ` · ${collapsedDuplicates} duplicate invoice${collapsedDuplicates === 1 ? '' : 's'} collapsed`
              : '';
            notify(`Merged "${removedName}" into "${keptName}"${suffix}`);
            refresh();
            refreshInvoices();
          }}
          onError={msg => notify(msg, 'error')}
        />
      )}

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : (
        <div
          className="bg-white rounded-xl border border-gray-100 overflow-y-auto overflow-x-hidden"
          style={{ maxHeight: `calc(100vh - ${stickyHeaderHeight + 120}px)` }}
        >
          <table className="w-full table-fixed text-[13px]">
            {/* Fixed proportional widths (sum 100%) so the table never exceeds
                the container width — no horizontal scroll. Text columns truncate. */}
            <colgroup>
              <col style={{ width: '30%' }} />{/* Vendor Name */}
              <col style={{ width: '22%' }} />{/* Category */}
              <col style={{ width: '12%' }} />{/* Terms */}
              <col style={{ width: '10%' }} />{/* Invoices */}
              <col style={{ width: '12%' }} />{/* Outstanding */}
              <col style={{ width: '14%' }} />{/* Actions */}
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                {['Vendor Name', 'Category', 'Terms', 'Invoices', 'Outstanding', ''].map(h => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 font-medium text-gray-500 bg-gray-50 sticky top-0 z-20 border-b border-gray-100 ${h === 'Terms' ? 'text-center' : h === 'Invoices' || h === 'Outstanding' ? 'text-right' : 'text-left'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(v => {
                const outstanding = vendorStats.get(v.id);
                const invoiceCount = vendorInvoiceCount.get(v.id) ?? 0;
                const isExpanded = expandedEditId === v.id;
                return (
                  <Fragment key={v.id}>
                    <tr className={`border-t border-gray-50 hover:bg-gray-50/50 ${isExpanded ? 'bg-blue-50/40' : ''}`}>
                      <td className="px-4 py-3 truncate">
                        <Link to={`/vendors/${v.id}`} className="font-medium text-blue-700 hover:underline">{highlight(v.name, search)}</Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600 truncate">{v.category ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-center">
                        {editingTermsId === v.id && canManage(v) ? (
                          <select
                            autoFocus
                            defaultValue={v.payment_terms}
                            disabled={savingTermsId === v.id}
                            onBlur={() => setEditingTermsId(null)}
                            onChange={e => handleQuickTermsChange(v, Number(e.target.value))}
                            className="px-2 py-1 border border-blue-300 rounded-md text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                          >
                            {TERM_OPTIONS.map(t => <option key={t} value={t}>{t} days</option>)}
                            {!TERM_OPTIONS.includes(v.payment_terms) && (
                              <option value={v.payment_terms}>{v.payment_terms} days (current)</option>
                            )}
                          </select>
                        ) : (
                          <button
                            type="button"
                            onClick={() => canManage(v) && setEditingTermsId(v.id)}
                            disabled={!canManage(v)}
                            title={canManage(v) ? 'Click to change' : ''}
                            className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium border ${termsBadgeColor(v.payment_terms)} ${canManage(v) ? 'cursor-pointer hover:ring-2 hover:ring-blue-200' : 'cursor-default'}`}
                          >
                            {v.payment_terms} days
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {invoiceCount > 0 ? invoiceCount : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {outstanding && outstanding > 0
                          ? <span className="font-medium text-red-600">{formatINR(outstanding)}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {/* Edit is the primary row action; Merge is secondary.
                            Vendors are never deleted from here — consolidate
                            duplicates via Merge instead. */}
                        <div className="flex items-center gap-1">
                          {canManage(v) && (
                            <button
                              onClick={() => { setShowForm(false); setExpandedEditId(isExpanded ? null : v.id); }}
                              className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                            >
                              {isExpanded ? 'Close' : 'Edit'}
                            </button>
                          )}
                          <button
                            onClick={() => setMergeFrom(v)}
                            className="rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                            title="Merge this vendor into another (this row will be removed; can be reverted)"
                          >
                            Merge
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-blue-100 bg-blue-50/30">
                        <td colSpan={6} className="px-2 py-4">
                          <VendorForm
                            key={`edit-${v.id}`}
                            vendor={v}
                            onCancel={() => setExpandedEditId(null)}
                            onSaved={meta => {
                              setExpandedEditId(null);
                              const recat = meta?.invoicesRecategorised ?? 0;
                              notify(recat > 0 ? `Vendor updated · ${recat} invoice${recat === 1 ? '' : 's'} recategorised` : 'Vendor updated');
                              refresh();
                            }}
                            onMerged={() => { setExpandedEditId(null); notify('Vendors merged'); refresh(); refreshInvoices(); }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">No vendors found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

// ── Vendor Form ─────────────────────────────────────────────────────────────
function VendorForm({ vendor, initialName, onCancel, onSaved, onMerged }: {
  // onSaved gets the count of invoices whose category was rewritten as a
  // side-effect of editing the vendor's category — empty for create, often
  // 0 for edits that didn't move category. Parent decides whether to
  // surface that in the toast.

  vendor: Vendor | null;
  initialName?: string;
  onCancel: () => void;
  onSaved: (meta?: { invoicesRecategorised?: number }) => void;
  onMerged: () => void;
}) {
  const isEdit = !!vendor;
  const [name, setName] = useState(vendor?.name ?? initialName ?? '');
  const [terms, setTerms] = useState(String(vendor?.payment_terms ?? 30));
  const [customTerms, setCustomTerms] = useState(false);
  const [category, setCategory] = useState(vendor?.category ?? '');
  const [gstin, setGstin] = useState(vendor?.gstin ?? '');
  const [contactName, setContactName] = useState(vendor?.contact_name ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [email, setEmail] = useState(vendor?.email ?? '');
  const [notes, setNotes] = useState(vendor?.notes ?? '');
  const [invoiceNoOptional, setInvoiceNoOptional] = useState(vendor?.invoice_no_optional ?? false);
  const [invoiceNoReason, setInvoiceNoReason] = useState(vendor?.invoice_no_optional_reason ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [similarVendors, setSimilarVendors] = useState<{ id: string; name: string; similarity: string }[]>([]);
  const [merging, setMerging] = useState(false);

  async function handleNameBlur() {
    const trimmed = name.trim();
    if (!trimmed || isEdit) {
      setSimilarVendors([]);
      return;
    }
    try {
      const matches = await getSimilarVendors(trimmed);
      setSimilarVendors(matches);
    } catch {
      setSimilarVendors([]);
    }
  }

  async function handleMerge(_keepId: string) {
    // In the add-new-vendor flow, "Yes, use existing" means the user acknowledges
    // the similar vendor already exists, so we skip creation and close the form.
    setMerging(true);
    try {
      onMerged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setMerging(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Vendor name is required'); return; }
    if (invoiceNoOptional && !invoiceNoReason.trim()) {
      setError('A reason is required when the invoice number is made optional');
      return;
    }

    const data = {
      name: name.trim(),
      payment_terms: Number(terms) || 30,
      category: category || null,
      gstin: gstin.trim() || null,
      contact_name: contactName.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      notes: notes.trim() || null,
      invoice_no_optional: invoiceNoOptional,
      invoice_no_optional_reason: invoiceNoOptional ? invoiceNoReason.trim() : null,
    };

    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        const res = await updateVendor(vendor.id, data);
        onSaved({ invoicesRecategorised: res.invoicesRecategorised });
      } else {
        await createVendor(data);
        onSaved();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
      <div className="text-base font-medium text-gray-900 mb-5">{isEdit ? 'Edit Vendor' : 'Add New Vendor'}</div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Vendor Name *</label>
            <input value={name} onChange={e => { setName(e.target.value); setSimilarVendors([]); }} onBlur={handleNameBlur} placeholder="Company name"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            {similarVendors.length > 0 && !isEdit && (
              <div className="mt-2 space-y-1.5">
                {similarVendors.map(sv => (
                  <div key={sv.id} className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                    <span className="flex-1">
                      Similar vendor found: &quot;{sv.name}&quot; — Is this the same vendor?
                    </span>
                    <button type="button" disabled={merging} onClick={() => handleMerge(sv.id)}
                      className="px-2 py-1 bg-amber-600 text-white rounded text-xs hover:bg-amber-700 disabled:opacity-50">
                      Yes, use existing
                    </button>
                    <button type="button" onClick={() => setSimilarVendors(prev => prev.filter(s => s.id !== sv.id))}
                      className="px-2 py-1 bg-white border border-amber-300 rounded text-xs hover:bg-amber-100">
                      No, keep separate
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Payment Terms (days)</label>
            {customTerms ? (
              <div className="flex gap-2">
                <input type="number" value={terms} onChange={e => setTerms(e.target.value)} min="1" max="365"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                <button type="button" onClick={() => setCustomTerms(false)} className="text-xs text-blue-600 whitespace-nowrap">Presets</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select value={terms} onChange={e => setTerms(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white">
                  {TERM_OPTIONS.map(t => <option key={t} value={t}>{t} days</option>)}
                </select>
                <button type="button" onClick={() => setCustomTerms(true)} className="text-xs text-blue-600 whitespace-nowrap">Custom</button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <CategorySelect
              value={category}
              onChange={setCategory}
              placeholder="Select category"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">GSTIN</label>
            <input value={gstin} onChange={e => setGstin(e.target.value)} placeholder="e.g. 29AABCS1429B1ZB"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Contact Person</label>
            <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Name"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Phone</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="9848012345"
              inputMode="tel"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="billing@vendor.com"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
        </div>

        <div className="mb-4 p-3 bg-gray-50 border border-gray-100 rounded-lg">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={invoiceNoOptional}
              onChange={e => setInvoiceNoOptional(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#1a3c5e] focus:ring-blue-200" />
            <span className="text-sm text-gray-700">
              Invoice number not required for this vendor
              <span className="block text-xs text-gray-500">
                For vendors that don't issue an invoice number (e.g. bank charges, refunds).
              </span>
            </span>
          </label>
          {invoiceNoOptional && (
            <div className="mt-3">
              <label className="block text-xs text-gray-500 mb-1">Reason *</label>
              <input value={invoiceNoReason} onChange={e => setInvoiceNoReason(e.target.value)}
                placeholder="Why this vendor has no invoice number"
                maxLength={300}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving}
            className="px-5 py-2.5 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d] disabled:opacity-50">
            {saving ? 'Saving...' : isEdit ? 'Update Vendor' : 'Add Vendor'}
          </button>
          <button type="button" onClick={onCancel} className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
        </div>
      </form>
    </div>
  );
}

// ── Merge-into modal ────────────────────────────────────────────────────────
function MergeIntoModal({
  removeVendor, allVendors, onClose, onMerged, onError,
}: {
  removeVendor: Vendor;
  allVendors: Vendor[];
  onClose: () => void;
  onMerged: (removedName: string, keptName: string, collapsedDuplicates: number) => void;
  onError: (msg: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [keepId, setKeepId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const candidates = allVendors
    .filter(v => v.id !== removeVendor.id)
    .filter(v => !search || v.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 30);

  async function handleConfirm() {
    if (!keepId) return;
    const keepVendor = allVendors.find(v => v.id === keepId);
    if (!keepVendor) return;
    setSubmitting(true);
    try {
      const res = await mergeVendorsApi(keepId, removeVendor.id);
      onMerged(removeVendor.name, keepVendor.name, res.collapsedDuplicates);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-lg max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-base font-medium text-gray-900">Merge vendor</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&#10005;</button>
        </div>
        <div className="text-xs text-gray-600 mb-4">
          All invoices for <strong>{removeVendor.name}</strong> will be re-pointed to the vendor you pick below, and <strong>{removeVendor.name}</strong> will be removed from Vendor Master. You can revert this from the Audit Trail.
        </div>

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search for the vendor to keep…"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-200"
          autoFocus
        />

        <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100 mb-4">
          {candidates.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-gray-400">No matching vendors</div>
          ) : candidates.map(v => (
            <button
              key={v.id}
              type="button"
              onClick={() => setKeepId(v.id)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${keepId === v.id ? 'bg-blue-50' : ''}`}
            >
              <div className="font-medium text-gray-900">{v.name}</div>
              <div className="text-[11px] text-gray-500">
                {v.category ?? 'Uncategorised'} · {v.payment_terms} day terms
              </div>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!keepId || submitting}
            className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50"
          >
            {submitting ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
