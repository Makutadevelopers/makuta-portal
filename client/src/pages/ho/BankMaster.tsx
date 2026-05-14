import { useState, useEffect, FormEvent } from 'react';
import AppShell from '../../components/layout/AppShell';
import { Bank, listBanks, createBank, updateBank } from '../../api/banks';
import { formatDate } from '../../utils/formatters';
import { useToast } from '../../context/ToastContext';

// HO-only Bank Master. Banks here drive the bank dropdown in payment
// forms across HO and site. Banks are never hard-deleted — the active
// flag retires them from new dropdowns while preserving the name on
// historical payments.
export default function BankMaster() {
  const { notify } = useToast();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [draftName, setDraftName] = useState('');
  const [adding, setAdding] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      const rows = await listBanks({ includeInactive: true });
      setBanks(rows);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load banks', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const name = draftName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const created = await createBank(name);
      if (created.reactivated) notify(`Reactivated "${created.name}"`);
      else if (created.alreadyExisted) notify(`"${created.name}" already exists`);
      else notify(`Added "${created.name}"`);
      setDraftName('');
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to add bank', 'error');
    } finally {
      setAdding(false);
    }
  }

  async function handleToggleActive(b: Bank) {
    const verb = b.active ? 'Deactivate' : 'Reactivate';
    if (b.active && !confirm(`Deactivate "${b.name}"? It will no longer appear in new payment dropdowns. Historical payments are unaffected and you can reactivate it any time.`)) return;
    setSavingId(b.id);
    try {
      await updateBank(b.id, { active: !b.active });
      notify(`${verb}d "${b.name}"`);
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : `${verb} failed`, 'error');
    } finally {
      setSavingId(null);
    }
  }

  function startEdit(b: Bank) {
    setEditingId(b.id);
    setEditName(b.name);
  }

  async function commitEdit(b: Bank) {
    const next = editName.trim();
    if (!next || next === b.name) {
      setEditingId(null);
      return;
    }
    setSavingId(b.id);
    try {
      await updateBank(b.id, { name: next });
      notify(`Renamed "${b.name}" → "${next}"`);
      setEditingId(null);
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Rename failed', 'error');
    } finally {
      setSavingId(null);
    }
  }

  const filtered = search
    ? banks.filter(b => b.name.toLowerCase().includes(search.toLowerCase()))
    : banks;
  const activeCount = banks.filter(b => b.active).length;
  const inactiveCount = banks.length - activeCount;

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Bank Master</div>
          <div className="text-xs text-gray-500 mt-1">
            Banks listed here populate the dropdown in payment forms. Deactivate a bank to retire it without affecting historical payments.
          </div>
        </div>
      </div>

      <form onSubmit={handleAdd} className="mb-4 flex items-center gap-2">
        <input
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          placeholder="New bank name (e.g. IDFC First)"
          maxLength={64}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <button
          type="submit"
          disabled={adding || !draftName.trim()}
          className="px-4 py-2 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {adding ? 'Adding…' : '+ Add Bank'}
        </button>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search banks…"
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-56 ml-auto focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </form>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-50 bg-gray-50 text-xs text-gray-500 flex items-center gap-4">
          <span>{activeCount} active</span>
          {inactiveCount > 0 && <span className="text-gray-400">{inactiveCount} inactive</span>}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Added</th>
              <th className="px-4 py-2.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">{search ? 'No banks match your search.' : 'No banks yet. Add one above.'}</td></tr>
            ) : filtered.map(b => (
              <tr key={b.id} className={`border-t border-gray-50 hover:bg-gray-50/50 ${!b.active ? 'opacity-60' : ''}`}>
                <td className="px-4 py-3">
                  {editingId === b.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); commitEdit(b); }
                          if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
                        }}
                        maxLength={64}
                        className="px-2 py-1 border border-blue-300 rounded text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                      <button onClick={() => commitEdit(b)} disabled={savingId === b.id} className="text-xs font-medium text-[#1a3c5e] hover:underline disabled:opacity-50">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                    </div>
                  ) : (
                    <span className="font-medium text-gray-900">{b.name}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${b.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {b.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(b.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  {editingId === b.id ? null : (
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => startEdit(b)} disabled={savingId === b.id} className="text-xs text-gray-600 hover:text-gray-900 hover:underline disabled:opacity-50">Rename</button>
                      <button onClick={() => handleToggleActive(b)} disabled={savingId === b.id} className={`text-xs hover:underline disabled:opacity-50 ${b.active ? 'text-orange-600' : 'text-green-600'}`}>
                        {savingId === b.id ? '…' : b.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
