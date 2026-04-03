import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getAuditLogs } from '../../api/audit';
import { AuditLog } from '../../types/audit';
import { Link } from 'react-router-dom';

export default function AuditTrail() {
  const { user, logout } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAuditLogs().then(setLogs).finally(() => setLoading(false));
  }, []);

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Audit Trail</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.name}</span>
          <button onClick={logout} className="text-sm text-red-600 hover:underline">Logout</button>
        </div>
      </header>

      <nav className="bg-white border-b px-6 py-2 flex gap-4 text-sm">
        <Link to="/dashboard" className="hover:text-blue-600">Dashboard</Link>
        <Link to="/invoices" className="hover:text-blue-600">Invoices</Link>
        <Link to="/payment-aging" className="hover:text-blue-600">Payment Aging</Link>
        <Link to="/cashflow" className="hover:text-blue-600">Cashflow</Link>
        <Link to="/vendors" className="hover:text-blue-600">Vendors</Link>
        <Link to="/audit" className="font-semibold text-blue-600">Audit Trail</Link>
      </nav>

      <main className="p-6">
        {loading ? <p className="text-gray-500">Loading...</p> : (
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">User</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(log.created_at)}</td>
                    <td className="px-3 py-2">{log.user_name}</td>
                    <td className="px-3 py-2">{log.action.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                      {log.metadata ? JSON.stringify(log.metadata) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
