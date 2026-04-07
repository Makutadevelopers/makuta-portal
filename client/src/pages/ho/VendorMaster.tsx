import { useState, FormEvent } from 'react';
import { useVendors } from '../../hooks/useVendors';
import { useInvoices } from '../../hooks/useInvoices';
import { createVendor, updateVendor, deleteVendor } from '../../api/vendors';
import { formatINR } from '../../utils/formatters';
import { PURPOSES } from '../../utils/constants';
import { Vendor } from '../../types/vendor';
import AppShell from '../../components/layout/AppShell';
import { useToast } from '../../context/ToastContext';

const TERM_OPTIONS = [7, 10, 14, 15, 21, 30, 45, 60, 75, 90];

export default function VendorMaster() {
  const { vendors, loading, refresh } = useVendors();
  const { invoices } = useInvoices();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const { notify } = useToast();

  const vendorStats = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.payment_status !== 'Paid') {
      vendorStats.set(inv.vendor_name, (vendorStats.get(inv.vendor_name) ?? 0) + Number(inv.invoice_amount));
    }
  }

  const filtered = vendors.filter(v => !search || v.name.toLowerCase().includes(search.toLowerCase()));

  // Find vendor names in invoices that aren't in vendor master
  const vendorNames = new Set(vendors.map(v => v.name.toLowerCase()));
  const unmasteredVendors = Array.from(new Set(
    invoices.map(i => i.vendor_name).filter(name => !vendorNames.has(name.toLowerCase()))
  ));

  function termsBadgeColor(days: number): string {
    if (days <= 15) return 'bg-red-50 text-red-700 border-red-200';
    if (days <= 30) return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    if (days <= 45) return 'bg-blue-50 text-blue-700 border-blue-200';
    return 'bg-green-50 text-green-700 border-green-200';
  }

  async function handleDelete(v: Vendor) {
    if (!confirm(`Delete vendor "${v.name}"? Invoices for this vendor will default to 30-day terms.`)) return;
    await deleteVendor(v.id);
    notify(`${v.name} removed`, 'error');
    refresh();
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Vendor Master</div>
          <div className="text-xs text-gray-500 mt-1">Set payment terms per vendor — used to calculate due dates in Payment Aging</div>
        </div>
        <button onClick={() => { setEditVendor(null); setShowForm(true); }}
          className="px-4 py-2 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d]">
          + Add Vendor
        </button>
      </div>

      {/* Unmastered vendor alert */}
      {unmasteredVendors.length > 0 && !showForm && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="text-xs text-amber-800">
            <strong>{unmasteredVendors.length}</strong> vendor{unmasteredVendors.length !== 1 ? 's' : ''} in invoices not yet in Vendor Master — defaulting to 30-day terms:
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {unmasteredVendors.map(name => (
              <button key={name} onClick={() => { setEditVendor(null); setShowForm(true); }}
                className="text-xs px-2.5 py-1 bg-white border border-amber-300 rounded-md text-amber-800 hover:bg-amber-100">
                + {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <VendorForm
          key={editVendor?.id ?? 'new'}
          vendor={editVendor}
          onCancel={() => { setShowForm(false); setEditVendor(null); }}
          onSaved={() => { setShowForm(false); setEditVendor(null); notify(editVendor ? 'Vendor updated' : 'Vendor added'); refresh(); }}
        />
      )}

      <div className="flex items-center gap-3 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendors..."
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} vendors in master</span>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50">
              <tr>
                {['Vendor Name', 'Category', 'Terms', 'GSTIN', 'Contact', 'Phone', 'Email', 'Notes', ''].map(h => (
                  <th key={h} className={`px-4 py-2.5 font-medium text-gray-500 ${h === 'Terms' ? 'text-center' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(v => {
                const outstanding = vendorStats.get(v.name);
                return (
                  <tr key={v.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{v.name}</div>
                      {outstanding && outstanding > 0 && (
                        <div className="text-[11px] text-red-500 mt-0.5">{formatINR(outstanding)} outstanding</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{v.category ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium border ${termsBadgeColor(v.payment_terms)}`}>
                        {v.payment_terms} days
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{v.gstin ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{v.contact_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{v.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{v.email ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-[140px] truncate" title={v.notes ?? ''}>{v.notes || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setEditVendor(v); setShowForm(true); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                        <button onClick={() => handleDelete(v)} className="text-xs text-red-500 hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">No vendors found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

// ── Vendor Form ─────────────────────────────────────────────────────────────
function VendorForm({ vendor, onCancel, onSaved }: {
  vendor: Vendor | null; onCancel: () => void; onSaved: () => void;
}) {
  const isEdit = !!vendor;
  const [name, setName] = useState(vendor?.name ?? '');
  const [terms, setTerms] = useState(String(vendor?.payment_terms ?? 30));
  const [customTerms, setCustomTerms] = useState(false);
  const [category, setCategory] = useState(vendor?.category ?? '');
  const [gstin, setGstin] = useState(vendor?.gstin ?? '');
  const [contactName, setContactName] = useState(vendor?.contact_name ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [email, setEmail] = useState(vendor?.email ?? '');
  const [notes, setNotes] = useState(vendor?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Vendor name is required'); return; }

    const data = {
      name: name.trim(),
      payment_terms: Number(terms) || 30,
      category: category || null,
      gstin: gstin.trim() || null,
      contact_name: contactName.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      notes: notes.trim() || null,
    };

    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await updateVendor(vendor.id, data);
      } else {
        await createVendor(data);
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
      <div className="text-base font-medium text-gray-900 mb-5">{isEdit ? 'Edit Vendor' : 'Add New Vendor'}</div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Vendor Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Company name"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
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
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="">Select category</option>
              {PURPOSES.map(p => <option key={p}>{p}</option>)}
            </select>
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
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="9848012345"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
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
