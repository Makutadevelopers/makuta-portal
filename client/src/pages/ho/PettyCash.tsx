// HO petty-cash console.
// Shows per-site balances at the top and a "Give Petty Cash" form. Click a
// site's tile to drill into that site's full activity (disbursements +
// expenses), with a month/range filter and inline edit/delete.

import { useEffect, useMemo, useState, useCallback, FormEvent } from 'react';
import { useSites } from '../../hooks/useSites';
import AppShell from '../../components/layout/AppShell';
import ExportButton from '../../components/shared/ExportButton';
import ActionsMenu from '../../components/shared/ActionsMenu';
import PeriodFilter from '../../components/shared/PeriodFilter';
import PettyCashEditModal, { PettyCashEditTarget } from '../../components/shared/PettyCashEditModal';
import PettyCashDeleteModal, { PettyCashDeleteTarget } from '../../components/shared/PettyCashDeleteModal';
import { formatINR, formatDate } from '../../utils/formatters';
import {
  getAllBalances,
  createDisbursement,
  listDisbursements,
  listExpenses,
} from '../../api/pettyCash';
import { PettyCashBalance, PettyCashDisbursement, PettyCashExpense } from '../../types/pettyCash';
import {
  mergePettyCashActivity,
  matchesPeriod,
  DEFAULT_PERIOD_FILTER,
  PeriodFilter as PeriodFilterValue,
  PettyCashActivityEntry,
} from '../../utils/pettyCashActivity';
import { useToast } from '../../context/ToastContext';
import { useReloadOnFocus } from '../../hooks/useReloadOnFocus';

interface DisbursementRow { amount: string; given_on: string; }

function toEditTarget(a: PettyCashActivityEntry): PettyCashEditTarget {
  return a.type === 'in' ? { kind: 'disbursement', row: a.row } : { kind: 'expense', row: a.row };
}
function toDeleteTarget(a: PettyCashActivityEntry): PettyCashDeleteTarget {
  return a.type === 'in' ? { kind: 'disbursement', row: a.row } : { kind: 'expense', row: a.row };
}

