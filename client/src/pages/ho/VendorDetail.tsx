import { useState, useEffect, useMemo, Fragment, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getVendorDetail, VendorDetailResponse, VendorDetailInvoice } from '../../api/vendors';
import { deleteInvoice } from '../../api/invoices';
import { getVendorCreditBalance } from '../../api/creditNotes';
import { VendorCreditBalance } from '../../types/creditNote';
import { formatINR, formatDate } from '../../utils/formatters';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import AppShell from '../../components/layout/AppShell';
import ActionsMenu from '../../components/shared/ActionsMenu';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import PaymentModal from '../../components/shared/PaymentModal';
import RevertPaymentModal from '../../components/shared/RevertPaymentModal';
import { useReloadOnFocus } from '../../hooks/useReloadOnFocus';

type StatusFilter = 'All' | 'Paid' | 'Partial' | 'Not Paid';
type OrderType = 'All' | 'PO' | 'WO';

export default function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<VendorDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [orderType, setOrderType] = useState<OrderType>('All');
  // Invoice-date + paid-date filters, mirroring the All Invoices page:
  //   • Invoiced — by invoice date, as a single month OR a custom From–To range.
  //   • Paid — by the month of the latest payment (last_paid_date).
  const [invMode, setInvMode] = useState<'month' | 'range'>('month');
  const [fMonth, setFMonth] = useState<string>('');   // invoiced month, YYYY-MM
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [fPaidMonth, setFPaidMonth] = useState<string>(''); // paid month, YYYY-MM
  const [siteFilter, setSiteFilter] = useState<string>('All');
  const [creditBalance, setCreditBalance] = useState<VendorCreditBalance | null>(null);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [payInvoice, setPayInvoice] = useState<VendorDetailInvoice | null>(null);
  const [revertInvoice, setRevertInvoice] = useState<VendorDetailInvoice | null>(null);
  const { user } = useAuth();
  const { notify } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const isHO = user?.role === 'ho';

  // `background: true` reloads without the page spinner — used by the on-focus
  // refresh so figures update in place when returning from an edit elsewhere.
  const reload = useCallback((opts?: { background?: boolean }) => {
    if (!id) return;
    if (!opts?.background) {
      setLoading(true);
      setError('');
    }
    getVendorDetail(id)
      .then(setData)
      .catch(err => { if (!opts?.background) setError(err instanceof Error ? err.message : 'Failed to load vendor'); })
      .finally(() => { if (!opts?.background) setLoading(false); });
    getVendorCreditBalance(id).then(setCreditBalance).catch(() => setCreditBalance(null));
  }, [id]);

  useEffect(() => { reload(); }, [reload]);

  // Refresh when returning to this tab so a payment recorded elsewhere shows here.
  useReloadOnFocus(useCallback(() => reload({ background: true }), [reload]));

  // Hooks must run unconditionally on every render — keep this above the
  // loading/error early-returns so the hook count stays stable. The previous
  // crash (commit 6b61438) was caused by placing useMemo below the returns.
  const selectionSummary = useMemo(() => {
    let amount = 0;
    let balance = 0;
    const invs = data?.invoices ?? [];
    for (const inv of invs) {
      if (selectedIds.has(inv.id)) {
        amount += Number(inv.invoice_amount);
        balance += Number(inv.balance);
      }
    }
    return { count: selectedIds.size, amount, balance };
  }, [data, selectedIds]);

  // Filtered view stats — drive the four KPI tiles so picking a project (or any
  // other filter) immediately rescopes Total Invoices / Total Amount / Paid /
  // Outstanding to that subset. Falls back to all-time when every filter is
  // 'All' (filteredInvoices === invoices then).
  const filteredStats = useMemo(() => {
    const invs = data?.invoices ?? [];
    // Overdue uses the vendor's own payment terms: due = invoice_date + terms.
    const terms = Number(data?.vendor?.payment_terms ?? 0);
    const todayStr = new Date().toISOString().slice(0, 10);
    let count = 0;
    let totalAmount = 0;
    let paidAmount = 0;
    let outstandingAmount = 0;
    let overdueAmount = 0;
    let oldestUnpaid: string | null = null;
    for (const inv of invs) {
      if (statusFilter !== 'All' && inv.payment_status !== statusFilter) continue;
      if (orderType === 'PO' && !(inv.po_number || '').toUpperCase().includes('/PO/')) continue;
      if (orderType === 'WO' && !(inv.po_number || '').toUpperCase().includes('/WO/')) continue;
      if (invMode === 'range') {
        const invDay = (inv.invoice_date || '').slice(0, 10);
        if (dateFrom && invDay < dateFrom) continue;
        if (dateTo && invDay > dateTo) continue;
      } else if (fMonth && (inv.invoice_date || '').slice(0, 7) !== fMonth) continue;
      if (fPaidMonth && (inv.last_paid_date || '').slice(0, 7) !== fPaidMonth) continue;
      if (siteFilter !== 'All' && inv.site !== siteFilter) continue;
      const amt = Number(inv.invoice_amount);
      const bal = Number(inv.balance);
      count++;
      totalAmount += amt;
      outstandingAmount += bal;
      paidAmount += (amt - bal);
      if (bal > 0) {
        if (!oldestUnpaid || inv.invoice_date < oldestUnpaid) oldestUnpaid = inv.invoice_date;
        // Overdue = today is past the due date (invoice_date + payment_terms) and
        // there's still a balance. Within-terms invoices are owed but not overdue.
        const invDay = (inv.invoice_date || '').slice(0, 10);
        if (invDay) {
          const due = new Date(invDay + 'T00:00:00Z');
          due.setUTCDate(due.getUTCDate() + terms);
          if (todayStr > due.toISOString().slice(0, 10)) overdueAmount += bal;
        }
      }
    }
    return { count, totalAmount, paidAmount, outstandingAmount, overdueAmount, oldestUnpaid };
  }, [data, statusFilter, orderType, invMode, fMonth, dateFrom, dateTo, fPaidMonth, siteFilter]);

  const anyFilterActive =
    statusFilter !== 'All' || orderType !== 'All' || siteFilter !== 'All' ||
    fPaidMonth !== '' || (invMode === 'month' ? fMonth !== '' : dateFrom !== '' || dateTo !== '');

  if (loading) {
    return (
      <AppShell>
        <div className="text-gray-500 text-sm py-12 text-center">Loading vendor details...</div>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <div className="text-red-600 text-sm py-12 text-center">{error || 'Vendor not found'}</div>
        <div className="text-center mt-4">
          <Link to="/vendors" className="text-sm text-blue-600 hover:underline">Back to Vendor Master</Link>
        </div>
      </AppShell>
    );
  }

  const { vendor, invoices } = data;

  const siteOptions = Array.from(new Set(invoices.map(i => i.site).filter(Boolean))).sort();

  const filtered = invoices.filter(inv => {
    if (statusFilter !== 'All' && inv.payment_status !== statusFilter) return false;
    if (orderType === 'PO' && !(inv.po_number || '').toUpperCase().includes('/PO/')) return false;
    if (orderType === 'WO' && !(inv.po_number || '').toUpperCase().includes('/WO/')) return false;
    if (invMode === 'range') {
      const invDay = (inv.invoice_date || '').slice(0, 10);
      if (dateFrom && invDay < dateFrom) return false;
      if (dateTo && invDay > dateTo) return false;
    } else if (fMonth && (inv.invoice_date || '').slice(0, 7) !== fMonth) return false;
    if (fPaidMonth && (inv.last_paid_date || '').slice(0, 7) !== fPaidMonth) return false;
    if (siteFilter !== 'All' && inv.site !== siteFilter) return false;
    return true;
  });

  const allAttachments = invoices.flatMap(inv =>
    inv.attachments.map(att => ({ ...att, _invoiceNo: inv.invoice_no, _date: inv.invoice_date }))
  );

  const allFilteredSelected = filtered.length > 0 && filtered.every(i => selectedIds.has(i.id));
  const someFilteredSelected = filtered.some(i => selectedIds.has(i.id));

  function toggleRow(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const inv of filtered) next.delete(inv.id);
      } else {
        for (const inv of filtered) next.add(inv.id);
      }
      return next;
    });
  }

  async function handleDelete(invId: string, invoiceNo: string | null) {
    const ok = await confirm({
      title: `Delete invoice${invoiceNo ? ` #${invoiceNo}` : ''}?`,
      message: 'It will move to the Bin and can be restored from there within 30 days.',
      confirmLabel: 'Move to bin',
      variant: 'danger',
    });
    if (!ok) return;
    setDeletingId(invId);
    try {
      await deleteInvoice(invId);
      notify('Invoice moved to bin');
      setSelectedIds(prev => {
        if (!prev.has(invId)) return prev;
        const next = new Set(prev);
        next.delete(invId);
        return next;
      });
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete invoice');
    } finally {
      setDeletingId(null);
    }
  }

  const statusCounts = {
    All: invoices.length,
    Paid: invoices.filter(i => i.payment_status === 'Paid').length,
    Partial: invoices.filter(i => i.payment_status === 'Partial').length,
    'Not Paid': invoices.filter(i => i.payment_status === 'Not Paid').length,
  };

  function statusBadge(status: string) {
    if (status === 'Paid') return 'bg-green-50 text-green-700 border-green-200';
    if (status === 'Partial') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-red-50 text-red-700 border-red-200';
  }

  const scopeSub = anyFilterActive ? 'filtered view' : 'all time';
  const kpiCards = [
    { label: 'Total Invoices', value: String(filteredStats.count), sub: scopeSub, accent: '#1a3c5e', bg: '#e8eef5' },
    { label: 'Total Amount', value: formatINR(filteredStats.totalAmount), sub: anyFilterActive ? 'filtered view' : 'total invoiced value', accent: '#1a3c5e', bg: '#eff6ff' },
    { label: 'Paid Amount', value: formatINR(filteredStats.paidAmount), sub: anyFilterActive ? 'filtered view' : 'settled (incl. TDS & credits)', accent: '#15803d', bg: '#dcfce7' },
    { label: 'Outstanding', value: formatINR(filteredStats.outstandingAmount), sub: filteredStats.oldestUnpaid ? `oldest unpaid: ${formatDate(filteredStats.oldestUnpaid)}` : (filteredStats.count > 0 ? 'fully settled' : 'no invoices'), accent: filteredStats.outstandingAmount > 0 ? '#dc2626' : '#15803d', bg: filteredStats.outstandingAmount > 0 ? '#fef2f2' : '#dcfce7' },
    { label: 'Overdue', value: formatINR(filteredStats.overdueAmount), sub: `past ${vendor.payment_terms}-day terms`, accent: filteredStats.overdueAmount > 0 ? '#b91c1c' : '#15803d', bg: filteredStats.overdueAmount > 0 ? '#fef2f2' : '#dcfce7' },
  ];

  return (
    <AppShell>
      {confirmDialog}
      <div className="max-w-[1100px]">
        {/* Header */}
        <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <Link to="/vendors" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Vendor Master
              </Link>
            </div>
            <div className="text-lg sm:text-xl font-medium text-gray-900">{vendor.name}</div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {vendor.category && (
                <span className="text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded-md">{vendor.category}</span>
              )}
              <span className="text-xs text-gray-500">{vendor.payment_terms}-day payment terms</span>
              {vendor.gstin && (
                <span className="text-xs font-mono text-gray-500">GSTIN: {vendor.gstin}</span>
              )}
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          {kpiCards.map(c => (
            <div
              key={c.label}
              className="rounded-xl p-3 sm:p-5"
              style={{ background: c.bg, border: `1px solid ${c.accent}22` }}
            >
              <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-wider mb-1.5 sm:mb-2.5" style={{ color: c.accent }}>
                {c.label}
              </div>
              <div className="text-base sm:text-[22px] font-semibold leading-none mb-1 sm:mb-1.5 truncate" style={{ color: c.accent }}>
                {c.value}
              </div>
              <div className="text-[10px] sm:text-[11px] truncate" style={{ color: c.accent, opacity: 0.7 }}>
                {c.sub}
              </div>
            </div>
          ))}
        </div>

        {/* Credit notes summary */}
        {creditBalance && creditBalance.total_credit > 0 && (
          <div className="mb-6 p-4 bg-purple-50 border border-purple-100 rounded-xl flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs font-medium text-purple-800 uppercase tracking-wider mb-1">Credit notes</div>
              <div className="text-sm text-purple-900">
                Total credits issued: <span className="font-semibold">{formatINR(creditBalance.total_credit)}</span>
                &nbsp;·&nbsp;Applied: {formatINR(creditBalance.allocated)}
                &nbsp;·&nbsp;Unallocated:{' '}
                <span className={creditBalance.unallocated_balance > 0 ? 'font-semibold text-amber-700' : 'text-purple-700'}>
                  {formatINR(creditBalance.unallocated_balance)}
                </span>
              </div>
            </div>
            <Link to="/credit-notes" className="text-xs text-purple-700 hover:underline">View all credit notes →</Link>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {(['All', 'Paid', 'Partial', 'Not Paid'] as StatusFilter[]).map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                statusFilter === status
                  ? 'bg-[#1a3c5e] text-white border-[#1a3c5e]'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {status} ({statusCounts[status]})
            </button>
          ))}

          <div className="w-px h-5 bg-gray-200 mx-1" />

          {(['All', 'PO', 'WO'] as OrderType[]).map(ot => (
            <button
              key={ot}
              onClick={() => setOrderType(ot)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                orderType === ot
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {ot === 'All' ? 'All Orders' : ot === 'PO' ? 'Purchase Orders' : 'Work Orders'}
            </button>
          ))}

          {siteOptions.length > 1 && (
            <>
              <div className="w-px h-5 bg-gray-200 mx-1" />
              <select
                value={siteFilter}
                onChange={e => setSiteFilter(e.target.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                  siteFilter !== 'All'
                    ? 'bg-[#1a3c5e] text-white border-[#1a3c5e]'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
                title="Filter invoices by project / site"
              >
                <option value="All">All projects</option>
                {siteOptions.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </>
          )}

          <div className="w-px h-5 bg-gray-200 mx-1" />

          {/* Invoiced date filter — month picker, or a custom From–To range */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">Invoiced</span>
            <select
              value={invMode}
              onChange={e => setInvMode(e.target.value as 'month' | 'range')}
              className="px-2 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 cursor-pointer hover:bg-gray-50"
              title="Filter invoices by invoice date"
            >
              <option value="month">Month</option>
              <option value="range">Range</option>
            </select>
            {invMode === 'month' ? (
              <input
                type="month"
                value={fMonth}
                onChange={e => setFMonth(e.target.value)}
                title="Filter by invoice month"
                className={`px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                  fMonth ? 'border-[#1a3c5e] text-[#1a3c5e]' : 'border-gray-200 text-gray-600'
                } bg-white`}
              />
            ) : (
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  title="Invoiced from"
                  className={`px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                    dateFrom ? 'border-[#1a3c5e] text-[#1a3c5e]' : 'border-gray-200 text-gray-600'
                  } bg-white`}
                />
                <span className="text-xs text-gray-400">–</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  title="Invoiced to"
                  className={`px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                    dateTo ? 'border-[#1a3c5e] text-[#1a3c5e]' : 'border-gray-200 text-gray-600'
                  } bg-white`}
                />
              </div>
            )}
          </div>

          {/* Paid date filter — by the month of the latest payment */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">Paid</span>
            <input
              type="month"
              value={fPaidMonth}
              onChange={e => setFPaidMonth(e.target.value)}
              title="Filter by paid month (latest payment date)"
              className={`px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                fPaidMonth ? 'border-[#1a3c5e] text-[#1a3c5e]' : 'border-gray-200 text-gray-600'
              } bg-white`}
            />
          </div>

          {allAttachments.length > 0 && (
            <button
              onClick={() => setShowAllFiles(v => !v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                showAllFiles
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50'
              }`}
              title="See every uploaded invoice copy for this vendor in one list"
            >
              {showAllFiles ? 'Hide all files' : `All files (${allAttachments.length})`}
            </button>
          )}

          <span className="text-xs text-gray-400 ml-auto">{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* All-files aggregated view */}
        {showAllFiles && allAttachments.length > 0 && (
          <div className="mb-4 bg-purple-50/60 border border-purple-100 rounded-xl p-4">
            <div className="text-xs font-medium text-purple-800 uppercase tracking-wider mb-3">
              All uploaded invoice copies ({allAttachments.length})
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {allAttachments.map(att => (
                <a
                  key={att.id}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-purple-100 hover:border-purple-300 hover:shadow-sm transition-shadow min-w-0"
                  title={`From invoice ${att._invoiceNo ?? '—'} (${formatDate(att._date)})`}
                >
                  <span className="text-red-500 flex-shrink-0">&#128196;</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{att.file_name}</div>
                    <div className="text-[11px] text-gray-500 truncate">
                      {att._invoiceNo ?? '—'} · {formatDate(att._date)}
                      {att.file_size ? ` · ${Math.round(att.file_size / 1024)} KB` : ''}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Selection summary bar */}
        {selectionSummary.count > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 mb-3 bg-blue-50 border border-blue-200 rounded-lg flex-wrap">
            <div className="text-sm text-blue-900">
              <span className="font-semibold">{selectionSummary.count}</span>
              <span className="text-blue-700"> selected</span>
              <span className="text-blue-300 mx-2">·</span>
              <span className="text-blue-700">Total: </span>
              <span className="font-semibold">{formatINR(selectionSummary.amount)}</span>
              <span className="text-blue-300 mx-2">·</span>
              <span className="text-blue-700">Outstanding: </span>
              <span className="font-semibold">{formatINR(selectionSummary.balance)}</span>
            </div>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-blue-700 hover:text-blue-900 hover:underline"
            >
              Clear selection
            </button>
          </div>
        )}

        {/* Invoice Table */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all visible invoices"
                    checked={allFilteredSelected}
                    ref={el => { if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected; }}
                    onChange={toggleAllFiltered}
                    className="cursor-pointer accent-[#1a3c5e]"
                  />
                </th>
                <th className="px-4 py-2.5 w-8"></th>
                {['Invoice Date', 'Paid Date', 'Inv No', 'PO No', 'Category', 'Site', 'Amount', 'Balance', 'Status', 'Files'].map((h) => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap ${
                      h === 'Amount' || h === 'Balance' || h === 'Status' || h === 'Files' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {h}
                  </th>
                ))}
                {isHO && <th className="px-4 py-2.5 w-20 text-right font-medium text-gray-500 whitespace-nowrap">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const expanded = expandedInvoiceId === inv.id;
                const hasFiles = inv.attachments.length > 0;
                const hasPayments = inv.payments.length > 0;
                const canExpand = hasFiles || hasPayments;
                return (
                  <Fragment key={inv.id}>
                    <tr className={`border-t border-gray-50 hover:bg-gray-50/50 ${selectedIds.has(inv.id) ? 'bg-blue-50/40' : ''}`}>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Select invoice ${inv.invoice_no || inv.id}`}
                          checked={selectedIds.has(inv.id)}
                          onChange={() => toggleRow(inv.id)}
                          className="cursor-pointer accent-[#1a3c5e]"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {canExpand && (
                          <button
                            type="button"
                            onClick={() => setExpandedInvoiceId(expanded ? null : inv.id)}
                            className="text-gray-400 hover:text-blue-600 text-sm leading-none"
                            title={expanded ? 'Collapse details' : 'Show payment & file details'}
                          >
                            {expanded ? '▾' : '▸'}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {inv.last_paid_date ? formatDate(inv.last_paid_date) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">{inv.invoice_no || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{inv.po_number || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{inv.purpose}</td>
                      <td className="px-4 py-3 text-gray-700">{inv.site}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatINR(Number(inv.invoice_amount))}</td>
                      <td className="px-4 py-3 text-right font-medium">
                        <span className={Number(inv.balance) > 0 ? 'text-red-600' : 'text-green-600'}>
                          {formatINR(Number(inv.balance))}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium border ${statusBadge(inv.payment_status)}`}>
                          {inv.payment_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {hasFiles ? (
                          <button
                            type="button"
                            onClick={() => setExpandedInvoiceId(expanded ? null : inv.id)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            &#128206; {inv.attachments.length}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      {isHO && (
                        <td className="px-4 py-3 text-right">
                          {deletingId === inv.id ? (
                            <span className="text-xs text-gray-400">Deleting…</span>
                          ) : (
                            <ActionsMenu
                              items={[
                                {
                                  label: 'Edit',
                                  color: 'text-gray-700',
                                  onClick: () => navigate(`/invoices?focus=${inv.id}`),
                                },
                                ...(inv.payment_status !== 'Paid' ? [{
                                  label: inv.payment_status === 'Not Paid' ? 'Mark Paid' : 'Add Payment',
                                  color: 'text-green-600',
                                  onClick: () => setPayInvoice(inv),
                                }] : []),
                                ...(inv.payment_status !== 'Not Paid' ? [{
                                  label: 'Mark as Not Paid',
                                  color: 'text-red-600',
                                  onClick: () => setRevertInvoice(inv),
                                }] : []),
                                {
                                  label: 'Delete',
                                  color: 'text-red-500',
                                  onClick: () => handleDelete(inv.id, inv.invoice_no),
                                },
                              ]}
                            />
                          )}
                        </td>
                      )}
                    </tr>
                    {expanded && canExpand && (
                      <tr className="bg-gray-50/60 border-t border-gray-100">
                        <td colSpan={isHO ? 13 : 12} className="px-4 py-3 space-y-4">
                          {hasPayments && (
                            <div>
                              <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">
                                Payments for invoice {inv.invoice_no || '—'}
                              </div>
                              <div className="space-y-1.5">
                                {inv.payments.map(p => (
                                  <div
                                    key={p.id}
                                    className="flex items-center justify-between gap-3 px-3 py-2 bg-white rounded-lg border border-gray-100 text-xs"
                                  >
                                    <div className="flex items-center gap-2 min-w-0 flex-1 text-gray-600 flex-wrap">
                                      <span className="font-medium text-gray-900 whitespace-nowrap">
                                        {formatDate(p.payment_date)}
                                      </span>
                                      <span className="text-gray-300">·</span>
                                      <span>{p.payment_type}</span>
                                      {p.payment_ref && (
                                        <>
                                          <span className="text-gray-300">·</span>
                                          <span>Ref {p.payment_ref}</span>
                                        </>
                                      )}
                                      {p.bank && (
                                        <>
                                          <span className="text-gray-300">·</span>
                                          <span>{p.bank}</span>
                                        </>
                                      )}
                                      {Number(p.tds_amount) > 0 && (
                                        <>
                                          <span className="text-gray-300">·</span>
                                          <span className="text-amber-600">
                                            TDS {formatINR(Number(p.tds_amount))}
                                            {Number(p.tds_pct) > 0 ? ` (${Number(p.tds_pct)}%)` : ''}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                    <span className="font-medium text-green-700 whitespace-nowrap">
                                      {formatINR(Number(p.amount))}
                                    </span>
                                  </div>
                                ))}
                                <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between text-xs font-medium px-3">
                                  <span>Total paid</span>
                                  <span className="text-green-700">
                                    {formatINR(Number(inv.invoice_amount) - Number(inv.balance))}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                          {hasFiles && (
                          <div>
                          <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">
                            Attachments for invoice {inv.invoice_no || '—'}
                          </div>
                          <div className="space-y-1.5">
                            {inv.attachments.map(att => (
                              <div
                                key={att.id}
                                className="flex items-center justify-between gap-2 px-3 py-2 bg-white rounded-lg border border-gray-100"
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className="text-red-500">&#128196;</span>
                                  <span className="text-sm font-medium text-gray-900 truncate">{att.file_name}</span>
                                  <span className="text-xs text-gray-400 flex-shrink-0">
                                    {att.file_size ? `${Math.round(att.file_size / 1024)} KB` : ''}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <a
                                    href={att.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                                  >
                                    View
                                  </a>
                                  <a
                                    href={`${att.url}${att.url.includes('?') ? '&' : '?'}download=1`}
                                    className="px-2 py-1 text-xs text-green-600 hover:bg-green-50 rounded"
                                  >
                                    Download
                                  </a>
                                </div>
                              </div>
                            ))}
                          </div>
                          </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={isHO ? 13 : 12} className="px-4 py-10 text-center text-gray-400 text-sm">
                    {invoices.length === 0 ? 'No invoices for this vendor.' : 'No invoices match the selected filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {payInvoice && (
        <PaymentModal
          invoice={{
            id: payInvoice.id,
            vendor_name: vendor.name,
            invoice_no: payInvoice.invoice_no,
            invoice_amount: payInvoice.invoice_amount,
          }}
          balance={Number(payInvoice.balance)}
          onClose={() => setPayInvoice(null)}
          onSaved={() => { setPayInvoice(null); notify('Payment recorded'); reload(); }}
        />
      )}

      <RevertPaymentModal
        invoice={revertInvoice ? { id: revertInvoice.id, invoice_no: revertInvoice.invoice_no, vendor_name: vendor.name, payment_status: revertInvoice.payment_status } : null}
        onClose={() => setRevertInvoice(null)}
        onReverted={() => reload()}
      />
    </AppShell>
  );
}
