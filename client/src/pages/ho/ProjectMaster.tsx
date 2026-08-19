import { useState, useEffect, FormEvent } from 'react';
import AppShell from '../../components/layout/AppShell';
import { Site, listSites, createSite, updateSite } from '../../api/sites';
import { formatDate } from '../../utils/formatters';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../components/ui/ConfirmDialog';

// HO-only Project Master. Projects listed here drive the site dropdown in
// invoice, credit-note and petty-cash forms, and the site filters on every
// dashboard.
//
// Projects are never hard-deleted: invoices, credit notes, petty cash and user
// assignments all store the project NAME as text, so deleting a row would
// orphan those labels. Archiving retires a project from new dropdowns while
// every historical record keeps reading correctly.

function usageTotal(s: Site): number {
  if (!s.usage) return 0;
  return s.usage.invoices + s.usage.creditNotes + s.usage.pettyCash;
}

function usageSummary(s: Site): string {
  if (!s.usage) return '';
  const bits: string[] = [];
  if (s.usage.invoices) bits.push(`${s.usage.invoices.toLocaleString('en-IN')} invoice${s.usage.invoices === 1 ? '' : 's'}`);
  if (s.usage.creditNotes) bits.push(`${s.usage.creditNotes} credit note${s.usage.creditNotes === 1 ? '' : 's'}`);
  if (s.usage.pettyCash) bits.push(`${s.usage.pettyCash} petty-cash record${s.usage.pettyCash === 1 ? '' : 's'}`);
  if (s.usage.users) bits.push(`${s.usage.users} user${s.usage.users === 1 ? '' : 's'}`);
  return bits.join(', ');
}

export default function ProjectMaster() {
  const { notify } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [sites, setSites] = useState<Site[]>([]);
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
      const rows = await listSites({ includeInactive: true });
      setSites(rows);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load projects', 'error');
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
      const created = await createSite(name);
      if (created.reactivated) notify(`Reactivated "${created.name}"`);
      else if (created.alreadyExisted) notify(`"${created.name}" already exists`);
      else notify(`Added project "${created.name}"`);
      setDraftName('');
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to add project', 'error');
    } finally {
      setAdding(false);
    }
  }

  async function handleToggleActive(s: Site) {
    if (s.active) {
      const total = usageTotal(s);
      const detail = total > 0
        ? `This project still has ${usageSummary(s)}. That data stays exactly as it is and dashboards keep showing it — archiving only removes "${s.name}" from the dropdowns for new entries.`
        : `"${s.name}" has no records against it yet. It will disappear from the dropdowns for new entries.`;
      const ok = await confirm({
        title: `Archive "${s.name}"?`,
        message: `${detail} You can reactivate it any time.`,
        confirmLabel: 'Archive',
        variant: 'warning',
      });
      if (!ok) return;
    }
    setSavingId(s.id);
    try {
      // The counts came from this same listing, and the confirm above showed
      // them, so the server's safety-net 409 would be redundant here.
      await updateSite(s.id, { active: !s.active, confirmArchiveWithData: true });
      notify(s.active ? `Archived "${s.name}"` : `Reactivated "${s.name}"`);
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Update failed', 'error');
    } finally {
      setSavingId(null);
    }
  }

  function startEdit(s: Site) {
    setEditingId(s.id);
    setEditName(s.name);
  }

  async function commitEdit(s: Site) {
    const next = editName.trim();
    if (!next || next === s.name) {
      setEditingId(null);
      return;
    }

    // A rename rewrites every record carrying the old name, so say exactly
    // what will move before doing it rather than after.
    const total = usageTotal(s);
    if (total > 0 || s.usage?.users) {
      const ok = await confirm({
        title: `Rename "${s.name}" to "${next}"?`,
        message: `This updates ${usageSummary(s)} to the new name, all in one step. Nothing is deleted and the change is recorded in the audit trail, so it can be reversed by renaming back.`,
        confirmLabel: 'Rename everywhere',
        variant: 'warning',
      });
      if (!ok) return;
    }

    setSavingId(s.id);
    try {
      const updated = await updateSite(s.id, { name: next });
      const moved = updated.moved
        ? Object.values(updated.moved).reduce((a, b) => a + b, 0)
        : 0;
      notify(moved > 0
        ? `Renamed "${s.name}" → "${next}" (${moved.toLocaleString('en-IN')} records updated)`
        : `Renamed "${s.name}" → "${next}"`);
      setEditingId(null);
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Rename failed', 'error');
    } finally {
      setSavingId(null);
    }
  }

  const filtered = search
    ? sites.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : sites;
  const activeCount = sites.filter(s => s.active).length;
  const archivedCount = sites.length - activeCount;

  return (
    <AppShell>
      {confirmDialog}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Project Master</div>
          <div className="text-xs text-gray-500 mt-1">
            Projects listed here populate the site dropdown in invoice, credit-note and petty-cash forms. Archive a project to retire it without affecting historical records.
          </div>
        </div>
      </div>

      <form onSubmit={handleAdd} className="mb-4 flex items-center gap-2 flex-wrap">
        <input
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          placeholder="New project name (e.g. Sky Villas)"
          maxLength={100}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <button
          type="submit"
          disabled={adding || !draftName.trim()}
          className="px-4 py-2 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {adding ? 'Adding…' : '+ Add Project'}
        </button>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search projects…"
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-56 ml-auto focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </form>

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        <div className="px-4 py-2 border-b border-gray-50 bg-gray-50 text-xs text-gray-500 flex items-center gap-4">
          <span>{activeCount} active</span>
          {archivedCount > 0 && <span className="text-gray-400">{archivedCount} archived</span>}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="px-4 py-2.5 font-medium">Project</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium text-right">Invoices</th>
              <th className="px-4 py-2.5 font-medium text-right">Users</th>
              <th className="px-4 py-2.5 font-medium">Added</th>
              <th className="px-4 py-2.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">{search ? 'No projects match your search.' : 'No projects yet. Add one above.'}</td></tr>
            ) : filtered.map(s => (
              <tr key={s.id} className={`border-t border-gray-50 hover:bg-gray-50/50 ${!s.active ? 'opacity-60' : ''}`}>
                <td className="px-4 py-3">
                  {editingId === s.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); commitEdit(s); }
                          if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
                        }}
                        maxLength={100}
                        className="px-2 py-1 border border-blue-300 rounded text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                      <button onClick={() => commitEdit(s)} disabled={savingId === s.id} className="text-xs font-medium text-[#1a3c5e] hover:underline disabled:opacity-50">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                    </div>
                  ) : (
                    <span className="font-medium text-gray-900">{s.name}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {s.active ? 'Active' : 'Archived'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-gray-600 tabular-nums">
                  {s.usage ? s.usage.invoices.toLocaleString('en-IN') : '—'}
                </td>
                <td className="px-4 py-3 text-right text-gray-600 tabular-nums">
                  {s.usage ? s.usage.users || '—' : '—'}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(s.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  {editingId === s.id ? null : (
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => startEdit(s)} disabled={savingId === s.id} className="text-xs text-gray-600 hover:text-gray-900 hover:underline disabled:opacity-50">Rename</button>
                      <button onClick={() => handleToggleActive(s)} disabled={savingId === s.id} className={`text-xs hover:underline disabled:opacity-50 ${s.active ? 'text-orange-600' : 'text-green-600'}`}>
                        {savingId === s.id ? '…' : s.active ? 'Archive' : 'Reactivate'}
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
