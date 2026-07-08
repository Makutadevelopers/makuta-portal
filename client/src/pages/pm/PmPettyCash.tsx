// Read-only petty-cash view for project managers.
// Balances + combined ledger, scoped to the PM's assigned sites (enforced by
// the server). No "Give Petty Cash" / expense forms — PMs review, never write.

import { useEffect, useMemo, useState, useCallback } from 'react';
import AppShell from '../../components/layout/AppShell';
import { useAuth } from '../../hooks/useAuth';
import { formatINR, formatDate } from '../../utils/formatters';
import { getSiteBalance, getLedger } from '../../api/pettyCash';
import { PettyCashBalance, PettyCashLedgerEntry } from '../../types/pettyCash';
import { useToast } from '../../context/ToastContext';
import { useReloadOnFocus } from '../../hooks/useReloadOnFocus';

export default function PmPettyCash() {
  const { user } = useAuth();
  const { notify } = useToast();

  const userSites = useMemo(
    () => (user?.sites && user.sites.length > 0 ? user.sites : (user?.site ? [user.site] : [])),
    [user],
  );

  const [balances, setBalances] = useState<PettyCashBalance[]>([]);
  const [ledger, setLedger] = useState<PettyCashLedgerEntry[]>([]);
  const [filterSite, setFilterSite] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) setLoading(true);
    try {
      const [b, l] = await Promise.all([
        Promise.all(userSites.map(s => getSiteBalance(s))),
        getLedger(filterSite || undefined),
      ]);
      setBalances(b);
      setLedger(l);
    } catch (err) {
      if (!opts?.background) notify(err instanceof Error ? err.message : 'Failed to load petty cash', 'error');
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [userSites, filterSite, notify]);

  useEffect(() => { refresh(); }, [refresh]);
  useReloadOnFocus(() => { refresh({ background: true }); });

  const totalFloat = balances.reduce((sum, b) => sum + Number(b.balance), 0);

  return (
    <AppShell>
      <div className="max-w-[1100px]">
        <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-lg font-medium text-gray-900">Petty Cash</div>
            <div className="text-xs text-gray-500 mt-1">
              Read-only floats &amp; ledger for {userSites.length === 1 ? userSites[0] : `${userSites.length} assigned sites`}
            </div>
          </div>
          <select value={filterSite} onChange={e => setFilterSite(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
            <option value="">All my sites</option>
            {userSites.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        {/* Balance tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
          {balances.map(b => (
            <div key={b.site}
              className={`p-4 rounded-xl border ${Number(b.balance) <= 0 ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'}`}>
              <div className="text-[11px] uppercase tracking-wide text-gray-500">{b.site}</div>
              <div className="text-xl font-semibold text-gray-900 mt-1">{formatINR(Number(b.balance))}</div>
              <div className="text-[10px] text-gray-400 mt-1">
                In {formatINR(Number(b.total_in))} · Out {formatINR(Number(b.total_out))}
              </div>
            </div>
          ))}
          {balances.length > 1 && (
            <div className="p-4 rounded-xl border border-blue-200 bg-blue-50 col-span-2 sm:col-span-3 lg:col-span-4">
              <div className="text-[11px] uppercase tracking-wide text-blue-700">Total Float Outstanding</div>
              <div className="text-xl font-semibold text-blue-900 mt-1">{formatINR(totalFloat)}</div>
            </div>
          )}
        </div>

        {/* Ledger */}
        {loading ? (
          <div className="text-gray-500 text-sm py-12 text-center">Loading…</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50">
                <tr>
                  {['Transaction Date', 'Site', 'Type', 'Description', 'By', 'Amount'].map(h => (
                    <th key={h}
                      className={`px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap border-b border-gray-100 ${h === 'Amount' ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.map(e => (
                  <tr key={`${e.event_type}-${e.id}`} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(e.event_date)}</td>
                    <td className="px-4 py-3">{e.site}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        e.event_type === 'in' ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'
                      }`}>
                        {e.event_type === 'in' ? 'Given' : 'Spent'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{e.description}</td>
                    <td className="px-4 py-3 text-gray-500">{e.by_name ?? '—'}</td>
                    <td className={`px-4 py-3 text-right font-medium ${e.event_type === 'in' ? 'text-green-700' : 'text-orange-700'}`}>
                      {e.event_type === 'in' ? '+' : '−'}{formatINR(Number(e.amount))}
                    </td>
                  </tr>
                ))}
                {ledger.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">No petty cash activity yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
