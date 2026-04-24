// HO petty-cash console.
// Shows per-site balances at the top, a "Give Petty Cash" form, and a
// combined ledger (disbursements + expenses) with a site filter.

import { useEffect, useMemo, useState, FormEvent } from 'react';
import AppShell from '../../components/layout/AppShell';
import { SITES } from '../../utils/constants';
import { formatINR, formatDate } from '../../utils/formatters';
import {
  getAllBalances,
  createDisbursement,
  getLedger,
} from '../../api/pettyCash';
import {
  PettyCashBalance,
  PettyCashLedgerEntry,
} from '../../types/pettyCash';
import { useToast } from '../../context/ToastContext';

export default function PettyCash() {
  const { notify } = useToast();
  const today = new Date().toISOString().split('T')[0];

  const [balances, setBalances] = useState<PettyCashBalance[]>([]);
  const [ledger, setLedger]     = useState<PettyCashLedgerEntry[]>([]);
  const [filterSite, setFilterSite] = useState<string>('');
  const [loading, setLoading]       = useState(true);

  // Give Petty Cash form
  const [showForm, setShowForm]   = useState(false);
  const [fSite, setFSite]         = useState(SITES[0] ?? '');
  const [fAmount, setFAmount]     = useState('');
  const [fGivenOn, setFGivenOn]   = useState(today);
  const [fMode, setFMode]         = useState<'cash' | 'bank'>('cash');
  const [fReference, setFReference] = useState('');
  const [fRemarks, setFRemarks]   = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [b, l] = await Promise.all([
        getAllBalances(),
        getLedger(filterSite || undefined),
      ]);
      setBalances(b);
      setLedger(l);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load petty cash', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterSite]);

  // Merge in sites that have no activity yet so HO sees zero balances too
  const balanceBySite = useMemo(() => {
    const m = new Map(balances.map(b => [b.site, b]));
    for (const s of SITES) {
      if (!m.has(s)) {
        m.set(s, { site: s, total_in: '0', total_out: '0', balance: '0', last_activity: null });
      }
    }
    return Array.from(m.values()).sort((a, b) => a.site.localeCompare(b.site));
  }, [balances]);

  const totalFloat = balances.reduce((sum, b) => sum + Number(b.balance), 0);

  async function handleGive(e: FormEvent) {
    e.preventDefault();
    const amt = Number(fAmount);
    if (!(amt > 0)) { notify('Amount must be greater than zero', 'error'); return; }
    setSubmitting(true);
    try {
      await createDisbursement({
        site: fSite,
        amount: amt,
        given_on: fGivenOn,
        mode: fMode,
        reference: fReference.trim() || null,
        remarks: fRemarks.trim() || null,
      });
      notify(`₹${amt.toLocaleString('en-IN')} given to ${fSite}`);
      setShowForm(false);
      setFAmount(''); setFReference(''); setFRemarks('');
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to record disbursement', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Petty Cash</div>
          <div className="text-xs text-gray-500 mt-1">
            Per-site floats · Give cash to sites · Review expenses logged by site accountants
          </div>
        </div>
        <button onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d]">
          + Give Petty Cash
        </button>
      </div>

      {/* Balance tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        {balanceBySite.map(b => (
          <div key={b.site}
            className={`p-4 rounded-xl border ${Number(b.balance) <= 0 ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'}`}>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">{b.site}</div>
            <div className="text-xl font-semibold text-gray-900 mt-1">{formatINR(Number(b.balance))}</div>
            <div className="text-[10px] text-gray-400 mt-1">
              In {formatINR(Number(b.total_in))} · Out {formatINR(Number(b.total_out))}
            </div>
          </div>
        ))}
        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50 col-span-2 sm:col-span-3 lg:col-span-4">
          <div className="text-[11px] uppercase tracking-wide text-blue-700">Total Float Outstanding</div>
          <div className="text-xl font-semibold text-blue-900 mt-1">{formatINR(totalFloat)}</div>
        </div>
      </div>

      {/* Give Petty Cash modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <form onSubmit={handleGive} onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl w-full max-w-md p-6 shadow-lg space-y-3">
            <div className="text-base font-medium text-gray-900 mb-1">Give Petty Cash</div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Site</label>
              <select value={fSite} onChange={e => setFSite(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm">
                {SITES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Amount (₹)</label>
                <input type="number" min="1" step="1" value={fAmount}
                  onChange={e => setFAmount(e.target.value)} required
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date</label>
                <input type="date" value={fGivenOn}
                  onChange={e => setFGivenOn(e.target.value)} required
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Mode</label>
                <select value={fMode} onChange={e => setFMode(e.target.value as 'cash' | 'bank')}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm">
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Reference (optional)</label>
                <input value={fReference} onChange={e => setFReference(e.target.value)}
                  placeholder="Cheque / UPI / TXN"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Remarks (optional)</label>
              <input value={fRemarks} onChange={e => setFRemarks(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowForm(false)}
                className="px-3 py-2 text-sm text-gray-600">Cancel</button>
              <button type="submit" disabled={submitting}
                className="px-4 py-2 bg-[#1a3c5e] text-white text-sm rounded-lg hover:bg-[#15304d] disabled:opacity-50">
                {submitting ? 'Saving…' : 'Give'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Ledger */}
      <div className="flex items-center gap-3 mb-3">
        <select value={filterSite} onChange={e => setFilterSite(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
          <option value="">All sites</option>
          {SITES.map(s => <option key={s}>{s}</option>)}
        </select>
        <span className="text-xs text-gray-400 ml-auto">{ledger.length} entries</span>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50">
              <tr>
                {['Date','Site','Type','Description','By','Amount'].map(h => (
                  <th key={h} className={`px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
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
    </AppShell>
  );
}