export default function PettyCash() {
  // Projects come from the DB-backed Project Master (HO manages them at
  // /projects). useSites falls back to the static seed list while the request
  // is in flight, so this dropdown is never empty.
  const { names: SITES } = useSites();
  const { notify } = useToast();
  const today = new Date().toISOString().split('T')[0];

  const [balances, setBalances] = useState<PettyCashBalance[]>([]);
  const [loading, setLoading]   = useState(true);

  // Give Petty Cash form — shared Site/Mode/Reference/Remarks, repeatable
  // Amount+Date rows so HO can back-date or split a hand-over into installments
  // in one go.
  const [showForm, setShowForm]   = useState(false);
  const [fSite, setFSite]         = useState(SITES[0] ?? '');
  const [fMode, setFMode]         = useState<'cash' | 'bank'>('cash');
  const [fReference, setFReference] = useState('');
  const [fRemarks, setFRemarks]   = useState('');
  const [fRows, setFRows]         = useState<DisbursementRow[]>([{ amount: '', given_on: today }]);
  const [submitting, setSubmitting] = useState(false);

  // Site drilldown
  const [drilldownSite, setDrilldownSite] = useState<string | null>(null);

  async function refresh(opts?: { background?: boolean }) {
    if (!opts?.background) setLoading(true);
    try {
      setBalances(await getAllBalances());
    } catch (err) {
      if (!opts?.background) notify(err instanceof Error ? err.message : 'Failed to load petty cash', 'error');
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Silent refresh on focus so balances reflect expenses logged elsewhere.
  useReloadOnFocus(() => { refresh({ background: true }); });

  // Merge in sites that have no activity yet so HO sees zero balances too
  const balanceBySite = useMemo(() => {
    const m = new Map(balances.map(b => [b.site, b]));
    for (const s of SITES) {
      if (!m.has(s)) {
        m.set(s, { site: s, total_in: '0', total_out: '0', balance: '0', last_activity: null });
      }
    }
    return Array.from(m.values()).sort((a, b) => a.site.localeCompare(b.site));
  }, [balances, SITES]);

  const totalFloat = balances.reduce((sum, b) => sum + Number(b.balance), 0);

  function addRow() {
    setFRows(rows => [...rows, { amount: '', given_on: today }]);
  }
  function removeRow(i: number) {
    setFRows(rows => rows.filter((_, idx) => idx !== i));
  }
  function updateRow(i: number, patch: Partial<DisbursementRow>) {
    setFRows(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  const rowsTotal = fRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  async function handleGive(e: FormEvent) {
    e.preventDefault();
    for (const r of fRows) {
      if (!(Number(r.amount) > 0)) { notify('Every entry needs an amount greater than zero', 'error'); return; }
      if (!r.given_on) { notify('Every entry needs a date', 'error'); return; }
    }
    setSubmitting(true);
    let succeeded = 0;
    try {
      for (const r of fRows) {
        await createDisbursement({
          site: fSite,
          amount: Number(r.amount),
          given_on: r.given_on,
          mode: fMode,
          reference: fReference.trim() || null,
          remarks: fRemarks.trim() || null,
        });
        succeeded++;
      }
      notify(
        fRows.length > 1
          ? `${fRows.length} entries totaling ${formatINR(rowsTotal)} given to ${fSite}`
          : `${formatINR(rowsTotal)} given to ${fSite}`
      );
      setShowForm(false);
      setFReference(''); setFRemarks(''); setFRows([{ amount: '', given_on: today }]);
      refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to record disbursement';
      notify(succeeded > 0 ? `${succeeded} of ${fRows.length} entries saved — ${msg}` : msg, 'error');
      refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Petty Cash</div>
          <div className="text-xs text-gray-500 mt-1">
            Per-site floats · Give cash to sites · Click a site to review its activity
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            buildPath={(format) => `/export/petty-cash?format=${format}`}
            filenameBase="petty-cash"
            noun="entry"
          />
          <button onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d]">
            + Give Petty Cash
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading…</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
          {balanceBySite.map(b => (
            <button key={b.site} type="button" onClick={() => setDrilldownSite(b.site)}
              className={`text-left p-4 rounded-xl border transition-colors hover:border-[#1a3c5e]/40 hover:shadow-sm ${Number(b.balance) <= 0 ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'}`}>
              <div className="text-[11px] uppercase tracking-wide text-gray-500">{b.site}</div>
              <div className="text-xl font-semibold text-gray-900 mt-1">{formatINR(Number(b.balance))}</div>
              <div className="text-[10px] text-gray-400 mt-1">
                In {formatINR(Number(b.total_in))} · Out {formatINR(Number(b.total_out))}
              </div>
            </button>
          ))}
          <div className="p-4 rounded-xl border border-blue-200 bg-blue-50 col-span-2 sm:col-span-3 lg:col-span-4">
            <div className="text-[11px] uppercase tracking-wide text-blue-700">Total Float Outstanding</div>
            <div className="text-xl font-semibold text-blue-900 mt-1">{formatINR(totalFloat)}</div>
          </div>
        </div>
      )}

      {/* Give Petty Cash modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <form onSubmit={handleGive} onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-lg space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="text-base font-medium text-gray-900 mb-1">Give Petty Cash</div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Site</label>
              <select value={fSite} onChange={e => setFSite(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm">
                {SITES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Entries</label>
              <div className="space-y-2">
                {fRows.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="number" min="1" step="1" value={r.amount} placeholder="Amount (₹)"
                      onChange={e => updateRow(i, { amount: e.target.value })} required
                      className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
                    <input type="date" value={r.given_on}
                      onChange={e => updateRow(i, { given_on: e.target.value })} required
                      className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
                    <button type="button" onClick={() => removeRow(i)} disabled={fRows.length === 1}
                      title="Remove entry"
                      className="px-2 py-2 text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400">
                      &times;
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addRow}
                className="mt-2 text-xs font-medium text-[#1a3c5e] hover:underline">
                + Add another entry
              </button>
              {fRows.length > 1 && (
                <div className="mt-2 text-xs text-gray-500">Total: <span className="font-medium text-gray-700">{formatINR(rowsTotal)}</span> across {fRows.length} entries</div>
              )}
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
                {submitting ? 'Saving…' : fRows.length > 1 ? `Give ${fRows.length} Entries` : 'Give'}
              </button>
            </div>
          </form>
        </div>
      )}

      {drilldownSite && (
        <SiteDrilldownModal site={drilldownSite} canEditDisbursements onClose={() => setDrilldownSite(null)} onChanged={refresh} />
      )}
    </AppShell>
  );
}

function SiteDrilldownModal({ site, canEditDisbursements, onClose, onChanged }: {
  site: string;
  canEditDisbursements: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { notify } = useToast();
  const [disbursements, setDisbursements] = useState<PettyCashDisbursement[]>([]);
  const [expenses, setExpenses] = useState<PettyCashExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodFilterValue>(DEFAULT_PERIOD_FILTER);
  const [editTarget, setEditTarget] = useState<PettyCashEditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PettyCashDeleteTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, e] = await Promise.all([listDisbursements(site), listExpenses(site)]);
      setDisbursements(d);
      setExpenses(e);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load activity', 'error');
    } finally {
      setLoading(false);
    }
  }, [site, notify]);

  useEffect(() => { load(); }, [load]);

  function handleChanged() {
    load();
    onChanged?.();
  }

  const activity = useMemo(
    () => mergePettyCashActivity(disbursements, expenses).filter(a => matchesPeriod(a.date, period)),
    [disbursements, expenses, period]
  );
  const totalIn = activity.filter(a => a.type === 'in').reduce((s, a) => s + Number(a.row.amount), 0);
  const totalOut = activity.filter(a => a.type === 'out').reduce((s, a) => s + Number(a.row.amount), 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-lg" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-base font-medium text-gray-900">{site}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {activity.length} {activity.length === 1 ? 'entry' : 'entries'} · In {formatINR(totalIn)} · Out {formatINR(totalOut)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PeriodFilter value={period} onChange={setPeriod} />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-1">&times;</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="text-gray-500 text-sm py-12 text-center">Loading…</div>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  {['Date', 'Type', 'Description', 'By', 'Amount', ''].map(h => (
                    <th key={h} className={`px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap border-b border-gray-100 ${h === 'Amount' ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activity.map(a => {
                  const canEdit = a.type === 'out' || canEditDisbursements;
                  return (
                    <tr key={`${a.type}-${a.row.id}`} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 whitespace-nowrap">{formatDate(a.date)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${a.type === 'in' ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}`}>
                          {a.type === 'in' ? 'Given' : 'Spent'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {a.type === 'in'
                          ? `Received via ${a.row.mode}${a.row.reference ? ` — ${a.row.reference}` : ''}`
                          : a.row.purpose}
                        {a.type === 'out' && a.row.invoice_no && <span className="text-gray-400"> · Inv #{a.row.invoice_no}</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{a.type === 'in' ? (a.row.given_by_name ?? '—') : (a.row.recorded_by_name ?? '—')}</td>
                      <td className={`px-4 py-3 text-right font-medium ${a.type === 'in' ? 'text-green-700' : 'text-orange-700'}`}>
                        {a.type === 'in' ? '+' : '−'}{formatINR(Number(a.row.amount))}
                      </td>
                      <td className="px-2 py-3 text-right">
                        {canEdit && (
                          <ActionsMenu items={[
                            { label: 'Edit', color: 'text-gray-700', onClick: () => setEditTarget(toEditTarget(a)) },
                            { label: 'Delete', color: 'text-red-600', onClick: () => setDeleteTarget(toDeleteTarget(a)) },
                          ]} />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {activity.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">No activity for this period.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <PettyCashEditModal target={editTarget} onClose={() => setEditTarget(null)} onSaved={handleChanged} />
      <PettyCashDeleteModal target={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={handleChanged} />
    </div>
  );
}
