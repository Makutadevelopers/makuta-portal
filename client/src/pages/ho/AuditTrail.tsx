import { useState, useEffect } from 'react';
import { getAuditLogs, undoBatchImport } from '../../api/audit';
import { AuditLog } from '../../types/audit';
import AppShell from '../../components/layout/AppShell';

export default function AuditTrail() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmBatchId, setConfirmBatchId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);

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

  return (
    <AppShell>
      <div className="mb-6">
        <div className="text-lg font-medium text-gray-900">Audit Trail — All Users</div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="text-gray-400 text-sm py-12 text-center">No audit entries yet.</div>
      ) : (
        <div className="space-y-0">
          {logs.map((log, i) => {
            const badge = getRoleBadge(log.user_name);
            const batchId = isBulkImport(log);
            return (
              <div key={log.id} className={`flex items-start gap-4 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 ${getAvatarColor(log.user_name)}`}>
                  {getInitials(log.user_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900">{log.action.replace(/_/g, ' ')}</div>
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
