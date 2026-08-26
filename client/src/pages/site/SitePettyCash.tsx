// Site petty-cash console.
// Current balance card · "Log Expense" form · own-site ledger.

import { useEffect, useMemo, useState, useCallback, FormEvent } from 'react';
import AppShell from '../../components/layout/AppShell';
import { useAuth } from '../../hooks/useAuth';
import { useInvoices } from '../../hooks/useInvoices';
import { formatINR, formatDate } from '../../utils/formatters';
import { getSiteBalance, createExpense, listDisbursements, listExpenses } from '../../api/pettyCash';
import { PettyCashBalance, PettyCashDisbursement, PettyCashExpense } from '../../types/pettyCash';
import ActionsMenu from '../../components/shared/ActionsMenu';
import PeriodFilter from '../../components/shared/PeriodFilter';
import PettyCashEditModal, { PettyCashEditTarget } from '../../components/shared/PettyCashEditModal';
import PettyCashDeleteModal, { PettyCashDeleteTarget } from '../../components/shared/PettyCashDeleteModal';
import {
  mergePettyCashActivity,
  matchesPeriod,
  DEFAULT_PERIOD_FILTER,
  PeriodFilter as PeriodFilterValue,
} from '../../utils/pettyCashActivity';
import { useToast } from '../../context/ToastContext';
import { useStickyHeaderHeight } from '../../hooks/useStickyHeaderHeight';
import { useReloadOnFocus } from '../../hooks/useReloadOnFocus';

const MINOR_LIMIT = 50000;

