import { useState, useEffect, useMemo } from 'react';
import { getAuditLogs, undoBatchImport } from '../../api/audit';
import { AuditLog } from '../../types/audit';
import AppShell from '../../components/layout/AppShell';
import { SITES } from '../../utils/constants';

export default function AuditTrail() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmBatchId, setConfirmBatchId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);

  // Filters
  const [fSite, setFSite] = useState('All');
  const [fAction, setFAction] = useState('All');
  const [fInvoiceNo, setFInvoiceNo] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');

  // Substring matchers for the Action dropdown — kept simple (case-insensitive
  // prefix/contains) so we don't have to coordinate with every controller's wording.
  const actionMatchers: Record<string, (s: string) => boolean> = {
    All: () => true,
    Created: s => s.toLowerCase().startsWith('created invoice'),
    Updated: s => s.toLowerCase().startsWith('updated invoice'),
    Finalized: s => s.toLowerCase().startsWith('finalized invoice') || s.toLowerCase().startsWith('bulk finalized'),
    'Undo Finalize': s => s.toLowerCase().startsWith('reverted finalization'),
    Deleted: s => /^(moved|bulk moved|permanently deleted) /i.test(s),
    Restored: s => s.toLowerCase().startsWith('restored invoice'),
    Disputed: s => /^(disputed|cleared dispute)/i.test(s),
    Paid: s => /payment|paid/i.test(s),
    Imported: s => /import|imported/i.test(s),
  };
  const actionOptions = Object.keys(actionMatchers);

  function applyDatePreset(preset: 'today' | 'this-month' | 'last-month' | 'this-year' | 'clear') {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (preset === 'today') {
      const t = iso(now);
      setFDateFrom(t); setFDateTo(t);
    } else if (preset === 'this-month') {
      setFDateFrom(iso(new Date(y, m, 1)));
      setFDateTo(iso(new Date(y, m + 1, 0)));
    } else if (preset === 'last-month') {
      setFDateFrom(iso(new Date(y, m - 1, 1)));
      setFDateTo(iso(new Date(y, m, 0)));
    } else if (preset === 'this-year') {
      setFDateFrom(`${y}-01-01`);
      setFDateTo(`${y}-12-31`);
    } else {
      setFDateFrom(''); setFDateTo('');
    }
  }

  function loadLogs() {
    setLoading(true);
    getAuditLogs().then(setLogs).finally(() => setLoading(false));
  }

  useEffect(() => { loadLogs(); }, []);

  function fmtDate(d: string): string {
    return new Date(d).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  function getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  }

  function getRoleBadge(name: string): { label: string; color: string } {
    if (name === 'Rajesh Kumar') return { label: 'Head Office', color: 'text-blue-600' };
    return { label: 'Site', color: 'text-green-600' };
  }

  function getAvatarColor(name: string): string {
    const colors = ['bg-blue-100 text-blue-700', 'bg-green-100 text-green-700', 'bg-purple-100 text-purple-700', 'bg-amber-100 text-amber-700'];
    let hash = 0;
    for (const c of name) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
    return colors[Math.abs(hash) % colors.length];
  }

  function isBulkImport(log: AuditLog): string | null {
    const meta = log.metadata as Record<string, unknown> | null;
    if (meta && typeof meta.batchId === 'string') return meta.batchId;
    return null;
  }

  // Audit logs may carry an invoice_no on the metadata even when the FK
  // join is null (e.g. action = INVOICE_DELETED). Falling back keeps those
  // entries searchable by the number the user actually typed.
  function getLogInvoiceNo(log: AuditLog): string | null {
    if (log.invoice_no) return log.invoice_no;
    const meta = log.metadata as Record<string, unknown> | null;
    if (meta && typeof meta.invoiceNo === 'string') return meta.invoiceNo;
    if (meta && typeof meta.invoice_no === 'string') return meta.invoice_no;
    return null;
  }

  function getLogSite(log: AuditLog): string | null {
    if (log.invoice_site) return log.invoice_site;
    const meta = log.metadata as Record<string, unknown> | null;
    if (meta && typeof meta.site === 'string') return meta.site;
    return null;
  }

  const filtered = useMemo(() => {
    const matchAction = actionMatchers[fAction] ?? actionMatchers.All;
    return logs.filter(l => {
      if (fSite !== 'All') {
        const s = getLogSite(l);
        if (s !== fSite) return false;
      }
      if (!matchAction(l.action)) return false;
      if (fInvoiceNo.trim()) {
        const inv = getLogInvoiceNo(l) ?? '';
        if (!inv.toLowerCase().includes(fInvoiceNo.trim().toLowerCase())) return false;
      }
      if (fDateFrom || fDateTo) {
        const day = (l.created_at || '').slice(0, 10); // ISO YYYY-MM-DD
        if (fDateFrom && day < fDateFrom) return false;
        if (fDateTo && day > fDateTo) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, fSite, fAction, fInvoiceNo, fDateFrom, fDateTo]);

  // Per-site tally for the current filter — lets HO see at a glance how many
  // entries each site contributes (e.g. "Nirvana: 12 created invoices this month").
  const siteTally = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of filtered) {
      const s = getLogSite(l) ?? 'Unknown';
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  function clearFilters() {
    setFSite('All');
    setFAction('All');
    setFInvoiceNo('');
    setFDateFrom('');
    setFDateTo('');
  }

  async function handleUndo(batchId: string) {
    setUndoing(true);
    try {
      const result = await undoBatchImport(batchId);
      alert(result.message);
      setConfirmBatchId(null);
      loadLogs();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to undo import');
    } finally {
      setUndoing(false);
    }
  }

  const hasActiveFilters = fSite !== 'All' || fAction !== 'All' || !!fInvoiceNo.trim() || !!fDateFrom || !!fDateTo;

  return (
    <AppShell>
      <div className="mb-4">
        <div className="text-lg font-medium text-gray-900">Audit Trail — All Users</div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <select
          value={fSite}
          onChange={e => setFSite(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600"
        >
          <option value="All">All Sites</option>
          {SITES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={fAction}
          onChange={e => setFAction(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600"
          title="Filter by action type"
        >
          {actionOptions.map(a => (
            <option key={a} value={a}>{a === 'All' ? 'All Actions' : a}</option>
          ))}
        </select>
        <input
          value={fInvoiceNo}
          onChange={e => setFInvoiceNo(e.target.value)}
          placeholder="Invoice number…"
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">From</span>
          <input
            type="date"
            value={fDateFrom}
            onChange={e => setFDateFrom(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">To</span>
          <input
            type="date"
            value={fDateTo}
            onChange={e => setFDateTo(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} of {logs.length} entries</span>
      </div>

      {/* Date presets */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <span className="text-xs text-gray-500 mr-1">Quick range:</span>
        {[
          { key: 'today', label: 'Today' },
          { key: 'this-month', label: 'This Month' },
          { key: 'last-month', label: 'Last Month' },
          { key: 'this-year', label: 'This Year' },
          { key: 'clear', label: 'All Time' },
        ].map(p => (
          <button
            key={p.key}
            onClick={() => applyDatePreset(p.key as 'today' | 'this-month' | 'last-month' | 'this-year' | 'clear')}
            className="px-2.5 py-1 text-xs border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Per-site tally — only shown when more than one site is in the result, so HO
          can compare entry volume across sites at a glance. */}
      {!loading && filtered.length > 0 && siteTally.length > 1 && (
        <div className="mb-5 p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
            {fAction === 'All' ? 'Entries' : fAction} per site
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {siteTally.map(([site, count]) => (
              <div key={site} className="px-2.5 py-1 bg-white border border-gray-200 rounded-md text-xs">
                <span className="text-gray-600">{site}</span>
                <span className="ml-1.5 font-semibold text-gray-900">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-gray-400 text-sm py-12 text-center">
          {logs.length === 0 ? 'No audit entries yet.' : 'No entries match your filters.'}
        </div>
      ) : (
        <div className="space-y-0">
          {filtered.map((log, i) => {
            const badge = getRoleBadge(log.user_name);
            const batchId = isBulkImport(log);
            const invNo = getLogInvoiceNo(log);
            const site = getLogSite(log);
            return (
              <div key={log.id} className={`flex items-start gap-4 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 ${getAvatarColor(log.user_name)}`}>
                  {getInitials(log.user_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900">
                    {log.action.replace(/_/g, ' ')}
                    {invNo && (
                      <span className="ml-2 text-xs font-medium text-blue-700">#{invNo}</span>
                    )}
                    {site && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                        {site}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    <span className={`font-medium ${badge.color}`}>{log.user_name}</span>
                    <span className="mx-1">&middot;</span>
                    <span>{badge.label}</span>
                    <span className="mx-1">&middot;</span>
                    <span>{fmtDate(log.created_at)}</span>
                  </div>
                </div>

                {batchId && (
                  <div className="flex-shrink-0">
                    {confirmBatchId === batchId ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-600 font-medium">Delete this import?</span>
                        <button
                          onClick={() => handleUndo(batchId)}
                          disabled={undoing}
                          className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50"
                        >
                          {undoing ? 'Deleting...' : 'Yes, delete'}
                        </button>
                        <button
                          onClick={() => setConfirmBatchId(null)}
                          disabled={undoing}
                          className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmBatchId(batchId)}
                        className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
                      >
                        Undo Import
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
