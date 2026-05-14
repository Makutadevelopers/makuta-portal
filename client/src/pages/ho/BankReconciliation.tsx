import { Fragment, useEffect, useMemo, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import { getBankReconciliation, BankReconciliationRow } from '../../api/reconciliation';
import { formatINR, formatDate } from '../../utils/formatters';
import { useStickyHeaderHeight } from '../../hooks/useStickyHeaderHeight';

export default function BankReconciliation() {
  const [rows, setRows] = useState<BankReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [fType, setFType] = useState('All');
  const { ref: stickyHeaderRef, height: stickyHeaderHeight } = useStickyHeaderHeight();

  async function load() {
    setLoading(true);
    try {
      const data = await getBankReconciliation();
      setRows(data);
    } catch {
      setRows([]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter(r => {
    if (fType !== 'All' && r.txn_type !== fType) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${r.txn_ref} ${r.bank ?? ''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [rows, search, fType]);

  const totalTxn = filtered.reduce((s, r) => s + r.txn_amount, 0);
  const totalAlloc = filtered.reduce((s, r) => s + r.allocated_total, 0);
  const untally = filtered.filter(r => !r.tally_ok).length;

  return (
    <AppShell>
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-30 bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 -mt-4 sm:-mt-6 pt-4 sm:pt-6 pb-1 mb-4"
      >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-lg font-medium text-gray-900">Bank Reconciliation</div>
          <div className="text-xs text-gray-500">Cheque &amp; transaction allocations across invoices</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-0 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search cheque no, txn id, bank..."
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        <select value={fType} onChange={e => setFType(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
          <option value="All">All Types</option>
          <option>Cheque</option><option>NEFT</option><option>RTGS</option><option>UPI</option><option>Cash</option>
        </select>
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} records</span>
      </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-5">
        <Kpi label="Transactions" value={String(filtered.length)} />
        <Kpi label="Total cheque / txn amount" value={formatINR(totalTxn)} />
        <Kpi label="Total allocated" value={formatINR(totalAlloc)} />
        <Kpi label="Un-tallied" value={String(untally)} tone={untally > 0 ? 'warn' : 'ok'} />
      </div>

      {/* Table */}
      <div
        className="bg-white border border-gray-100 rounded-xl overflow-auto"
        style={{ maxHeight: `calc(100vh - ${stickyHeaderHeight + 120}px)` }}
      >
        <div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium w-12 bg-gray-50 sticky top-0 z-20 border-b border-gray-100">S.No</th>
                <th className="text-left px-4 py-2.5 font-medium bg-gray-50 sticky top-0 z-20 border-b border-gray-100">Date</th>
                <th className="text-left px-4 py-2.5 font-medium bg-gray-50 sticky top-0 z-20 border-b border-gray-100">Payment Type</th>
                <th className="text-left px-4 py-2.5 font-medium bg-gray-50 sticky top-0 z-20 border-b border-gray-100">Cheque / Txn ID</th>
                <th className="text-left px-4 py-2.5 font-medium bg-gray-50 sticky top-0 z-20 border-b border-gray-100">Bank</th>
                <th className="text-right px-4 py-2.5 font-medium bg-gray-50 sticky top-0 z-20 border-b border-gray-100">Cheque Amount</th>
                <th className="text-right px-4 py-2.5 font-medium bg-gray-50 sticky top-0 z-20 border-b border-gray-100">Allocated</th>
                <th className="text-right px-4 py-2.5 font-medium bg-gray-50 sticky top-0 z-20 border-b border-gray-100">Balance</th>
                <th className="text-center px-4 py-2.5 font-medium bg-gray-50 sticky top-0 z-20 border-b border-gray-100">Invoices</th>
                <th className="text-center px-4 py-2.5 font-medium bg-gray-50 sticky top-0 z-20 border-b border-gray-100">Tally</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-400">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-400">No transactions yet</td></tr>
              ) : filtered.map((r, idx) => {
                const isOpen = expanded === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className={`border-t border-gray-50 hover:bg-gray-50/50 cursor-pointer ${isOpen ? 'bg-blue-50/40' : ''}`}
                      onClick={() => setExpanded(isOpen ? null : r.id)}>
                      <td className="px-4 py-3 text-gray-500">{idx + 1}</td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(r.txn_date)}</td>
                      <td className="px-4 py-3 text-gray-700">{r.txn_type}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{r.txn_ref}</td>
                      <td className="px-4 py-3 text-gray-600">{r.bank ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatINR(r.txn_amount)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatINR(r.allocated_total)}</td>
                      <td className={`px-4 py-3 text-right font-medium ${Math.abs(r.balance) < 0.01 ? 'text-gray-400' : 'text-amber-600'}`}>{formatINR(r.balance)}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{r.allocation_count}</td>
                      <td className="px-4 py-3 text-center">
                        {r.tally_ok ? (
                          <span className="inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-green-50 text-green-700">Tallied</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-amber-50 text-amber-700">Mismatch</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50/80">
                        <td colSpan={10} className="px-6 py-4">
                          <div className="text-xs font-medium text-gray-500 mb-2">Invoices paid by this transaction</div>
                          {r.allocations.length === 0 ? (
                            <div className="text-xs text-gray-400">No linked invoices.</div>
                          ) : (
                            <table className="w-full text-xs bg-white rounded-lg border border-gray-100">
                              <thead className="text-gray-500">
                                <tr>
                                  <th className="text-left px-3 py-2 font-medium">Invoice No</th>
                                  <th className="text-left px-3 py-2 font-medium">Vendor</th>
                                  <th className="text-left px-3 py-2 font-medium">Site</th>
                                  <th className="text-right px-3 py-2 font-medium">Invoice Amount</th>
                                  <th className="text-right px-3 py-2 font-medium">Allocated</th>
                                  <th className="text-center px-3 py-2 font-medium">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.allocations.map(a => (
                                  <tr key={a.payment_id} className="border-t border-gray-50">
                                    <td className="px-3 py-2 font-medium text-gray-900">{a.invoice_no}</td>
                                    <td className="px-3 py-2 text-gray-700">{a.vendor_name}</td>
                                    <td className="px-3 py-2 text-gray-600">{a.site}</td>
                                    <td className="px-3 py-2 text-right text-gray-700">{formatINR(a.invoice_amount)}</td>
                                    <td className="px-3 py-2 text-right font-medium text-gray-900">{formatINR(a.allocated_amount)}</td>
                                    <td className="px-3 py-2 text-center">
                                      <span className={`inline-flex px-2 py-0.5 text-[10px] rounded-full ${
                                        a.payment_status === 'Paid' ? 'bg-green-50 text-green-700' :
                                        a.payment_status === 'Partial' ? 'bg-amber-50 text-amber-700' :
                                        'bg-gray-50 text-gray-600'
                                      }`}>{a.payment_status}</span>
                                    </td>
                                  </tr>
                                ))}
                                <tr className="border-t-2 border-gray-200 bg-gray-50/60">
                                  <td colSpan={4} className="px-3 py-2 text-right text-gray-500">Cheque / Txn Amount</td>
                                  <td className="px-3 py-2 text-right font-medium text-gray-900">{formatINR(r.txn_amount)}</td>
                                  <td></td>
                                </tr>
                                <tr className="bg-gray-50/60">
                                  <td colSpan={4} className="px-3 py-2 text-right text-gray-500">Allocated Total</td>
                                  <td className="px-3 py-2 text-right font-medium text-gray-900">{formatINR(r.allocated_total)}</td>
                                  <td></td>
                                </tr>
                                <tr className="bg-gray-50/60">
                                  <td colSpan={4} className="px-3 py-2 text-right text-gray-500">Balance (un-allocated)</td>
                                  <td className={`px-3 py-2 text-right font-medium ${Math.abs(r.balance) < 0.01 ? 'text-green-700' : 'text-amber-700'}`}>{formatINR(r.balance)}</td>
                                  <td></td>
                                </tr>
                              </tbody>
                            </table>
                          )}
                          {r.remarks && (
                            <div className="mt-3 text-xs text-gray-500"><span className="font-medium">Remarks:</span> {r.remarks}</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function Kpi({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'ok' | 'warn' }) {
  const toneClass = tone === 'warn' ? 'text-amber-700' : tone === 'ok' ? 'text-green-700' : 'text-gray-900';
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-medium mt-1 ${toneClass}`}>{value}</div>
    </div>
  );
}