export default function SitePettyCash() {
  const { user } = useAuth();
  const site = user?.site ?? '';
  const { notify } = useToast();
  const { invoices, refresh: refreshInvoices } = useInvoices();
  const today = new Date().toISOString().split('T')[0];

  const [balance, setBalance] = useState<PettyCashBalance | null>(null);
  const [disbursements, setDisbursements] = useState<PettyCashDisbursement[]>([]);
  const [expenses, setExpenses] = useState<PettyCashExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodFilterValue>(DEFAULT_PERIOD_FILTER);
  const [editTarget, setEditTarget] = useState<PettyCashEditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PettyCashDeleteTarget | null>(null);
  const { ref: stickyHeaderRef, height: stickyHeaderHeight } = useStickyHeaderHeight();

  // Log Expense form
  const [showForm, setShowForm] = useState(false);
  const [fAmount, setFAmount]   = useState('');
  const [fSpentOn, setFSpentOn] = useState(today);
  const [fPurpose, setFPurpose] = useState('');
  const [fRemarks, setFRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pay Invoice from Petty Cash form
  const [showPay, setShowPay]       = useState(false);
  const [pInvoiceId, setPInvoiceId] = useState('');
  const [pAmount, setPAmount]       = useState('');
  const [pSpentOn, setPSpentOn]     = useState(today);
  const [pRemarks, setPRemarks]     = useState('');
  const [paying, setPaying]         = useState(false);

  const refresh = useCallback(async (opts?: { background?: boolean }) => {
    if (!site) return;
    if (!opts?.background) setLoading(true);
    try {
      const [b, d, e] = await Promise.all([getSiteBalance(site), listDisbursements(site), listExpenses(site)]);
      setBalance(b);
      setDisbursements(d);
      setExpenses(e);
    } catch (err) {
      if (!opts?.background) notify(err instanceof Error ? err.message : 'Failed to load petty cash', 'error');
    } finally {
      if (!opts?.background) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site]);

  const activity = useMemo(
    () => mergePettyCashActivity(disbursements, expenses).filter(a => matchesPeriod(a.date, period)),
    [disbursements, expenses, period]
  );

  function handleChanged() {
    refresh();
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [site]);

  // Silent refresh on focus so the balance reflects expenses logged elsewhere.
  useReloadOnFocus(() => { refresh({ background: true }); });

  async function handleLog(e: FormEvent) {
    e.preventDefault();
    const amt = Number(fAmount);
    if (!(amt > 0)) { notify('Amount must be greater than zero', 'error'); return; }
    if (!fPurpose.trim()) { notify('Purpose is required', 'error'); return; }
    setSubmitting(true);
    try {
      await createExpense({
        site,
        amount: amt,
        spent_on: fSpentOn,
        purpose: fPurpose.trim(),
        remarks: fRemarks.trim() || null,
      });
      notify(`₹${amt.toLocaleString('en-IN')} expense logged`);
      setShowForm(false);
      setFAmount(''); setFPurpose(''); setFRemarks('');
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to log expense', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // Invoices payable from petty cash: own-site, not yet finalised (pushed)
  const payableInvoices = useMemo(
    () => invoices.filter(i => i.site === site && !i.pushed),
    [invoices, site]
  );
  const selectedInvoice = payableInvoices.find(i => i.id === pInvoiceId);

  async function handlePay(e: FormEvent) {
    e.preventDefault();
    const amt = Number(pAmount);
    if (!pInvoiceId) { notify('Pick an invoice', 'error'); return; }
    if (!(amt > 0)) { notify('Amount must be greater than zero', 'error'); return; }
    if (amt > MINOR_LIMIT) { notify(`Site accountants can only pay up to ₹${MINOR_LIMIT.toLocaleString('en-IN')}`, 'error'); return; }
    setPaying(true);
    try {
      await createExpense({
        site,
        amount: amt,
        spent_on: pSpentOn,
        purpose: selectedInvoice ? `Payment: ${selectedInvoice.vendor_name} · ${selectedInvoice.invoice_no}` : 'Invoice payment',
        invoice_id: pInvoiceId,
        remarks: pRemarks.trim() || null,
      });
      notify(`Paid ₹${amt.toLocaleString('en-IN')} from petty cash`);
      setShowPay(false);
      setPInvoiceId(''); setPAmount(''); setPRemarks('');
      refresh();
      refreshInvoices();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to pay from petty cash', 'error');
    } finally {
      setPaying(false);
    }
  }

  const currentBalance = Number(balance?.balance ?? 0);
  const low = currentBalance > 0 && currentBalance < 1000;
  const empty = currentBalance <= 0;

  return (
    <AppShell>
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-30 bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 -mt-4 sm:-mt-6 pt-4 sm:pt-6 pb-2 mb-4"
      >
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="text-lg font-medium text-gray-900">Petty Cash</div>
            <div className="text-xs text-gray-500 mt-1">
              Your site's cash float · Log site-level expenses here
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowPay(true)}
              disabled={empty || payableInvoices.length === 0}
              title={payableInvoices.length === 0 ? 'No draft invoices to pay' : empty ? 'No petty cash available' : ''}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              Pay Invoice
            </button>
            <button onClick={() => setShowForm(true)}
              disabled={empty}
              className="px-4 py-2 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d] disabled:opacity-50">
              + Log Expense
            </button>
          </div>
        </div>
      </div>

      {/* Balance card */}
      <div className={`p-5 rounded-xl border mb-5 ${
        empty ? 'border-red-200 bg-red-50' :
        low   ? 'border-orange-200 bg-orange-50' :
                'border-gray-100 bg-white'
      }`}>
        <div className="text-[11px] uppercase tracking-wide text-gray-500">{site} — Current Balance</div>
        <div className="text-2xl font-semibold text-gray-900 mt-1">{formatINR(currentBalance)}</div>
        <div className="text-[11px] text-gray-400 mt-2">
          Total received {formatINR(Number(balance?.total_in ?? 0))} · Total spent {formatINR(Number(balance?.total_out ?? 0))}
        </div>
        {empty && (
          <div className="text-xs text-red-700 mt-2">No float available. Ask Head Office for a top-up.</div>
        )}
        {low && !empty && (
          <div className="text-xs text-orange-700 mt-2">Running low — consider requesting a top-up from HO.</div>
        )}
      </div>

      {/* Pay Invoice from Petty Cash modal */}
      {showPay && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowPay(false)}>
          <form onSubmit={handlePay} onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl w-full max-w-md p-6 shadow-lg space-y-3">
            <div className="text-base font-medium text-gray-900 mb-1">Pay Invoice from Petty Cash</div>
            <div className="text-xs text-gray-500 mb-2">
              Balance available: <span className="font-medium text-gray-700">{formatINR(currentBalance)}</span>
              {' · '}
              Site limit per payment: <span className="font-medium text-gray-700">{formatINR(MINOR_LIMIT)}</span>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Invoice</label>
              <select value={pInvoiceId} onChange={e => {
                  setPInvoiceId(e.target.value);
                  const inv = payableInvoices.find(i => i.id === e.target.value);
                  if (inv) setPAmount(String(inv.invoice_amount));
                }} required
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white">
                <option value="">Select an invoice…</option>
                {payableInvoices.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.vendor_name} · {i.invoice_no} · {formatINR(Number(i.invoice_amount))}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Amount (₹)</label>
                <input type="number" min="1" step="1" value={pAmount}
                  onChange={e => setPAmount(e.target.value)} required
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date</label>
                <input type="date" value={pSpentOn}
                  onChange={e => setPSpentOn(e.target.value)} required
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Remarks (optional)</label>
              <input value={pRemarks} onChange={e => setPRemarks(e.target.value)}
                placeholder="e.g. Paid in cash to delivery boy"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
            </div>

            <div className="text-[11px] text-gray-400 leading-snug">
              The invoice payment status will update automatically once HO reconciles.
              If the invoice has already been partly paid, the server will reject an amount that exceeds the remaining balance.
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowPay(false)}
                className="px-3 py-2 text-sm text-gray-600">Cancel</button>
              <button type="submit" disabled={paying}
                className="px-4 py-2 bg-[#1a3c5e] text-white text-sm rounded-lg hover:bg-[#15304d] disabled:opacity-50">
                {paying ? 'Paying…' : 'Pay from Petty Cash'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Log Expense modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <form onSubmit={handleLog} onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl w-full max-w-md p-6 shadow-lg space-y-3">
            <div className="text-base font-medium text-gray-900 mb-1">Log Petty Cash Expense</div>
            <div className="text-xs text-gray-500 mb-2">
              Balance available: <span className="font-medium text-gray-700">{formatINR(currentBalance)}</span>
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
                <input type="date" value={fSpentOn}
                  onChange={e => setFSpentOn(e.target.value)} required
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Purpose</label>
              <input value={fPurpose} onChange={e => setFPurpose(e.target.value)} required
                placeholder="e.g. Tea for workers, Auto fare, Stationery"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
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
                {submitting ? 'Saving…' : 'Log'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Activity */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <PeriodFilter value={period} onChange={setPeriod} />
        <div className="text-xs text-gray-400">{activity.length} {activity.length === 1 ? 'entry' : 'entries'}</div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading…</div>
      ) : (
        <div
          className="bg-white rounded-xl border border-gray-100 overflow-y-auto overflow-x-hidden"
          style={{ maxHeight: `calc(100vh - ${stickyHeaderHeight + 160}px)` }}
        >
          <table className="w-full table-fixed text-[13px]">
            <colgroup>
              <col style={{ width: '14%' }} />{/* Transaction Date */}
              <col style={{ width: '11%' }} />{/* Type */}
              <col style={{ width: '37%' }} />{/* Description */}
              <col style={{ width: '17%' }} />{/* By */}
              <col style={{ width: '14%' }} />{/* Amount */}
              <col style={{ width: '7%' }} />{/* Actions */}
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                {['Transaction Date','Type','Description','By','Amount',''].map(h => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap bg-gray-50 sticky top-0 z-20 border-b border-gray-100 ${h === 'Amount' ? 'text-right' : 'text-left'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activity.map(a => (
                <tr key={`${a.type}-${a.row.id}`} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(a.date)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      a.type === 'in' ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'
                    }`}>
                      {a.type === 'in' ? 'Received' : 'Spent'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 truncate">
                    {a.type === 'in'
                      ? `Received via ${a.row.mode}${a.row.reference ? ` — ${a.row.reference}` : ''}`
                      : a.row.purpose}
                  </td>
                  <td className="px-4 py-3 text-gray-500 truncate">{a.type === 'in' ? (a.row.given_by_name ?? '—') : (a.row.recorded_by_name ?? '—')}</td>
                  <td className={`px-4 py-3 text-right font-medium ${a.type === 'in' ? 'text-green-700' : 'text-orange-700'}`}>
                    {a.type === 'in' ? '+' : '−'}{formatINR(Number(a.row.amount))}
                  </td>
                  <td className="px-2 py-3 text-right">
                    {a.type === 'out' && (
                      <ActionsMenu items={[
                        { label: 'Edit', color: 'text-gray-700', onClick: () => setEditTarget({ kind: 'expense', row: a.row }) },
                        { label: 'Delete', color: 'text-red-600', onClick: () => setDeleteTarget({ kind: 'expense', row: a.row }) },
                      ]} />
                    )}
                  </td>
                </tr>
              ))}
              {activity.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">No petty cash activity for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <PettyCashEditModal target={editTarget} onClose={() => setEditTarget(null)} onSaved={handleChanged} />
      <PettyCashDeleteModal target={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={handleChanged} />
    </AppShell>
  );
}
