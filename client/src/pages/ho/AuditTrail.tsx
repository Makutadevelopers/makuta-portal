import { useState, useEffect } from 'react';
import { getAuditLogs } from '../../api/audit';
import { AuditLog } from '../../types/audit';
import AppShell from '../../components/layout/AppShell';

export default function AuditTrail() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAuditLogs().then(setLogs).finally(() => setLoading(false));
  }, []);

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
    // Derive role hint from the action context
    if (name === 'Rajesh Kumar') return { label: 'Head Office', color: 'text-blue-600' };
    return { label: 'Site', color: 'text-green-600' };
  }

  function getAvatarColor(name: string): string {
    // Consistent color per user
    const colors = ['bg-blue-100 text-blue-700', 'bg-green-100 text-green-700', 'bg-purple-100 text-purple-700', 'bg-amber-100 text-amber-700'];
    let hash = 0;
    for (const c of name) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
    return colors[Math.abs(hash) % colors.length];
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
            return (
              <div key={log.id} className={`flex items-start gap-4 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 ${getAvatarColor(log.user_name)}`}>
                  {getInitials(log.user_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900">{log.action.replace(/_/g, ' ')}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    <span className={`font-medium ${badge.color}`}>{log.user_name}</span>
                    <span className="mx-1">·</span>
                    <span>{badge.label}</span>
                    <span className="mx-1">·</span>
                    <span>{fmtDate(log.created_at)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
