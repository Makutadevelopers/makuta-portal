import { useState, useMemo, useEffect, useRef, Fragment, FormEvent, ChangeEvent, DragEvent } from 'react';
import { useSites } from '../../hooks/useSites';
import { useSearchParams } from 'react-router-dom';
import { downloadAuthenticated } from '../../api/client';
import { useInvoices } from '../../hooks/useInvoices';
import { useAgingCalc } from '../../hooks/useAgingCalc';
import { useVendors } from '../../hooks/useVendors';
import { pushInvoice, undoPushInvoice, bulkFinalizeInvoices, bulkDeleteInvoices, getInvoiceHistory, AuditLogEntry, createInvoice, createInvoiceBatch, updateInvoice, deleteInvoice as deleteInvoiceApi, recomputeInvoiceStatuses, getInvoiceLineItems } from '../../api/invoices';
import { uploadAttachment, getAttachments, deleteAttachment, Attachment } from '../../api/attachments';
import { getPayments, updatePayment } from '../../api/payments';
import { bulkPayInvoices } from '../../api/reconciliation';
import { createVendor } from '../../api/vendors';
import { formatINR, formatINRPaisa, formatDate } from '../../utils/formatters';
import { PAYMENT_TYPES } from '../../utils/constants';
import CategorySelect from '../../components/shared/CategorySelect';
import BankSelect from '../../components/shared/BankSelect';
import { Invoice, InvoiceLineItem } from '../../types/invoice';
import { Payment } from '../../types/payment';
import AppShell from '../../components/layout/AppShell';
import BulkImportModal from '../../components/shared/BulkImportModal';
import AttachmentViewer from '../../components/shared/AttachmentViewer';
import DisputeModal from '../../components/shared/DisputeModal';
import ActionsMenu from '../../components/shared/ActionsMenu';
import PaymentModal from '../../components/shared/PaymentModal';
import RevertPaymentModal from '../../components/shared/RevertPaymentModal';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../context/ToastContext';
import { normaliseSearch, highlight, amountMatchesSearch } from '../../utils/searchHighlight';
import { computeInvoiceTotal, computeInvoiceTotalWithItems, LineItemDraft, makeLineItem } from '../../utils/invoiceMath';
import LineItemsEditor from '../../components/shared/LineItemsEditor';
import { CreateInvoiceData } from '../../types/invoice';
import { Vendor } from '../../types/vendor';
import { useStickyHeaderHeight } from '../../hooks/useStickyHeaderHeight';
import { useIsMobile } from '../../hooks/useIsMobile';
import { MobileCard, CardField } from '../../components/ui/MobileCard';
import { useTypeaheadKeyboard } from '../../hooks/useTypeaheadKeyboard';

// Render rows in batches so a multi-thousand-row list never paints all at once
// (that froze the browser). Search/filter/sort still run over the full set —
// only the number of rows committed to the DOM is windowed.
const INVOICE_PAGE_SIZE = 50;

export default function InvoiceList() {
  // Projects come from the DB-backed Project Master (HO manages them at
  // /projects). useSites falls back to the static seed list while the request
  // is in flight, so this dropdown is never empty.
  const { names: SITES } = useSites();
  const { invoices, loading, refresh, patchInvoice, removeInvoice } = useInvoices();
  const { withinTerms, overdue } = useAgingCalc();
  const { vendors } = useVendors();
  const [searchParams] = useSearchParams();

  const [showForm, setShowForm] = useState(false);
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [editInv, setEditInv] = useState<Invoice | null>(null);

  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [fSite, setFSite] = useState('All');
  const [fStatus, setFStatus] = useState('All');
  const [fPurpose, setFPurpose] = useState('All');
  const [fMonth, setFMonth] = useState('');
  const [fPaidMonth, setFPaidMonth] = useState('');
  const [fMissingInvNo, setFMissingInvNo] = useState(false);
  // Invoice-date filter: either a single month ('month') or a custom From–To
  // range ('range'). The Paid filter is separate (fPaidMonth).
  const [invMode, setInvMode] = useState<'month' | 'range'>('month');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<'invoice_date' | 'created_at' | 'last_paid_date'>('created_at');
  const [showFilters, setShowFilters] = useState(false);
  const [expandedEditId, setExpandedEditId] = useState<string | null>(null);
  // How many rows are committed to the DOM. "Show more" raises it; any change to
  // the filter/search/sort result snaps it back to the first page (effect below).
  const [visibleCount, setVisibleCount] = useState(INVOICE_PAGE_SIZE);

  // Sync search from URL query param
  useEffect(() => {
    const q = searchParams.get('search');
    if (q) setSearch(q);
  }, [searchParams]);

  // Reset the visible window to the top whenever the result set changes. Declared
  // BEFORE the ?focus effect (which lives just after the `filtered` memo, since it
  // reads `filtered`) so that, on a deep-linked mount, the focus effect's
  // window-bump runs last and wins.
  useEffect(() => {
    setVisibleCount(INVOICE_PAGE_SIZE);
  }, [search, fSite, fStatus, fPurpose, fMonth, fPaidMonth, fMissingInvNo, invMode, dateFrom, dateTo, sortBy]);

  // Selection state for bulk actions
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Payment modal state
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [revertInvoice, setRevertInvoice] = useState<Invoice | null>(null);
  const [showBulkPay, setShowBulkPay] = useState(false);
  // History panel state
  const [historyInvoice, setHistoryInvoice] = useState<Invoice | null>(null);
  const [historyPayments, setHistoryPayments] = useState<Payment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Attachment viewer
  const [docsInvoice, setDocsInvoice] = useState<Invoice | null>(null);
  const [disputeInvoice, setDisputeInvoice] = useState<Invoice | null>(null);
  // Invoice info/history panel
  const [infoInvoice, setInfoInvoice] = useState<Invoice | null>(null);
  const [infoHistory, setInfoHistory] = useState<AuditLogEntry[]>([]);
  const [infoLoading, setInfoLoading] = useState(false);
  const { notify } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const { ref: stickyHeaderRef, height: stickyHeaderHeight } = useStickyHeaderHeight();

  const agingMap = useMemo(() => {
    const map = new Map<string, { balance: number; daysLabel: string; daysNum: number }>();
    for (const r of overdue) {
      map.set(r.invoice_id, { balance: Number(r.balance), daysLabel: `${r.days_past_due}d`, daysNum: r.days_past_due });
    }
    for (const r of withinTerms) {
      map.set(r.invoice_id, { balance: Number(r.balance), daysLabel: `${r.days_left}d`, daysNum: -r.days_left });
    }
    return map;
  }, [withinTerms, overdue]);

  const filtered = useMemo(() => {
    // Two independent date filters:
    //   • Invoiced — by invoice date, as a single month OR a custom From–To range.
    //   • Paid — by the month of the latest payment (last_paid_date).
    // They combine, so you can ask for e.g. "invoiced in Feb, paid in Apr".
    // The Sort dropdown only reorders rows — it never changes which show.
    const result = invoices.filter(i => {
      if (fSite !== 'All' && i.site !== fSite) return false;
      if (fStatus !== 'All' && i.payment_status !== fStatus) return false;
      if (fPurpose !== 'All' && i.purpose !== fPurpose) return false;
      if (fMissingInvNo && (i.invoice_no ?? '').trim() !== '') return false;
      if (invMode === 'range') {
        const invDay = (i.invoice_date || '').slice(0, 10);
        if (dateFrom && invDay < dateFrom) return false;
        if (dateTo && invDay > dateTo) return false;
      } else if (fMonth) {
        const cmpMonth = (i.month || i.invoice_date || '').slice(0, 7);
        if (cmpMonth !== fMonth) return false;
      }
      if (fPaidMonth) {
        const paidMonth = (i.last_paid_date || '').slice(0, 7);
        if (paidMonth !== fPaidMonth) return false;
      }
      if (search) {
        const q = normaliseSearch(search);
        if (q) {
          const amount = Number(i.invoice_amount);
          const hay = [
            i.vendor_name,
            i.invoice_no,
            i.po_number,
            Number.isFinite(amount) ? amount.toString() : '',
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
      }
      return true;
    });
    if (sortBy === 'created_at') {
      result.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    } else if (sortBy === 'last_paid_date') {
      // Paid rows first (newest paid_date first); unpaid rows fall to the bottom,
      // then break ties by created_at desc so the ordering is stable.
      result.sort((a, b) => {
        const ap = (a.last_paid_date || '').slice(0, 10);
        const bp = (b.last_paid_date || '').slice(0, 10);
        if (ap && !bp) return -1;
        if (!ap && bp) return 1;
        const cmp = bp.localeCompare(ap);
        if (cmp !== 0) return cmp;
        return (b.created_at || '').localeCompare(a.created_at || '');
      });
    } else {
      result.sort((a, b) => {
        const cmp = (b.invoice_date || '').localeCompare(a.invoice_date || '');
        if (cmp !== 0) return cmp;
        return (b.created_at || '').localeCompare(a.created_at || '');
      });
    }
    return result;
  }, [invoices, fSite, fStatus, fPurpose, fMonth, fPaidMonth, fMissingInvNo, search, invMode, dateFrom, dateTo, sortBy]);

  // Only the first `visibleCount` rows are committed to the DOM; "Show more"
  // raises the window. Filtering/sorting/selection all still work over `filtered`.
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  const isMobile = useIsMobile();

  // Per-invoice status badges, docs cell, actions menu, and inline edit form are
  // shared verbatim between the desktop table cells and the mobile cards so the
  // two layouts stay in lockstep.
  const statusBadges = (inv: Invoice) => {
    const isPaid = inv.payment_status === 'Paid';
    const isPartial = inv.payment_status === 'Partial';
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          isPaid ? 'bg-green-50 text-green-700' : isPartial ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'
        }`}>{inv.payment_status}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
          inv.pushed ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'
        }`}>{inv.pushed ? 'Master' : 'Draft'}</span>
        {inv.minor_payment && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 text-orange-600">site</span>
        )}
        {inv.disputed && (
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
              inv.dispute_severity === 'major' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
            }`}
            title={inv.dispute_reason ?? ''}
          >
            Disputed · {inv.dispute_severity}
          </span>
        )}
      </div>
    );
  };

  const docsCell = (inv: Invoice) => (
    (inv.attachment_count ?? 0) > 0
      ? <button onClick={() => setDocsInvoice(inv)} className="text-xs font-medium text-blue-600 hover:underline" title={`${inv.attachment_count} file(s) — click to view`}>{inv.attachment_count} file{(inv.attachment_count ?? 0) > 1 ? 's' : ''}</button>
      : <span className="text-xs font-medium text-red-500">N/A</span>
  );

  const rowActionsMenu = (inv: Invoice) => {
    const isPaid = inv.payment_status === 'Paid';
    const isPartial = inv.payment_status === 'Partial';
    const isNotPaid = inv.payment_status === 'Not Paid';
    return (
      <ActionsMenu
        items={[
          ...(!inv.pushed ? [
            { label: 'Edit', color: 'text-gray-700', onClick: () => setExpandedEditId(expandedEditId === inv.id ? null : inv.id) },
            { label: 'Finalize', color: 'text-blue-600', onClick: () => handlePush(inv.id) },
            { label: 'Delete', color: 'text-red-500', onClick: () => handleDelete(inv) },
          ] : [
            { label: 'Undo Finalize', color: 'text-orange-600', onClick: () => handleUndo(inv.id) },
          ]),
          ...(isNotPaid ? [{ label: 'Mark Paid', color: 'text-green-600', onClick: () => setPayInvoice(inv) }] : []),
          ...(isPartial ? [
            { label: 'Add Payment', color: 'text-green-600', onClick: () => setPayInvoice(inv) },
            { label: 'Payment History', color: 'text-gray-600', onClick: () => openHistory(inv) },
          ] : []),
          ...(isPaid ? [{ label: 'Payment History', color: 'text-gray-600', onClick: () => openHistory(inv) }] : []),
          ...((isPaid || isPartial) ? [{ label: 'Mark as Not Paid', color: 'text-red-600', onClick: () => setRevertInvoice(inv) }] : []),
          { label: 'Info / Audit', color: 'text-purple-600', onClick: () => openInfo(inv) },
        ]}
      />
    );
  };

  const editForm = (inv: Invoice) => (
    <HOInvoiceForm
      key={inv.id}
      vendors={vendors}
      editInvoice={inv}
      onCancel={() => setExpandedEditId(null)}
      onSaved={() => { setExpandedEditId(null); notify('Invoice updated'); patchInvoice(inv.id); }}
    />
  );

  // ?focus=<id> auto-opens the inline edit form for that invoice — used by
  // VendorDetail's Edit action so HO doesn't have to find the row manually.
  // Lives here (not with the other mount effects) because it reads `filtered`.
  useEffect(() => {
    const focus = searchParams.get('focus');
    if (!focus || filtered.length === 0) return;
    const idx = filtered.findIndex(i => i.id === focus);
    if (idx === -1) return;
    setExpandedEditId(focus);
    // Make sure the target row is within the rendered window before scrolling.
    setVisibleCount(c => Math.max(c, idx + 1));
    // Scroll to it after the row renders.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-invoice-row="${focus}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [searchParams, filtered]);

  // Count of historical rows still missing an invoice number — surfaced as a
  // toggle chip in the filter row so HO can work through them. New entries
  // can't be created without one (server-side createInvoiceSchema enforces it).
  const missingInvNoCount = useMemo(
    () => invoices.filter(i => !(i.invoice_no ?? '').trim()).length,
    [invoices],
  );

  // Active-filter chips shown beneath the filter bar (excludes Search + Sort,
  // which stay as their own visible controls). Each chip can clear its filter.
  const fmtMonth = (ym: string): string => {
    const [y, m] = ym.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
  };
  const activeChips: { key: string; label: string; clear: () => void }[] = [];
  if (fSite !== 'All') activeChips.push({ key: 'site', label: `Site: ${fSite}`, clear: () => setFSite('All') });
  if (fStatus !== 'All') activeChips.push({ key: 'status', label: `Status: ${fStatus}`, clear: () => setFStatus('All') });
  if (fPurpose !== 'All') activeChips.push({ key: 'cat', label: `Category: ${fPurpose}`, clear: () => setFPurpose('All') });
  if (invMode === 'month' && fMonth) activeChips.push({ key: 'inv', label: `Invoiced: ${fmtMonth(fMonth)}`, clear: () => setFMonth('') });
  if (invMode === 'range' && (dateFrom || dateTo)) activeChips.push({ key: 'inv', label: `Invoiced: ${dateFrom ? formatDate(dateFrom) : '…'} – ${dateTo ? formatDate(dateTo) : '…'}`, clear: () => { setDateFrom(''); setDateTo(''); } });
  if (fPaidMonth) activeChips.push({ key: 'paid', label: `Paid: ${fmtMonth(fPaidMonth)}`, clear: () => setFPaidMonth('') });
  const clearAllFilters = () => {
    setFSite('All'); setFStatus('All'); setFPurpose('All');
    setFMonth(''); setDateFrom(''); setDateTo(''); setFPaidMonth('');
  };

  // The row checkbox drives two flows: bulk actions (finalize/pay) AND
  // Export. Bulk-action handlers below already re-filter the selection to
  // the rows they apply to (drafts only for finalize, unpaid only for pay),
  // so it's safe — and necessary for Export — to make every visible row
  // selectable, including Paid rows.
  const selectableIds = useMemo(
    () => filtered.map(i => i.id),
    [filtered]
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds));
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkFinalize() {
    // Bulk finalize only applies to draft (non-pushed) invoices — filter the selection.
    const draftIds = Array.from(selected).filter(id => {
      const inv = invoices.find(x => x.id === id);
      return inv && !inv.pushed;
    });
    if (draftIds.length === 0) { notify('No draft invoices in selection to finalize'); return; }
    const ids = draftIds;
    setBulkLoading(true);
    try {
      const result = await bulkFinalizeInvoices(ids);
      notify(`Finalized ${result.finalized} invoices`);
      setSelected(new Set());
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Bulk finalize failed');
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleBulkDelete() {
    // Bulk delete only applies to draft (non-pushed) invoices — finalized ones must be undone first.
    const draftIds = Array.from(selected).filter(id => {
      const inv = invoices.find(x => x.id === id);
      return inv && !inv.pushed;
    });
    const skipped = selected.size - draftIds.length;
    if (draftIds.length === 0) { notify('No draft invoices in selection to delete'); return; }
    const skippedNote = skipped > 0 ? `\n(${skipped} finalized invoice${skipped > 1 ? 's' : ''} will be skipped — undo finalization first to delete them.)` : '';
    const ok = await confirm({
      title: `Move ${draftIds.length} invoice${draftIds.length > 1 ? 's' : ''} to Bin?`,
      message: `You can restore from Bin within 30 days.${skippedNote}`,
      confirmLabel: 'Move to Bin',
      variant: 'danger',
    });
    if (!ok) return;
    setBulkLoading(true);
    try {
      const result = await bulkDeleteInvoices(draftIds);
      notify(`Moved ${result.deleted} invoice${result.deleted > 1 ? 's' : ''} to bin${skipped > 0 ? ` · ${skipped} skipped` : ''}`);
      setSelected(new Set());
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Bulk delete failed');
    } finally {
      setBulkLoading(false);
    }
  }

  async function handlePush(id: string) {
    await pushInvoice(id);
    notify('Invoice finalized');
    patchInvoice(id);
  }

  async function handleUndo(id: string) {
    await undoPushInvoice(id);
    notify('Finalization reverted');
    patchInvoice(id);
  }

  async function handleDelete(inv: Invoice) {
    const ok = await confirm({
      title: `Delete invoice #${inv.invoice_no}?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete invoice',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteInvoiceApi(inv.id);
      notify('Invoice deleted');
      removeInvoice(inv.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  const [recomputing, setRecomputing] = useState(false);
  async function handleRecomputeStatuses() {
    const ok = await confirm({
      title: 'Recompute payment statuses?',
      message: 'Re-derives Paid / Partial / Not Paid for every invoice from the underlying payments. Use this to heal rows where the badge looks wrong.',
      confirmLabel: 'Recompute',
      variant: 'primary',
    });
    if (!ok) return;
    setRecomputing(true);
    try {
      const r = await recomputeInvoiceStatuses();
      notify(r.changed > 0
        ? `Recomputed ${r.total} invoices · ${r.changed} status${r.changed === 1 ? '' : 'es'} corrected`
        : `Recomputed ${r.total} invoices · all already up to date`);
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Recompute failed');
    } finally {
      setRecomputing(false);
    }
  }

  async function openInfo(inv: Invoice) {
    setInfoInvoice(inv);
    setInfoLoading(true);
    try {
      const history = await getInvoiceHistory(inv.id);
      setInfoHistory(history);
    } catch { setInfoHistory([]); }
    setInfoLoading(false);
  }

  async function openHistory(inv: Invoice) {
    setHistoryInvoice(inv);
    setHistoryLoading(true);
    try {
      const payments = await getPayments(inv.id);
      setHistoryPayments(payments);
    } catch { setHistoryPayments([]); }
    setHistoryLoading(false);
  }

  return (
    <AppShell>
      {confirmDialog}
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-30 bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 -mt-4 sm:-mt-6 pt-4 sm:pt-6 pb-1 mb-4"
      >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="text-lg font-medium text-gray-900">All Invoices</div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(true)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Bulk Import
          </button>
          <ExportMenu
            buildPath={(format) => {
              const params = new URLSearchParams();
              params.set('format', format);
              // If the user has ticked specific rows, export ONLY those.
              // Otherwise fall back to the active filters / full table.
              if (selected.size > 0) {
                params.set('ids', Array.from(selected).join(','));
              } else {
                if (fSite !== 'All')    params.set('site', fSite);
                if (fStatus !== 'All')  params.set('status', fStatus);
                if (fPurpose !== 'All') params.set('category', fPurpose);
                if (search)             params.set('search', search);
                if (invMode === 'range') {
                  if (dateFrom)         params.set('from', dateFrom);
                  if (dateTo)           params.set('to', dateTo);
                } else if (fMonth)      params.set('month', fMonth);
                if (fPaidMonth)         params.set('paid_month', fPaidMonth);
                params.set('sort', sortBy);
              }
              return `/export/invoices?${params.toString()}`;
            }}
            selectedCount={selected.size}
            filterCount={
              (fSite !== 'All' ? 1 : 0) +
              (fStatus !== 'All' ? 1 : 0) +
              (fPurpose !== 'All' ? 1 : 0) +
              (search ? 1 : 0) +
              ((invMode === 'range' ? (dateFrom || dateTo) : fMonth) ? 1 : 0) +
              (fPaidMonth ? 1 : 0) +
              (fMissingInvNo ? 1 : 0)
            }
          />
          <button onClick={() => { setEditInv(null); setExpandedEditId(null); setShowBatchForm(false); setShowForm(true); }}
            className="px-4 py-2 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d]">
            + New Invoice
          </button>
          <button onClick={() => { setEditInv(null); setExpandedEditId(null); setShowForm(false); setShowBatchForm(true); }}
            title="Add multiple invoices against one vendor in one go"
            className="px-4 py-2 border border-[#1a3c5e] text-[#1a3c5e] text-sm font-medium rounded-lg hover:bg-[#1a3c5e]/5">
            + Add Many
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendor, invoice no, PO..."
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-200" />

          {/* Filters popover */}
          <div className="relative">
            <button type="button" onClick={() => setShowFilters(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors ${
                activeChips.length > 0 ? 'border-[#1a3c5e] text-[#1a3c5e] bg-[#1a3c5e]/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 12h12M10 20h4" />
              </svg>
              Filters
              {activeChips.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[11px] font-semibold text-white bg-[#1a3c5e] rounded-full">{activeChips.length}</span>
              )}
            </button>
            {showFilters && (
              <>
                <div className="fixed inset-0 z-40 bg-black/20 sm:bg-transparent" onClick={() => setShowFilters(false)} />
                <div className="fixed inset-x-2 bottom-2 z-50 w-auto max-h-[80vh] overflow-y-auto sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-11 sm:w-80 sm:max-h-none sm:overflow-visible bg-white border border-gray-200 rounded-xl shadow-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-gray-900">Filters</div>
                    {activeChips.length > 0 && (
                      <button onClick={clearAllFilters} className="text-xs text-gray-500 hover:text-gray-700 hover:underline">Clear all</button>
                    )}
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Site</span>
                    <select value={fSite} onChange={e => setFSite(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
                      <option value="All">All Sites</option>
                      {SITES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Status</span>
                    <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
                      <option value="All">All Statuses</option>
                      <option>Paid</option><option>Partial</option><option>Not Paid</option>
                    </select>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Category</span>
                    <CategorySelect
                      value={fPurpose}
                      onChange={setFPurpose}
                      includeAll
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Invoiced</span>
                    <div className="mt-1 flex items-center gap-1.5">
                      <select value={invMode} onChange={e => setInvMode(e.target.value as 'month' | 'range')}
                        className="px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600">
                        <option value="month">Month</option>
                        <option value="range">Range</option>
                      </select>
                      {invMode === 'month' ? (
                        <input type="month" value={fMonth} onChange={e => setFMonth(e.target.value)}
                          className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-200" />
                      ) : (
                        <div className="flex-1 min-w-0 flex items-center gap-1">
                          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Invoiced from"
                            className="flex-1 min-w-0 px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-200" />
                          <span className="text-xs text-gray-400">–</span>
                          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="Invoiced to"
                            className="flex-1 min-w-0 px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-200" />
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Paid</span>
                    <input type="month" value={fPaidMonth} onChange={e => setFPaidMonth(e.target.value)}
                      title="Filter by paid month (latest payment date)"
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  </div>
                  <div className="pt-1 flex justify-end">
                    <button onClick={() => setShowFilters(false)} className="px-4 py-1.5 text-sm font-medium bg-[#1a3c5e] text-white rounded-lg hover:bg-[#15304d]">Done</button>
                  </div>
                </div>
              </>
            )}
          </div>

          <select value={sortBy} onChange={e => setSortBy(e.target.value as 'invoice_date' | 'created_at' | 'last_paid_date')}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600"
            title="Sort order">
            <option value="created_at">Latest added first</option>
            <option value="invoice_date">Latest invoice date first</option>
            <option value="last_paid_date">Latest paid date first</option>
          </select>

          <div className="ml-auto flex items-center gap-3">
            {missingInvNoCount > 0 && (
              <button
                type="button"
                onClick={() => setFMissingInvNo(v => !v)}
                title="Historical rows imported before invoice_no became mandatory. Click to filter; edit each row to enter the real number."
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                  fMissingInvNo
                    ? 'bg-amber-100 border-amber-300 text-amber-800 hover:bg-amber-200'
                    : 'border-amber-200 text-amber-700 hover:bg-amber-50'
                }`}
              >
                Missing inv. no · {missingInvNoCount}
              </button>
            )}
            <button
              type="button"
              onClick={handleRecomputeStatuses}
              disabled={recomputing}
              title="Heal stale Paid / Partial / Not Paid badges by recomputing from the payments table"
              className="text-xs text-gray-500 hover:text-gray-700 hover:underline disabled:opacity-50 disabled:cursor-wait"
            >
              {recomputing ? 'Recomputing…' : 'Recompute statuses'}
            </button>
            <span className="text-xs text-gray-400">{filtered.length} records</span>
          </div>
        </div>

        {/* Active filter chips */}
        {activeChips.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mt-3">
            {activeChips.map(c => (
              <span key={c.key} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">
                {c.label}
                <button onClick={c.clear} title="Remove filter"
                  className="w-4 h-4 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-300">✕</button>
              </span>
            ))}
            <button onClick={clearAllFilters} className="text-xs text-gray-500 hover:text-gray-700 hover:underline ml-1">Clear all</button>
          </div>
        )}
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-2.5 py-2.5 bg-blue-50 rounded-lg border border-blue-100 flex-wrap">
          <span className="text-sm font-medium text-blue-800">{selected.size} invoice{selected.size > 1 ? 's' : ''} selected</span>
          <button onClick={handleBulkFinalize} disabled={bulkLoading}
            className="px-4 py-1.5 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d] disabled:opacity-50">
            {bulkLoading ? 'Finalizing...' : `Finalize ${selected.size}`}
          </button>
          <button onClick={() => setShowBulkPay(true)}
            className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
            Bulk Pay (1 Cheque / Txn)
          </button>
          <button onClick={handleBulkDelete} disabled={bulkLoading}
            className="px-4 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
            title="Move selected draft invoices to bin (finalized ones are skipped)">
            Delete {selected.size}
          </button>
          {selected.size === 1 && (() => {
            const inv = invoices.find(i => selected.has(i.id));
            if (!inv) return null;
            return (
              <button
                onClick={() => setDisputeInvoice(inv)}
                className={`px-4 py-1.5 text-white text-sm font-medium rounded-lg ${
                  inv.disputed ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                }`}
                title={inv.disputed ? `Clear dispute on #${inv.invoice_no}` : `Raise dispute on #${inv.invoice_no}`}
              >
                {inv.disputed ? 'Clear Dispute' : 'Raise Dispute'}
              </button>
            );
          })()}
          <button onClick={() => setSelected(new Set())} className="text-sm text-gray-500 hover:text-gray-700">Clear</button>
        </div>
      )}
      </div>

      {/* Bulk Pay Modal */}
      {showBulkPay && (
        <BulkPayModal
          invoices={invoices.filter(i => selected.has(i.id))}
          agingMap={agingMap}
          onClose={() => setShowBulkPay(false)}
          onSaved={() => {
            setShowBulkPay(false);
            setSelected(new Set());
            notify('Bulk payment recorded');
            refresh();
          }}
        />
      )}

      {/* New Invoice Form (above table) */}
      {showForm && !editInv && (
        <HOInvoiceForm
          key="new"
          vendors={vendors}
          editInvoice={null}
          onCancel={() => { setShowForm(false); }}
          onSaved={() => { setShowForm(false); notify('Invoice added'); refresh(); }}
        />
      )}

      {/* Batch Invoice Form (above table) */}
      {showBatchForm && (
        <HOInvoiceBatchForm
          vendors={vendors}
          onCancel={() => setShowBatchForm(false)}
          onSaved={(created) => {
            notify(`${created} invoice${created === 1 ? '' : 's'} added`);
            refresh();
            setShowBatchForm(false);
          }}
        />
      )}

      {/* Bulk Import Modal */}
      {showImport && (
        <BulkImportModal
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); refresh(); }}
        />
      )}

      {/* Payment Modal */}
      {payInvoice && (
        <PaymentModal
          invoice={payInvoice}
          balance={agingMap.get(payInvoice.id)?.balance ?? Number(payInvoice.invoice_amount)}
          onClose={() => setPayInvoice(null)}
          onSaved={() => { const id = payInvoice.id; setPayInvoice(null); notify('Payment recorded'); patchInvoice(id); }}
        />
      )}

      <RevertPaymentModal
        invoice={revertInvoice}
        onClose={() => setRevertInvoice(null)}
        onReverted={(id) => patchInvoice(id)}
      />

      {/* Attachment Viewer */}
      {docsInvoice && (
        <AttachmentViewer
          invoiceId={docsInvoice.id}
          invoiceNo={docsInvoice.invoice_no}
          onClose={() => setDocsInvoice(null)}
        />
      )}

      {/* Dispute modal */}
      {disputeInvoice && (
        <DisputeModal
          invoice={disputeInvoice}
          onClose={() => setDisputeInvoice(null)}
          onDone={() => {
            const wasDisputed = disputeInvoice.disputed;
            const id = disputeInvoice.id;
            setDisputeInvoice(null);
            notify(wasDisputed ? 'Dispute cleared' : 'Invoice disputed');
            patchInvoice(id);
          }}
        />
      )}

      {/* Invoice Info / Audit History */}
      {infoInvoice && (
        <InvoiceInfoPanel
          invoice={infoInvoice}
          history={infoHistory}
          loading={infoLoading}
          onClose={() => setInfoInvoice(null)}
        />
      )}

      {/* Payment History */}
      {historyInvoice && (
        <PaymentHistoryPanel
          invoice={historyInvoice}
          payments={historyPayments}
          loading={historyLoading}
          onClose={() => setHistoryInvoice(null)}
          onAddPayment={() => { setHistoryInvoice(null); setPayInvoice(historyInvoice); }}
          onPaymentChanged={async () => {
            const inv = historyInvoice;
            if (!inv) return;
            try {
              const fresh = await getPayments(inv.id);
              setHistoryPayments(fresh);
            } catch { /* leave stale */ }
            patchInvoice(inv.id);
          }}
        />
      )}

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
      ) : isMobile ? (
        <div className="space-y-2">
          {selectableIds.length > 0 && (
            <label className="flex items-center gap-2 px-1 pb-1 text-xs text-gray-500">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="rounded border-gray-300 text-[#1a3c5e] focus:ring-blue-200"
              />
              Select all drafts ({selectableIds.length})
            </label>
          )}
          {visible.map(inv => {
            const aging = agingMap.get(inv.id);
            const isPaid = inv.payment_status === 'Paid';
            const isOverdue = aging && aging.daysNum > 0;
            return (
              <Fragment key={inv.id}>
                <MobileCard
                  selected={selected.has(inv.id)}
                  accentClass={inv.disputed ? (inv.dispute_severity === 'major' ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-amber-400') : ''}
                  header={
                    <>
                      <div className="flex items-start gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={selected.has(inv.id)}
                          onChange={() => toggleSelect(inv.id)}
                          className="mt-0.5 rounded border-gray-300 text-[#1a3c5e] focus:ring-blue-200"
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate" title={inv.vendor_name}>{highlight(inv.vendor_name, search)}</div>
                          <div className="text-[11px] text-gray-400 truncate">
                            {inv.invoice_no ? highlight(inv.invoice_no, search) : '—'} · {inv.site}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-1.5 flex-shrink-0">
                        <div className="text-right">
                          <div className="font-semibold text-gray-900">{formatINR(Number(inv.invoice_amount))}</div>
                          {Number(inv.allocated_credits ?? 0) > 0 && (
                            <div className="text-[10px] text-purple-600">− CN {formatINR(Number(inv.allocated_credits))}</div>
                          )}
                        </div>
                        {rowActionsMenu(inv)}
                      </div>
                    </>
                  }
                >
                  {statusBadges(inv)}
                  <CardField label="Invoice date" value={formatDate(inv.invoice_date)} />
                  {inv.last_paid_date && <CardField label="Paid date" value={formatDate(inv.last_paid_date)} />}
                  {inv.po_number && <CardField label="PO no" value={inv.po_number} />}
                  <CardField label="Category" value={inv.purpose} />
                  {!isPaid && aging && (
                    <>
                      <CardField label="Balance" value={formatINR(aging.balance)} valueClass="text-red-600 font-medium" />
                      <CardField label="Days" value={aging.daysLabel} valueClass={isOverdue ? 'text-red-600' : 'text-green-600'} />
                    </>
                  )}
                  <CardField label="Docs" value={docsCell(inv)} />
                </MobileCard>
                {expandedEditId === inv.id && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-3">
                    {editForm(inv)}
                  </div>
                )}
              </Fragment>
            );
          })}
          {filtered.length === 0 && (
            <div className="py-10 text-center text-gray-400 text-sm">No invoices match your filters.</div>
          )}
          {visible.length < filtered.length && (
            <div className="pt-2 text-center">
              <button
                onClick={() => setVisibleCount(c => c + INVOICE_PAGE_SIZE)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-[#1a3c5e] hover:bg-gray-50"
              >
                Show {Math.min(INVOICE_PAGE_SIZE, filtered.length - visible.length)} more
              </button>
              <div className="mt-2 text-xs text-gray-400">Showing {visible.length} of {filtered.length}</div>
            </div>
          )}
        </div>
      ) : (
        <div
          className="bg-white rounded-xl border border-gray-100 overflow-y-auto overflow-x-hidden"
          style={{ maxHeight: `calc(100vh - ${stickyHeaderHeight + 120}px)` }}
        >
          <table className="w-full table-fixed text-[13px]">
            {/* Fixed proportional widths (sum 100%) so the table can never exceed
                the container width — no horizontal scroll. Text columns truncate. */}
            <colgroup>
              <col style={{ width: '3%' }} />{/* checkbox */}
              <col style={{ width: '7%' }} />{/* Invoice Date */}
              <col style={{ width: '7%' }} />{/* Paid Date */}
              <col style={{ width: '12%' }} />{/* Vendor */}
              <col style={{ width: '9%' }} />{/* Inv. No */}
              <col style={{ width: '7%' }} />{/* PO No */}
              <col style={{ width: '9%' }} />{/* Category */}
              <col style={{ width: '6%' }} />{/* Site */}
              <col style={{ width: '9%' }} />{/* Amount */}
              <col style={{ width: '8%' }} />{/* Balance */}
              <col style={{ width: '4%' }} />{/* Days */}
              <col style={{ width: '11%' }} />{/* Status */}
              <col style={{ width: '4%' }} />{/* Docs */}
              <col style={{ width: '4%' }} />{/* Actions */}
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                <th
                  className="px-2.5 py-2.5 w-8 bg-gray-50 sticky top-0 z-20 border-b border-gray-100"
                >
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                    className="rounded border-gray-300 text-[#1a3c5e] focus:ring-blue-200"
                    title="Select all draft invoices" />
                </th>
                {['Invoice Date', 'Paid Date', 'Vendor', 'Inv. No', 'PO No', 'Category', 'Site', 'Amount', 'Balance', 'Days', 'Status', 'Docs', 'Actions'].map(h => (
                  <th
                    key={h}
                    className={`px-2.5 py-2.5 font-medium text-gray-500 whitespace-nowrap bg-gray-50 sticky top-0 z-20 border-b border-gray-100 ${h === 'Amount' || h === 'Balance' ? 'text-right' : 'text-left'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(inv => {
                const aging = agingMap.get(inv.id);
                const isPaid = inv.payment_status === 'Paid';
                const isOverdue = aging && aging.daysNum > 0;

                return (
                  <Fragment key={inv.id}>
                    <tr data-invoice-row={inv.id} className={`border-t border-gray-50 hover:bg-gray-50/50 ${selected.has(inv.id) ? 'bg-blue-50/50' : ''} ${inv.disputed ? (inv.dispute_severity === 'major' ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-amber-400') : ''}`}>
                      <td className="px-2.5 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(inv.id)}
                          onChange={() => toggleSelect(inv.id)}
                          className="rounded border-gray-300 text-[#1a3c5e] focus:ring-blue-200"
                        />
                      </td>
                      <td className="px-2.5 py-3 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                      <td className="px-2.5 py-3 whitespace-nowrap text-gray-600">
                        {inv.last_paid_date ? formatDate(inv.last_paid_date) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-2.5 py-3 font-medium text-gray-900 truncate" title={inv.vendor_name}>{highlight(inv.vendor_name, search)}</td>
                      <td className="px-2.5 py-3 truncate" title={inv.invoice_no ?? ''}>{highlight(inv.invoice_no, search)}</td>
                      <td className="px-2.5 py-3 text-gray-500 truncate" title={inv.po_number ?? ''}>{inv.po_number ? highlight(inv.po_number, search) : '—'}</td>
                      <td className="px-2.5 py-3 text-gray-500 truncate" title={inv.purpose}>{inv.purpose}</td>
                      <td className="px-2.5 py-3 truncate" title={inv.site}>{inv.site}</td>
                      <td className={`px-2.5 py-3 text-right font-medium ${amountMatchesSearch(Number(inv.invoice_amount), search) ? 'bg-yellow-100' : ''}`}>
                        {formatINR(Number(inv.invoice_amount))}
                        {Number(inv.allocated_credits ?? 0) > 0 && (
                          <div className="text-[10px] font-normal text-purple-600" title={`Credit note applied: ₹${Number(inv.allocated_credits).toLocaleString('en-IN')}`}>
                            − CN {formatINR(Number(inv.allocated_credits))}
                          </div>
                        )}
                      </td>
                      <td className="px-2.5 py-3 text-right">
                        {isPaid ? <span className="text-green-600">—</span>
                          : aging ? <span className="font-medium text-red-600">{formatINR(aging.balance)}</span>
                            : '—'}
                      </td>
                      <td className="px-2.5 py-3">
                        {isPaid ? <span className="text-green-600">—</span>
                          : aging ? <span className={`text-xs font-medium ${isOverdue ? 'text-red-600' : 'text-green-600'}`}>{aging.daysLabel}</span>
                            : '—'}
                      </td>
                      <td className="px-2.5 py-3">
                        {statusBadges(inv)}
                      </td>
                      <td className="px-2.5 py-3 text-center">
                        {docsCell(inv)}
                      </td>
                      <td className="px-2.5 py-3">
                        {rowActionsMenu(inv)}
                      </td>
                    </tr>
                    {expandedEditId === inv.id && (
                      <tr className="border-t border-blue-100 bg-blue-50/30">
                        <td colSpan={14} className="px-2 py-4">
                          {editForm(inv)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={14} className="px-4 py-10 text-center text-gray-400 text-sm">No invoices match your filters.</td></tr>
              )}
              {visible.length < filtered.length && (
                <tr>
                  <td colSpan={14} className="px-4 py-4 text-center">
                    <button
                      onClick={() => setVisibleCount(c => c + INVOICE_PAGE_SIZE)}
                      className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-[#1a3c5e] hover:bg-gray-50"
                    >
                      Show {Math.min(INVOICE_PAGE_SIZE, filtered.length - visible.length)} more
                    </button>
                    <div className="mt-2 text-xs text-gray-400">Showing {visible.length} of {filtered.length}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}


// ── Invoice Info Panel ─────────────────────────────────────────────────────
function InvoiceInfoPanel({ invoice, history, loading, onClose }: {
  invoice: Invoice; history: AuditLogEntry[]; loading: boolean; onClose: () => void;
}) {
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  useEffect(() => {
    getInvoiceLineItems(invoice.id).then(setLineItems).catch(() => {});
  }, [invoice.id]);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl mx-4 p-4 sm:p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-base font-medium text-gray-900">Invoice Details</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {invoice.vendor_name} · #{invoice.invoice_no}
              {invoice.internal_no && <span className="ml-2 font-mono text-purple-600">{invoice.internal_no}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&#10005;</button>
        </div>

        {/* Invoice summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 text-sm">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500">Internal No</div>
            <div className="font-mono font-medium text-purple-700">{invoice.internal_no ?? '—'}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500">Total Amount</div>
            <div className="font-medium">{formatINR(Number(invoice.invoice_amount))}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500">Status</div>
            <div className="font-medium">{invoice.pushed ? 'Finalized' : 'Draft'}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500">Created</div>
            <div className="font-medium">{formatDate(invoice.created_at)}</div>
          </div>
        </div>

        {/* Amount breakdown — base, GST split, additional charge, total */}
        {(() => {
          const base = Number(invoice.base_amount ?? invoice.invoice_amount);
          const cgstPct = Number(invoice.cgst_pct ?? 0);
          const sgstPct = Number(invoice.sgst_pct ?? 0);
          const igstPct = Number(invoice.igst_pct ?? 0);
          const cgstAmt = +(base * cgstPct / 100).toFixed(2);
          const sgstAmt = +(base * sgstPct / 100).toFixed(2);
          const igstAmt = +(base * igstPct / 100).toFixed(2);
          const addCharge = Number(invoice.additional_charge ?? 0);
          const addCgstPct = Number(invoice.additional_charge_cgst_pct ?? 0);
          const addSgstPct = Number(invoice.additional_charge_sgst_pct ?? 0);
          const addIgstPct = Number(invoice.additional_charge_igst_pct ?? 0);
          const addCgstAmt = +(addCharge * addCgstPct / 100).toFixed(2);
          const addSgstAmt = +(addCharge * addSgstPct / 100).toFixed(2);
          const addIgstAmt = +(addCharge * addIgstPct / 100).toFixed(2);
          const total = Number(invoice.invoice_amount);
          const hasTax = cgstPct > 0 || sgstPct > 0 || igstPct > 0;
          const hasItems = lineItems.length > 0;
          // Legacy single additional_charge is only shown when there are no
          // detailed line-item rows (new invoices store the breakdown there).
          const hasAddCharge = !hasItems && addCharge > 0;
          if (!hasTax && !hasAddCharge && !hasItems && Math.abs(base - total) < 0.01) return null;
          return (
            <div className="mb-5">
              <div className="text-sm font-medium text-gray-900 mb-2">Amount Breakdown</div>
              <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-100">
                <table className="w-full text-[13px]">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Component</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Rate</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-800">Taxable Value (Base)</td>
                      <td className="px-3 py-2 text-right text-gray-400">—</td>
                      <td className="px-3 py-2 text-right font-medium">{formatINR(base)}</td>
                    </tr>
                    {cgstPct > 0 && (
                      <tr className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-700">Central Tax (CGST)</td>
                        <td className="px-3 py-2 text-right text-gray-600">{cgstPct.toFixed(2)} %</td>
                        <td className="px-3 py-2 text-right">{formatINR(cgstAmt)}</td>
                      </tr>
                    )}
                    {sgstPct > 0 && (
                      <tr className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-700">State/UT Tax (SGST)</td>
                        <td className="px-3 py-2 text-right text-gray-600">{sgstPct.toFixed(2)} %</td>
                        <td className="px-3 py-2 text-right">{formatINR(sgstAmt)}</td>
                      </tr>
                    )}
                    {igstPct > 0 && (
                      <tr className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-700">Integrated Tax (IGST)</td>
                        <td className="px-3 py-2 text-right text-gray-600">{igstPct.toFixed(2)} %</td>
                        <td className="px-3 py-2 text-right">{formatINR(igstAmt)}</td>
                      </tr>
                    )}
                    {hasItems && lineItems.map((li, i) => {
                      const amt = Number(li.amount);
                      const liCgst = +(amt * Number(li.cgst_pct) / 100).toFixed(2);
                      const liSgst = +(amt * Number(li.sgst_pct) / 100).toFixed(2);
                      const liIgst = +(amt * Number(li.igst_pct) / 100).toFixed(2);
                      return (
                        <Fragment key={li.id ?? i}>
                          <tr className="border-t border-gray-100 bg-amber-50/40">
                            <td className="px-3 py-2 text-gray-800">
                              {li.description || `Additional item ${i + 1}`}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-400">—</td>
                            <td className="px-3 py-2 text-right font-medium">{formatINR(amt)}</td>
                          </tr>
                          {Number(li.cgst_pct) > 0 && (
                            <tr className="border-t border-gray-100 bg-amber-50/40">
                              <td className="px-3 py-2 pl-6 text-gray-600">CGST</td>
                              <td className="px-3 py-2 text-right text-gray-600">{Number(li.cgst_pct).toFixed(2)} %</td>
                              <td className="px-3 py-2 text-right">{formatINR(liCgst)}</td>
                            </tr>
                          )}
                          {Number(li.sgst_pct) > 0 && (
                            <tr className="border-t border-gray-100 bg-amber-50/40">
                              <td className="px-3 py-2 pl-6 text-gray-600">SGST</td>
                              <td className="px-3 py-2 text-right text-gray-600">{Number(li.sgst_pct).toFixed(2)} %</td>
                              <td className="px-3 py-2 text-right">{formatINR(liSgst)}</td>
                            </tr>
                          )}
                          {Number(li.igst_pct) > 0 && (
                            <tr className="border-t border-gray-100 bg-amber-50/40">
                              <td className="px-3 py-2 pl-6 text-gray-600">IGST</td>
                              <td className="px-3 py-2 text-right text-gray-600">{Number(li.igst_pct).toFixed(2)} %</td>
                              <td className="px-3 py-2 text-right">{formatINR(liIgst)}</td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {hasAddCharge && (
                      <>
                        <tr className="border-t border-gray-100 bg-amber-50/40">
                          <td className="px-3 py-2 text-gray-800">
                            Additional Charge
                            {invoice.additional_charge_reason && (
                              <span className="text-xs text-gray-500 ml-1">— {invoice.additional_charge_reason}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-400">—</td>
                          <td className="px-3 py-2 text-right font-medium">{formatINR(addCharge)}</td>
                        </tr>
                        {addCgstPct > 0 && (
                          <tr className="border-t border-gray-100 bg-amber-50/40">
                            <td className="px-3 py-2 pl-6 text-gray-600">CGST on Additional Charge</td>
                            <td className="px-3 py-2 text-right text-gray-600">{addCgstPct.toFixed(2)} %</td>
                            <td className="px-3 py-2 text-right">{formatINR(addCgstAmt)}</td>
                          </tr>
                        )}
                        {addSgstPct > 0 && (
                          <tr className="border-t border-gray-100 bg-amber-50/40">
                            <td className="px-3 py-2 pl-6 text-gray-600">SGST on Additional Charge</td>
                            <td className="px-3 py-2 text-right text-gray-600">{addSgstPct.toFixed(2)} %</td>
                            <td className="px-3 py-2 text-right">{formatINR(addSgstAmt)}</td>
                          </tr>
                        )}
                        {addIgstPct > 0 && (
                          <tr className="border-t border-gray-100 bg-amber-50/40">
                            <td className="px-3 py-2 pl-6 text-gray-600">IGST on Additional Charge</td>
                            <td className="px-3 py-2 text-right text-gray-600">{addIgstPct.toFixed(2)} %</td>
                            <td className="px-3 py-2 text-right">{formatINR(addIgstAmt)}</td>
                          </tr>
                        )}
                      </>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 bg-white">
                      <td className="px-3 py-2 font-medium text-gray-900" colSpan={2}>Total Value</td>
                      <td className="px-3 py-2 text-right font-semibold text-[#1a3c5e]">{formatINR(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );
        })()}

        {/* Activity log */}
        <div className="text-sm font-medium text-gray-900 mb-3">Activity Log</div>
        {loading ? (
          <div className="text-gray-500 text-sm py-6 text-center">Loading...</div>
        ) : history.length === 0 ? (
          <div className="text-gray-400 text-sm py-6 text-center">No activity recorded yet.</div>
        ) : (
          <div className="space-y-3">
            {history.map(log => (
              <div key={log.id} className="flex items-start gap-3 border-l-2 border-purple-200 pl-3 py-1">
                <div className="flex-1">
                  <div className="text-sm text-gray-900">{log.action}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    by <span className="font-medium text-gray-700">{log.user_name}</span> on {new Date(log.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Payment History Panel ───────────────────────────────────────────────────
function PaymentHistoryPanel({ invoice, payments, loading, onClose, onAddPayment, onPaymentChanged }: {
  invoice: Invoice;
  payments: Payment[];
  loading: boolean;
  onClose: () => void;
  onAddPayment: () => void;
  onPaymentChanged: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<Payment | null>(null);
  const totalCash = payments.reduce((s, p) => s + Number(p.amount), 0);
  const totalTds = payments.reduce((s, p) => s + Number(p.tds_amount ?? 0), 0);
  const totalGstTds = payments.reduce((s, p) => s + Number(p.gst_tds_amount ?? 0), 0);
  const totalWithheld = totalTds + totalGstTds;
  const totalPaid = totalCash + totalWithheld;
  const rawBalance = Number(invoice.invoice_amount) - totalPaid;
  // Paisa shortfalls (≤ ₹1) are GST rounding noise, not real balance —
  // match the server's payment_status tolerance (see payment.service.ts).
  const balance = rawBalance <= 1 ? 0 : rawBalance;
  const hasAnyTds = totalWithheld > 0;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-3xl mx-4 p-4 sm:p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-base font-medium text-gray-900">Payment History</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {invoice.vendor_name} · #{invoice.invoice_no} · Invoice {formatINR(Number(invoice.invoice_amount))}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&#10005;</button>
        </div>

        {loading ? (
          <div className="text-gray-500 text-sm py-8 text-center">Loading...</div>
        ) : payments.length === 0 ? (
          <div className="text-gray-400 text-sm py-8 text-center">No payments recorded yet.</div>
        ) : (
          <table className="w-full text-[13px] mb-4">
            <thead className="bg-gray-50">
              <tr>
                {(hasAnyTds
                  ? ['Payment Date', 'Cash', 'Withheld', 'Type', 'Reference', 'Bank', '']
                  : ['Payment Date', 'Amount', 'Type', 'Reference', 'Bank', '']
                ).map((h, i) => (
                  <th key={i} className={`px-2.5 py-2.5 font-medium text-gray-500 ${h === 'Amount' || h === 'Cash' || h === 'Withheld' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map(p => {
                const tdsAmt = Number(p.tds_amount ?? 0);
                const tdsPct = Number(p.tds_pct ?? 0);
                const gstTdsAmt = Number(p.gst_tds_amount ?? 0);
                const gstTdsPct = Number(p.gst_tds_pct ?? 0);
                const gstAddedAmt = Number(p.gst_added_amount ?? 0);
                const gstAddedPct = Number(p.gst_added_pct ?? 0);
                return (
                  <tr key={p.id} className="border-t border-gray-50">
                    <td className="px-2.5 py-3 whitespace-nowrap">{formatDate(p.payment_date)}</td>
                    <td className="px-2.5 py-3 text-right font-medium text-green-700">
                      {formatINR(Number(p.amount))}
                      {gstAddedAmt > 0 && (
                        <div className="text-[10px] font-normal text-green-600" title="GST added on top of the invoice (extra cash to vendor)">+{formatINR(gstAddedAmt)} GST {gstAddedPct}%</div>
                      )}
                    </td>
                    {hasAnyTds && (
                      <td className="px-2.5 py-3 text-right">
                        {tdsAmt > 0 || gstTdsAmt > 0 ? (
                          <span className="font-medium text-amber-700 space-y-0.5">
                            {tdsAmt > 0 && <div>{formatINR(tdsAmt)} <span className="text-[10px] text-gray-400 font-normal">TDS {tdsPct}%</span></div>}
                            {gstTdsAmt > 0 && <div>{formatINR(gstTdsAmt)} <span className="text-[10px] text-gray-400 font-normal">GST-TDS {gstTdsPct}%</span></div>}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                    )}
                    <td className="px-2.5 py-3">{p.payment_type}</td>
                    <td className="px-2.5 py-3 text-gray-500">{p.payment_ref || '—'}</td>
                    <td className="px-2.5 py-3 text-gray-500">{p.bank || '—'}</td>
                    <td className="px-2.5 py-3 text-right">
                      <button
                        onClick={() => setEditing(p)}
                        className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50">
              <tr>
                <td className="px-2.5 py-2.5 font-medium text-gray-900">{hasAnyTds ? 'Totals' : 'Total Paid'}</td>
                <td className="px-2.5 py-2.5 text-right font-semibold text-green-700">{formatINR(totalCash)}</td>
                {hasAnyTds && (
                  <td className="px-2.5 py-2.5 text-right font-semibold text-amber-700">{formatINR(totalWithheld)}</td>
                )}
                <td colSpan={4} className="px-2.5 py-2.5 text-right text-sm">
                  {balance > 0
                    ? <span className="text-red-600 font-medium">Balance remaining: {formatINR(balance)}</span>
                    : <span className="text-green-600 font-medium">Fully settled{hasAnyTds ? ` (Cash ${formatINR(totalCash)} + Withheld ${formatINR(totalWithheld)})` : ''}</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        <div className="flex items-center gap-3">
          {balance > 0 && (
            <button onClick={onAddPayment} className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
              Add Payment
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Close</button>
        </div>

        {editing && (
          <EditPaymentModal
            invoice={invoice}
            payment={editing}
            otherPaid={payments.filter(x => x.id !== editing.id).reduce((s, p) => s + Number(p.amount) + Number(p.tds_amount ?? 0) + Number(p.gst_tds_amount ?? 0), 0)}
            onClose={() => setEditing(null)}
            onSaved={async () => { setEditing(null); await onPaymentChanged(); }}
          />
        )}
      </div>
    </div>
  );
}

// ── Edit Payment Modal ──────────────────────────────────────────────────────
function EditPaymentModal({ invoice, payment, otherPaid, onClose, onSaved }: {
  invoice: Invoice;
  payment: Payment;
  otherPaid: number;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { notify } = useToast();
  const invoiceAmount = Number(invoice.invoice_amount);
  // TDS is computed off the pre-GST taxable base (Sec. 194C); fall back to
  // invoice_amount for legacy rows without a tax split.
  const tdsBase = Number(invoice.base_amount ?? invoice.invoice_amount);
  const headroom = invoiceAmount - otherPaid;

  // Some legacy rows have payment_type like "Chq 000968" (type+ref smushed
   // by an old import bug — see server diagnostics F7). The dropdown can't
   // match that value, so editing the payment would silently re-save the
   // corrupted string. Strip to the leading token and map known aliases.
  const normalizePaymentType = (raw: string): string => {
    const prefix = (raw ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const alias: Record<string, string> = {
      chq: 'Cheque', cheque: 'Cheque',
      neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', upi: 'UPI', cash: 'Cash',
    };
    return alias[prefix] ?? raw;
  };
  const initialPaymentType = normalizePaymentType(payment.payment_type);
  const looksCorrupted = initialPaymentType !== payment.payment_type;
  const initialPaymentRef = payment.payment_ref ??
    (looksCorrupted
      ? (payment.payment_type.trim().split(/\s+/).slice(1).join(' ').trim() || '')
      : '');

  const [amount, setAmount] = useState(String(payment.amount));
  const [paymentType, setPaymentType] = useState(initialPaymentType);
  const [paymentRef, setPaymentRef] = useState(initialPaymentRef);
  const [paymentDate, setPaymentDate] = useState(String(payment.payment_date).slice(0, 10));
  const [bank, setBank] = useState(payment.bank ?? '');
  const [tdsPct, setTdsPct] = useState(String(payment.tds_pct ?? 0));
  // "Add GST" — extra cash to the vendor on top of the invoice, on the taxable
  // base. Not a withholding; not part of settlement. Mirrors PaymentModal.
  const [gstAddedPct, setGstAddedPct] = useState(String(payment.gst_added_pct ?? 0));
  const [saving, setSaving] = useState(false);

  const numAmount = Number(amount) || 0;
  const numTdsPct = Math.max(0, Math.min(10, Number(tdsPct) || 0));
  const tdsAmount = Math.round(tdsBase * numTdsPct) / 100;
  const numGstAddedPct = Math.max(0, Math.min(28, Number(gstAddedPct) || 0));
  const gstAddedAmount = Math.round(tdsBase * numGstAddedPct) / 100;
  // Settlement excludes added GST (cash + TDS only).
  const settlement = numAmount + tdsAmount;
  const overHeadroom = settlement > headroom + 0.001;

  async function handleSubmit() {
    if (settlement <= 0) { notify('Amount or TDS must be greater than 0'); return; }
    if (overHeadroom) {
      notify(`Cash + TDS exceeds invoice headroom of ${formatINRPaisa(headroom)}`);
      return;
    }
    if (numAmount > 0 && paymentType !== 'Cash' && !paymentRef.trim()) {
      notify('Reference / TXN no is required for non-cash payments');
      return;
    }
    setSaving(true);
    try {
      await updatePayment(invoice.id, payment.id, {
        amount: numAmount,
        payment_type: paymentType,
        payment_ref: paymentType === 'Cash' ? null : paymentRef.trim(),
        payment_date: paymentDate,
        bank: paymentType === 'Cash' ? null : (bank.trim() || null),
        tds_pct: numTdsPct,
        gst_added_pct: numGstAddedPct,
      });
      notify('Payment updated');
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update payment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-lg mx-4 p-4 sm:p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-base font-medium text-gray-900">Edit Payment</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Headroom available: <span className="font-medium">{formatINRPaisa(headroom)}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&#10005;</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Cash Paid *</label>
            <input
              type="number" step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            {overHeadroom && <div className="text-xs text-red-600 mt-1">Cash + TDS exceeds invoice headroom</div>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1" title="Income-tax TDS withheld (Sec. 194C). Computed on the pre-GST base amount.">TDS %</label>
            <input
              type="number" step="0.01" min="0" max="10" value={tdsPct}
              onChange={e => setTdsPct(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            {numTdsPct > 0 && (
              <div className="text-[11px] text-amber-700 mt-1">TDS amount: {formatINR(tdsAmount)} ({numTdsPct}% of {formatINR(tdsBase)} base)</div>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1" title="GST added to the vendor payment (extra cash on top of the invoice). Computed on the invoice's taxable base — the same base as TDS.">Add GST %</label>
            <input
              type="number" step="0.01" min="0" max="28" value={gstAddedPct}
              onChange={e => setGstAddedPct(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            {numGstAddedPct > 0 && (
              <div className="text-[11px] text-green-700 mt-1">GST added: +{formatINR(gstAddedAmount)} ({numGstAddedPct}% of {formatINR(Math.max(0, tdsBase))} base)</div>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Payment Date</label>
            <input
              type="date" value={paymentDate}
              onChange={e => setPaymentDate(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Payment Type</label>
            <select value={paymentType} onChange={e => setPaymentType(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white">
              {PAYMENT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          {paymentType !== 'Cash' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Reference / TXN No *</label>
              <input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="Cheque / TXN number"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </div>
          )}
          {paymentType !== 'Cash' && (
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Bank</label>
              <BankSelect
                value={bank}
                onChange={setBank}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={handleSubmit} disabled={saving || numAmount <= 0 || overHeadroom}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── HO Invoice Form ────────────────────────────────────────────────────────

function HOInvoiceForm({ vendors, editInvoice, onCancel, onSaved }: {
  vendors: Vendor[];
  editInvoice: Invoice | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // Projects come from the DB-backed Project Master (HO manages them at
  // /projects). useSites falls back to the static seed list while the request
  // is in flight, so this dropdown is never empty.
  const { names: SITES } = useSites();
  const isEdit = !!editInvoice;
  const { notify } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const today = new Date().toISOString().split('T')[0];
  const currentMonth = today.slice(0, 7);

  const [vendorId, setVendorId] = useState(editInvoice?.vendor_id ?? '');
  const [vendorName, setVendorName] = useState(editInvoice?.vendor_name ?? '');
  const [vendorSearch, setVendorSearch] = useState('');
  // Name typed in the search box and confirmed via "+ Add as new vendor" but
  // not yet POSTed. The vendor row is created at invoice-save time so its
  // category column reflects the category the HO actually picked for this
  // invoice, instead of whatever default was selected when the button was
  // clicked.
  const [pendingNewVendorName, setPendingNewVendorName] = useState<string | null>(null);
  const [localVendors, setLocalVendors] = useState<Vendor[]>(vendors);
  useEffect(() => { setLocalVendors(vendors); }, [vendors]);
  const vendorMatches = localVendors.filter(v => v.name.toLowerCase().includes(vendorSearch.toLowerCase()));
  const vendorKbd = useTypeaheadKeyboard({
    items: vendorMatches,
    open: !!vendorSearch,
    onSelect: v => { handleVendorChange(v.id); setVendorSearch(''); },
    onEmptyEnter: () => handleStageNewVendor(vendorSearch),
    onClose: () => setVendorSearch(''),
  });
  const [invoiceNo, setInvoiceNo] = useState(editInvoice?.invoice_no ?? '');
  const [poNumber, setPoNumber] = useState(editInvoice?.po_number ?? '');
  const [purpose, setPurpose] = useState(editInvoice?.purpose ?? '');
  const [site, setSite] = useState(editInvoice?.site ?? 'Nirvana');
  const [invoiceDate, setInvoiceDate] = useState(editInvoice?.invoice_date?.split('T')[0] ?? today);
  const [month, setMonth] = useState(editInvoice?.month?.split('T')[0] ?? `${currentMonth}-01`);
  const [baseAmount, setBaseAmount] = useState(
    editInvoice ? String(editInvoice.base_amount ?? editInvoice.invoice_amount) : ''
  );
  const [cgstPct, setCgstPct] = useState(editInvoice && Number(editInvoice.cgst_pct) ? String(editInvoice.cgst_pct) : '');
  const [sgstPct, setSgstPct] = useState(editInvoice && Number(editInvoice.sgst_pct) ? String(editInvoice.sgst_pct) : '');
  const [igstPct, setIgstPct] = useState(editInvoice && Number(editInvoice.igst_pct) ? String(editInvoice.igst_pct) : '');

  // Additional line items (multiple, each with its own GST). Seeded on edit
  // from the invoice's detail rows, falling back to the legacy single
  // additional_charge column for invoices created before line items existed.
  const [addlItems, setAddlItems] = useState<LineItemDraft[]>(
    editInvoice && Number(editInvoice.additional_charge) > 0
      ? [{
          description: editInvoice.additional_charge_reason ?? '',
          amount: String(editInvoice.additional_charge),
          cgstPct: Number(editInvoice.additional_charge_cgst_pct) ? String(editInvoice.additional_charge_cgst_pct) : '',
          sgstPct: Number(editInvoice.additional_charge_sgst_pct) ? String(editInvoice.additional_charge_sgst_pct) : '',
          igstPct: Number(editInvoice.additional_charge_igst_pct) ? String(editInvoice.additional_charge_igst_pct) : '',
        }]
      : []
  );

  // Pull the real detail rows when editing — these supersede the legacy
  // single-column seed above once they load.
  useEffect(() => {
    if (!editInvoice) return;
    getInvoiceLineItems(editInvoice.id)
      .then(rows => {
        if (rows.length > 0) {
          setAddlItems(rows.map(r => ({
            description: r.description,
            amount: String(r.amount),
            cgstPct: Number(r.cgst_pct) ? String(r.cgst_pct) : '',
            sgstPct: Number(r.sgst_pct) ? String(r.sgst_pct) : '',
            igstPct: Number(r.igst_pct) ? String(r.igst_pct) : '',
          })));
        }
      })
      .catch(() => {});
  }, [editInvoice]);

  const baseNum = Number(baseAmount) || 0;
  const cgstNum = Number(cgstPct) || 0;
  const sgstNum = Number(sgstPct) || 0;
  const igstNum = Number(igstPct) || 0;
  const cgstAmt = +(baseNum * cgstNum / 100).toFixed(2);
  const sgstAmt = +(baseNum * sgstNum / 100).toFixed(2);
  const igstAmt = +(baseNum * igstNum / 100).toFixed(2);
  const breakdown = computeInvoiceTotalWithItems({
    baseAmount: baseNum, cgstPct: cgstNum, sgstPct: sgstNum, igstPct: igstNum, items: addlItems,
  });
  const totalAmount = breakdown.total;

  const [remarks, setRemarks] = useState(editInvoice?.remarks ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editInvoice) {
      getAttachments(editInvoice.id).then(setExistingAttachments).catch(() => {});
    }
  }, [editInvoice]);

  // When editing a legacy invoice whose stored purpose differs from its
  // vendor's master category, snap purpose → vendor.category so the locked
  // dropdown shows the right value and the server-side validation passes.
  useEffect(() => {
    if (!vendorId) return;
    const v = localVendors.find(v => v.id === vendorId);
    if (v?.category && v.category !== purpose) setPurpose(v.category);
  }, [vendorId, localVendors, purpose]);

  // Vendors flagged "invoice number optional" in Vendor Master (e.g. bank
  // charges, refunds) may be saved without an invoice number.
  const selectedVendor = localVendors.find(v => v.id === vendorId);
  const invoiceNoOptional = !!selectedVendor?.invoice_no_optional;

  function handleVendorChange(id: string) {
    setVendorId(id);
    setPendingNewVendorName(null);
    const v = localVendors.find(v => v.id === id);
    if (v) {
      setVendorName(v.name);
      if (v.category) setPurpose(v.category);
    }
  }

  // Stage a new vendor name. The POST /vendors call is deferred to
  // handleSubmit so the new vendor's category column is set from the
  // category picked further down the form.
  function handleStageNewVendor(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPendingNewVendorName(trimmed);
    setVendorName(trimmed);
    setVendorId('');
    setVendorSearch('');
  }

  function clearPendingVendor() {
    setPendingNewVendorName(null);
    setVendorName('');
  }

  function handleDateChange(d: string) {
    setInvoiceDate(d);
    if (d.length >= 7) setMonth(`${d.slice(0, 7)}-01`);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!vendorId && !pendingNewVendorName) {
      setError('Pick a vendor from the dropdown, or click "+ Add as new vendor" if it isn\'t in Vendor Master yet.');
      return;
    }
    if (!purpose) { setError('Pick a category'); return; }
    if (!invoiceNo.trim() && !invoiceNoOptional) { setError('Invoice number is required'); return; }
    if (baseNum <= 0) { setError('Enter a valid base amount'); return; }
    if (totalAmount <= 0) { setError('Total amount must be greater than zero'); return; }
    const itemsWithAmount = addlItems.filter(li => (Number(li.amount) || 0) > 0);
    if (itemsWithAmount.some(li => !li.description.trim())) {
      setError('Each additional item needs a description / reason');
      return;
    }

    setSaving(true);
    try {
      // Deferred vendor create: persist the staged name now, using the
      // category the HO picked just above.
      let finalVendorId = vendorId;
      let finalVendorName = vendorName;
      if (pendingNewVendorName) {
        try {
          const created = await createVendor({
            name: pendingNewVendorName,
            payment_terms: 30,
            category: purpose || undefined,
          });
          setLocalVendors(prev => [...prev, created]);
          finalVendorId = created.id;
          finalVendorName = created.name;
          setVendorId(created.id);
          setVendorName(created.name);
          setPendingNewVendorName(null);
          notify(`Vendor "${created.name}" created (30-day terms)`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to create vendor';
          setError(msg);
          notify(msg);
          setSaving(false);
          return;
        }
      }

      const data = {
        month, invoice_date: invoiceDate, vendor_id: finalVendorId, vendor_name: finalVendorName,
        invoice_no: invoiceNo.trim(), po_number: poNumber.trim() || null,
        purpose, site, invoice_amount: totalAmount,
        base_amount: baseNum, cgst_pct: cgstNum, sgst_pct: sgstNum, igst_pct: igstNum,
        // Server derives the legacy additional_charge* columns from line_items.
        line_items: itemsWithAmount.map(li => ({
          description: li.description.trim(),
          amount: Number(li.amount) || 0,
          cgst_pct: Number(li.cgstPct) || 0,
          sgst_pct: Number(li.sgstPct) || 0,
          igst_pct: Number(li.igstPct) || 0,
        })),
        remarks: remarks.trim() || null,
      };

      let invoiceId: string;
      if (isEdit) {
        const updated = await updateInvoice(editInvoice.id, data);
        invoiceId = updated.id;
      } else {
        const created = await createInvoice(data);
        invoiceId = created.id;
      }

      if (pendingFiles.length > 0) {
        setUploading(true);
        for (const file of pendingFiles) await uploadAttachment(invoiceId, file);
        setUploading(false);
      }
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setError(msg);
      notify(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
      {confirmDialog}
      <div className="text-base font-medium text-gray-900 mb-5">{isEdit ? 'Edit Invoice' : 'New Invoice Entry'}</div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Month</label>
            <div className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-700 bg-gray-50">
              {new Date(month + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Invoice Date</label>
            <input type="date" value={invoiceDate} onChange={e => handleDateChange(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">
            Vendor Name *
            {vendorId && (() => {
              const v = localVendors.find(v => v.id === vendorId);
              return v ? <span className="text-green-600 ml-2">&#10003; {v.name} · {v.payment_terms}-day terms</span> : null;
            })()}
            {pendingNewVendorName && (
              <span className="text-amber-600 ml-2">
                New vendor &ldquo;{pendingNewVendorName}&rdquo; — will be created on Save
                <button type="button" onClick={clearPendingVendor}
                  className="ml-2 text-gray-400 hover:text-gray-600 underline">clear</button>
              </span>
            )}
          </label>
          <div className="relative">
            <input value={vendorSearch}
              onChange={e => { setVendorSearch(e.target.value); setVendorId(''); }}
              onKeyDown={vendorKbd.onKeyDown}
              placeholder={vendorName || 'Type to search vendor...'}
              onFocus={() => setVendorSearch(vendorSearch || vendorName)}
              onBlur={() => setTimeout(() => setVendorSearch(''), 200)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            {vendorSearch && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {vendorMatches.map((v, i) => (
                  <div key={v.id}
                    ref={vendorKbd.itemRef(i)}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { handleVendorChange(v.id); setVendorSearch(''); }}
                    className={`px-3 py-2 cursor-pointer flex items-center justify-between ${vendorKbd.isActive(i) ? 'bg-blue-50' : 'hover:bg-blue-50'}`}>
                    <span className="text-sm text-gray-900">{v.name}</span>
                    <span className="text-xs text-gray-400">{v.category} · {v.payment_terms}d</span>
                  </div>
                ))}
                {vendorMatches.length === 0 && (
                  <div className="px-3 py-2">
                    <div className="text-xs text-gray-400 mb-1">No matching vendor found</div>
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => handleStageNewVendor(vendorSearch)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      + Add &ldquo;{vendorSearch.trim()}&rdquo; as new vendor (saved with this invoice)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Invoice No {invoiceNoOptional ? '(optional)' : '*'}</label>
            <input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)}
              placeholder={invoiceNoOptional ? 'Not required for this vendor' : 'Invoice number'}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            {invoiceNoOptional && selectedVendor?.invoice_no_optional_reason && (
              <p className="mt-1 text-xs text-gray-400">{selectedVendor.invoice_no_optional_reason}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">PO Number</label>
            <input value={poNumber} onChange={e => setPoNumber(e.target.value)} placeholder="PO reference"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Category
              {(() => {
                const v = localVendors.find(v => v.id === vendorId);
                return v?.category ? <span className="text-gray-400 ml-2">· locked to vendor master</span> : null;
              })()}
            </label>
            {(() => {
              const v = localVendors.find(v => v.id === vendorId);
              const locked = !!v?.category;
              if (locked) {
                // Vendor master pins the category — show it as a disabled
                // dropdown with the single locked value.
                return (
                  <select value={purpose} disabled
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-600 cursor-not-allowed">
                    <option>{v!.category}</option>
                  </select>
                );
              }
              return (
                <CategorySelect
                  value={purpose}
                  onChange={setPurpose}
                  placeholder="Select category"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              );
            })()}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Site Location</label>
          <select value={site} onChange={e => setSite(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
            {SITES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
          <div className="text-xs font-medium text-gray-600 mb-3">Invoice Amount Breakdown</div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Base Amount (₹) *</label>
              <input type="number" value={baseAmount} onChange={e => setBaseAmount(e.target.value)} placeholder="0" min="0" step="0.01"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">CGST %</label>
              <input type="number" value={cgstPct} onChange={e => setCgstPct(e.target.value)} placeholder="0" min="0" max="100" step="0.01"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
              <div className="text-[11px] text-gray-400 mt-1">{formatINR(cgstAmt)}</div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">SGST %</label>
              <input type="number" value={sgstPct} onChange={e => setSgstPct(e.target.value)} placeholder="0" min="0" max="100" step="0.01"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
              <div className="text-[11px] text-gray-400 mt-1">{formatINR(sgstAmt)}</div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">IGST %</label>
              <input type="number" value={igstPct} onChange={e => setIgstPct(e.target.value)} placeholder="0" min="0" max="100" step="0.01"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
              <div className="text-[11px] text-gray-400 mt-1">{formatINR(igstAmt)}</div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
            <span className="text-sm text-gray-600">Sub-total (base + GST)</span>
            <span className="text-sm font-medium text-gray-800">
              {formatINR(+(baseNum + cgstAmt + sgstAmt + igstAmt).toFixed(2))}
            </span>
          </div>
        </div>

        {/* Additional line items (multiple, each with its own GST) */}
        <LineItemsEditor items={addlItems} onChange={setAddlItems} />

        {/* Grand total */}
        <div className="mb-4 flex items-center justify-between px-2.5 py-3 bg-[#1a3c5e]/5 rounded-lg">
          <span className="text-sm font-medium text-gray-700">Total Invoice Amount</span>
          <span className="text-lg font-semibold text-[#1a3c5e]">{formatINR(totalAmount)}</span>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Remarks</label>
          <textarea value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Notes..." rows={2}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none" />
        </div>

        <div className="mb-5">
          <label className="block text-xs text-gray-500 mb-1">Invoice copies & documents</label>
          <div
            onDragOver={(e: DragEvent) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={async (e: DragEvent) => {
              e.preventDefault(); e.stopPropagation();
              const files = Array.from(e.dataTransfer.files);
              if (isEdit) {
                setUploading(true);
                try {
                  for (const file of files) await uploadAttachment(editInvoice.id, file);
                  const fresh = await getAttachments(editInvoice.id);
                  setExistingAttachments(fresh);
                  notify(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Upload failed');
                } finally { setUploading(false); }
              } else {
                setPendingFiles(prev => [...prev, ...files]);
                notify(`Added ${files.length} file${files.length > 1 ? 's' : ''} — will upload on save`);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-300">
            <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple className="hidden"
              onChange={async (e: ChangeEvent<HTMLInputElement>) => {
                if (!e.target.files) return;
                const files = Array.from(e.target.files);
                e.target.value = '';
                if (isEdit) {
                  // Upload immediately to existing invoice
                  setUploading(true);
                  try {
                    for (const file of files) await uploadAttachment(editInvoice.id, file);
                    const fresh = await getAttachments(editInvoice.id);
                    setExistingAttachments(fresh);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Upload failed');
                  } finally {
                    setUploading(false);
                  }
                } else {
                  setPendingFiles(prev => [...prev, ...files]);
                }
              }} />
            <div className="text-sm text-gray-600 font-medium">Drag & drop or click to browse</div>
            <div className="text-xs text-gray-400 mt-1">PDF, JPG, PNG — max 10 MB each</div>
          </div>
          {existingAttachments.length > 0 && (
            <div className="mt-3 space-y-2">
              {existingAttachments.map(att => {
                const fullUrl = att.url.startsWith('http') ? att.url : `${window.location.origin}${att.url}`;
                return (
                  <div key={att.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-sm font-medium text-gray-900 truncate">{att.file_name}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">{att.file_size ? `${Math.round(att.file_size / 1024)} KB` : ''}</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded" title="View">View</a>
                      <a href={`${fullUrl}${fullUrl.includes('?') ? '&' : '?'}download=1`} className="px-2 py-1 text-xs text-green-600 hover:bg-green-50 rounded" title="Download">Download</a>
                      <button type="button" onClick={() => { navigator.clipboard.writeText(fullUrl); alert('Link copied to clipboard'); }} className="px-2 py-1 text-xs text-purple-600 hover:bg-purple-50 rounded" title="Copy share link">Share</button>
                      <button type="button" onClick={async () => {
                        const ok = await confirm({
                          title: 'Delete attachment?',
                          message: `"${att.file_name}" will be removed from this invoice.`,
                          confirmLabel: 'Delete attachment',
                          variant: 'danger',
                        });
                        if (!ok) return;
                        try {
                          await deleteAttachment(editInvoice!.id, att.id);
                          setExistingAttachments(prev => prev.filter(a => a.id !== att.id));
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed to delete');
                        }
                      }} className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded" title="Delete">Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {pendingFiles.length > 0 && (
            <div className="mt-3 space-y-2">
              {pendingFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 bg-blue-50 rounded-lg">
                  <div className="text-sm font-medium text-gray-900">{f.name} <span className="text-xs text-gray-400">{Math.round(f.size / 1024)} KB</span></div>
                  <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-sm">&#10005;</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inline error right above the actions so it's never out of view */}
        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving || uploading}
            className="px-5 py-2.5 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d] disabled:opacity-50">
            {saving ? 'Saving...' : uploading ? 'Uploading files...' : 'Save Invoice'}
          </button>
          <button type="button" onClick={onCancel} className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
        </div>
      </form>
    </div>
  );
}

// ── HO Batch Invoice Form ──────────────────────────────────────────────────
// Add many invoices against ONE vendor in a single submit. Vendor + Site are
// locked at the top; everything else is per row. Save-valid-rows semantics:
// rows that fail server-side dedup stay editable, rows that succeed are
// marked saved and excluded from re-submit.

type BatchRowStatus = 'idle' | 'saving' | 'saved' | 'failed';

interface BatchRow {
  id: string;
  invoiceDate: string;
  month: string;
  invoiceNo: string;
  poNumber: string;
  purpose: string;
  baseAmount: string;
  cgstPct: string;
  sgstPct: string;
  igstPct: string;
  addlChargeOn: boolean;
  addlCharge: string;
  addlGstOn: boolean;
  addlCgstPct: string;
  addlSgstPct: string;
  addlIgstPct: string;
  addlReason: string;
  remarks: string;
  pendingFiles: File[];
  status: BatchRowStatus;
  error: string | null;
  invoiceId: string | null;
}

function makeBatchRow(): BatchRow {
  const today = new Date().toISOString().split('T')[0];
  return {
    id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `r-${Date.now()}-${Math.random()}`,
    invoiceDate: today,
    month: `${today.slice(0, 7)}-01`,
    invoiceNo: '',
    poNumber: '',
    purpose: '',
    baseAmount: '',
    cgstPct: '',
    sgstPct: '',
    igstPct: '',
    addlChargeOn: false,
    addlCharge: '',
    addlGstOn: false,
    addlCgstPct: '',
    addlSgstPct: '',
    addlIgstPct: '',
    addlReason: '',
    remarks: '',
    pendingFiles: [],
    status: 'idle',
    error: null,
    invoiceId: null,
  };
}

function HOInvoiceBatchForm({ vendors, onCancel, onSaved }: {
  vendors: Vendor[];
  onCancel: () => void;
  onSaved: (createdCount: number) => void;
}) {
  // Projects come from the DB-backed Project Master (HO manages them at
  // /projects). useSites falls back to the static seed list while the request
  // is in flight, so this dropdown is never empty.
  const { names: SITES } = useSites();
  const { notify } = useToast();

  const [localVendors, setLocalVendors] = useState<Vendor[]>(vendors);
  useEffect(() => { setLocalVendors(vendors); }, [vendors]);

  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [pendingNewVendorName, setPendingNewVendorName] = useState<string | null>(null);
  const [masterCategory, setMasterCategory] = useState('');
  const [site, setSite] = useState('Nirvana');

  const [rows, setRows] = useState<BatchRow[]>([makeBatchRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedVendor = localVendors.find(v => v.id === vendorId);
  const vendorCategory = selectedVendor?.category || (pendingNewVendorName ? masterCategory : '');
  const categoryLocked = !!vendorCategory;
  // Vendors flagged "invoice number optional" let every row in the batch skip
  // the invoice number (the batch shares a single vendor).
  const invoiceNoOptional = !!selectedVendor?.invoice_no_optional;

  const vendorMatches = localVendors.filter(v => v.name.toLowerCase().includes(vendorSearch.toLowerCase()));
  const vendorKbd = useTypeaheadKeyboard({
    items: vendorMatches,
    open: !!vendorSearch,
    onSelect: v => { handleVendorPick(v.id); setVendorSearch(''); },
    onEmptyEnter: () => handleStageNewVendor(vendorSearch),
    onClose: () => setVendorSearch(''),
  });

  // Whenever the vendor's locked category changes, snap every row's purpose
  // to it so the user can't submit a stale value.
  useEffect(() => {
    if (!categoryLocked) return;
    setRows(prev => prev.map(r =>
      r.status === 'saved' || r.purpose === vendorCategory ? r : { ...r, purpose: vendorCategory }
    ));
  }, [categoryLocked, vendorCategory]);

  function handleVendorPick(id: string) {
    setVendorId(id);
    setPendingNewVendorName(null);
    setMasterCategory('');
    const v = localVendors.find(x => x.id === id);
    if (v) setVendorName(v.name);
  }

  function handleStageNewVendor(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPendingNewVendorName(trimmed);
    setVendorName(trimmed);
    setVendorId('');
    setVendorSearch('');
  }

  function clearVendor() {
    setVendorId('');
    setVendorName('');
    setPendingNewVendorName(null);
    setMasterCategory('');
  }

  function updateRow(id: string, patch: Partial<BatchRow>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }

  function updateRowDate(id: string, d: string) {
    updateRow(id, {
      invoiceDate: d,
      month: d.length >= 7 ? `${d.slice(0, 7)}-01` : `${new Date().toISOString().slice(0, 7)}-01`,
    });
  }

  function addRow() {
    setRows(prev => [...prev, { ...makeBatchRow(), purpose: categoryLocked ? vendorCategory : '' }]);
  }

  function removeRow(id: string) {
    setRows(prev => prev.length === 1 ? prev : prev.filter(r => r.id !== id));
  }

  // Editable (idle or failed) rows are the ones that get submitted.
  const editableRows = rows.filter(r => r.status === 'idle' || r.status === 'failed');
  const savedCount = rows.filter(r => r.status === 'saved').length;
  const grandTotal = editableRows.reduce((s, r) => s + computeInvoiceTotal({
    baseAmount: Number(r.baseAmount) || 0,
    cgstPct: Number(r.cgstPct) || 0,
    sgstPct: Number(r.sgstPct) || 0,
    igstPct: Number(r.igstPct) || 0,
    addlChargeOn: r.addlChargeOn,
    addlCharge: Number(r.addlCharge) || 0,
    addlGstOn: r.addlGstOn,
    addlCgstPct: Number(r.addlCgstPct) || 0,
    addlSgstPct: Number(r.addlSgstPct) || 0,
    addlIgstPct: Number(r.addlIgstPct) || 0,
  }).total, 0);

  function rowTotal(r: BatchRow): number {
    return computeInvoiceTotal({
      baseAmount: Number(r.baseAmount) || 0,
      cgstPct: Number(r.cgstPct) || 0,
      sgstPct: Number(r.sgstPct) || 0,
      igstPct: Number(r.igstPct) || 0,
      addlChargeOn: r.addlChargeOn,
      addlCharge: Number(r.addlCharge) || 0,
      addlGstOn: r.addlGstOn,
      addlCgstPct: Number(r.addlCgstPct) || 0,
      addlSgstPct: Number(r.addlSgstPct) || 0,
      addlIgstPct: Number(r.addlIgstPct) || 0,
    }).total;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!vendorId && !pendingNewVendorName) {
      setError('Pick a vendor from the dropdown, or click "+ Add as new vendor".');
      return;
    }
    if (pendingNewVendorName && !masterCategory) {
      setError('Pick a master category for the new vendor.');
      return;
    }
    if (editableRows.length === 0) {
      setError('Add at least one invoice row to save.');
      return;
    }

    // Per-row client-side validation
    const rowErrors: { id: string; msg: string }[] = [];
    const seenInvoiceNos = new Set<string>();
    for (const r of editableRows) {
      const total = rowTotal(r);
      if (!r.invoiceNo.trim() && !invoiceNoOptional) { rowErrors.push({ id: r.id, msg: 'Invoice number is required' }); continue; }
      // Skip the in-batch duplicate check for blank numbers (allowed when the
      // vendor is invoice-number-optional — many blank rows are fine).
      if (r.invoiceNo.trim()) {
        const lower = r.invoiceNo.trim().toLowerCase();
        if (seenInvoiceNos.has(lower)) { rowErrors.push({ id: r.id, msg: `Duplicate invoice no "${r.invoiceNo}" in this batch` }); continue; }
        seenInvoiceNos.add(lower);
      }
      if (Number(r.baseAmount) <= 0) { rowErrors.push({ id: r.id, msg: 'Enter a valid base amount' }); continue; }
      if (total <= 0) { rowErrors.push({ id: r.id, msg: 'Total must be greater than zero' }); continue; }
      if (!r.purpose) { rowErrors.push({ id: r.id, msg: 'Pick a category' }); continue; }
      if (r.addlChargeOn && Number(r.addlCharge) > 0 && !r.addlReason.trim()) {
        rowErrors.push({ id: r.id, msg: 'Reason required when additional charge is entered' });
        continue;
      }
    }
    if (rowErrors.length > 0) {
      setRows(prev => prev.map(r => {
        const e = rowErrors.find(re => re.id === r.id);
        return e ? { ...r, status: 'failed' as BatchRowStatus, error: e.msg } : r;
      }));
      setError(`Fix ${rowErrors.length} row${rowErrors.length === 1 ? '' : 's'} before saving.`);
      return;
    }

    setSubmitting(true);
    try {
      // Deferred vendor create — uses the master category picked above.
      let finalVendorId = vendorId;
      let finalVendorName = vendorName;
      if (pendingNewVendorName) {
        try {
          const created = await createVendor({
            name: pendingNewVendorName,
            payment_terms: 30,
            category: masterCategory,
          });
          setLocalVendors(prev => [...prev, created]);
          finalVendorId = created.id;
          finalVendorName = created.name;
          setVendorId(created.id);
          setVendorName(created.name);
          setPendingNewVendorName(null);
          notify(`Vendor "${created.name}" created (30-day terms)`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to create vendor';
          setError(msg);
          setSubmitting(false);
          return;
        }
      }

      // Mark every editable row as saving so the UI reflects in-flight state.
      setRows(prev => prev.map(r => editableRows.find(e => e.id === r.id) ? { ...r, status: 'saving' as BatchRowStatus, error: null } : r));

      const payload = editableRows.map<CreateInvoiceData>(r => {
        const breakdown = computeInvoiceTotal({
          baseAmount: Number(r.baseAmount) || 0,
          cgstPct: Number(r.cgstPct) || 0,
          sgstPct: Number(r.sgstPct) || 0,
          igstPct: Number(r.igstPct) || 0,
          addlChargeOn: r.addlChargeOn,
          addlCharge: Number(r.addlCharge) || 0,
          addlGstOn: r.addlGstOn,
          addlCgstPct: Number(r.addlCgstPct) || 0,
          addlSgstPct: Number(r.addlSgstPct) || 0,
          addlIgstPct: Number(r.addlIgstPct) || 0,
        });
        return {
          month: r.month,
          invoice_date: r.invoiceDate,
          vendor_id: finalVendorId,
          vendor_name: finalVendorName,
          invoice_no: r.invoiceNo.trim(),
          po_number: r.poNumber.trim() || null,
          purpose: r.purpose,
          site,
          invoice_amount: breakdown.total,
          base_amount: breakdown.baseNum,
          cgst_pct: Number(r.cgstPct) || 0,
          sgst_pct: Number(r.sgstPct) || 0,
          igst_pct: Number(r.igstPct) || 0,
          additional_charge: breakdown.addlChargeNum,
          additional_charge_cgst_pct: r.addlChargeOn && r.addlGstOn ? Number(r.addlCgstPct) || 0 : 0,
          additional_charge_sgst_pct: r.addlChargeOn && r.addlGstOn ? Number(r.addlSgstPct) || 0 : 0,
          additional_charge_igst_pct: r.addlChargeOn && r.addlGstOn ? Number(r.addlIgstPct) || 0 : 0,
          additional_charge_reason: breakdown.addlChargeNum > 0 ? r.addlReason.trim() : null,
          remarks: r.remarks.trim() || null,
        };
      });

      const resp = await createInvoiceBatch({
        vendor_id: finalVendorId,
        vendor_name: finalVendorName,
        site,
        invoices: payload,
      });

      // Walk the per-row results and update local state. The server returns
      // results in the same order as `editableRows`, so result.index maps
      // straight to editableRows[index].
      const updatedRows: BatchRow[] = [];
      const uploads: Array<{ invoiceId: string; files: File[] }> = [];
      for (const r of rows) {
        if (r.status !== 'saving') { updatedRows.push(r); continue; }
        const editableIdx = editableRows.findIndex(er => er.id === r.id);
        const res = resp.results.find(x => x.index === editableIdx);
        if (!res) {
          updatedRows.push({ ...r, status: 'failed', error: 'No result returned for this row' });
          continue;
        }
        if (res.ok && res.invoice_id) {
          updatedRows.push({ ...r, status: 'saved', invoiceId: res.invoice_id, error: null });
          if (r.pendingFiles.length > 0) {
            uploads.push({ invoiceId: res.invoice_id, files: r.pendingFiles });
          }
        } else {
          updatedRows.push({ ...r, status: 'failed', error: res.error?.message || 'Failed' });
        }
      }
      setRows(updatedRows);

      // Upload attachments for the rows that saved. Serial keeps it simple
      // and matches the single-form behavior.
      for (const u of uploads) {
        for (const f of u.files) {
          try { await uploadAttachment(u.invoiceId, f); } catch { /* surface? not blocking */ }
        }
      }
      // Clear pending files for rows that uploaded successfully so a
      // re-submit of remaining failed rows doesn't re-upload them.
      setRows(prev => prev.map(r => r.status === 'saved' ? { ...r, pendingFiles: [] } : r));

      if (resp.failed === 0) {
        onSaved(resp.created);
      } else {
        notify(`Created ${resp.created} · ${resp.failed} failed — fix and re-submit`);
      }
    } catch (err) {
      // Server-side schema-level failure (e.g. payload shape). Roll the
      // saving rows back to failed so the user can retry.
      const msg = err instanceof Error ? err.message : 'Batch save failed';
      setError(msg);
      setRows(prev => prev.map(r => r.status === 'saving' ? { ...r, status: 'failed' as BatchRowStatus, error: msg } : r));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
      <div className="text-base font-medium text-gray-900 mb-5">Add Many Invoices · One Vendor</div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <form onSubmit={handleSubmit}>
        {/* Header — vendor + site + (master category for new vendor) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">
              Vendor *
              {vendorId && selectedVendor && (
                <span className="text-green-600 ml-2">&#10003; {selectedVendor.name} · {selectedVendor.payment_terms}-day terms</span>
              )}
              {pendingNewVendorName && (
                <span className="text-amber-600 ml-2">
                  New vendor &ldquo;{pendingNewVendorName}&rdquo; — will be created on Save
                  <button type="button" onClick={clearVendor} className="ml-2 text-gray-400 hover:text-gray-600 underline">clear</button>
                </span>
              )}
            </label>
            <div className="relative">
              <input value={vendorSearch}
                onChange={e => { setVendorSearch(e.target.value); setVendorId(''); }}
                onKeyDown={vendorKbd.onKeyDown}
                placeholder={vendorName || 'Type to search vendor...'}
                onFocus={() => setVendorSearch(vendorSearch || vendorName)}
                onBlur={() => setTimeout(() => setVendorSearch(''), 200)}
                disabled={savedCount > 0}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50" />
              {vendorSearch && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {vendorMatches.map((v, i) => (
                    <div key={v.id}
                      ref={vendorKbd.itemRef(i)}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { handleVendorPick(v.id); setVendorSearch(''); }}
                      className={`px-3 py-2 cursor-pointer flex items-center justify-between ${vendorKbd.isActive(i) ? 'bg-blue-50' : 'hover:bg-blue-50'}`}>
                      <span className="text-sm text-gray-900">{v.name}</span>
                      <span className="text-xs text-gray-400">{v.category} · {v.payment_terms}d</span>
                    </div>
                  ))}
                  {vendorMatches.length === 0 && (
                    <div className="px-3 py-2">
                      <div className="text-xs text-gray-400 mb-1">No matching vendor found</div>
                      <button type="button" onMouseDown={e => e.preventDefault()}
                        onClick={() => handleStageNewVendor(vendorSearch)}
                        className="text-xs text-blue-600 hover:underline">
                        + Add &ldquo;{vendorSearch.trim()}&rdquo; as new vendor (saved with these invoices)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Site *</label>
            <select value={site} onChange={e => setSite(e.target.value)}
              disabled={savedCount > 0}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50">
              {SITES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {pendingNewVendorName && (
            <div className="sm:col-span-3">
              <label className="block text-xs text-gray-500 mb-1">Master Category for new vendor *</label>
              <CategorySelect
                value={masterCategory}
                onChange={setMasterCategory}
                placeholder="Select category"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <div className="text-xs text-gray-400 mt-1">All rows will be filed under this category.</div>
            </div>
          )}
        </div>

        {/* Rows */}
        <div className="space-y-3 mb-4">
          {rows.map((r, idx) => {
            const total = rowTotal(r);
            const isSaved = r.status === 'saved';
            const isSaving = r.status === 'saving';
            const isFailed = r.status === 'failed';
            return (
              <div key={r.id}
                className={`border rounded-lg p-4 ${
                  isSaved ? 'border-green-200 bg-green-50/40'
                  : isFailed ? 'border-red-200 bg-red-50/30'
                  : 'border-gray-200 bg-white'
                }`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-500">Row {idx + 1}</span>
                    {isSaved && <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">&#10003; Saved</span>}
                    {isSaving && <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">Saving…</span>}
                    {isFailed && r.error && <span className="text-xs text-red-700">{r.error}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700">{formatINR(total)}</span>
                    <button type="button" onClick={() => removeRow(r.id)}
                      disabled={isSaved || rows.length === 1}
                      className="text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed text-sm">
                      &#10005;
                    </button>
                  </div>
                </div>

                <fieldset disabled={isSaved || isSaving} className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Invoice Date</label>
                      <input type="date" value={r.invoiceDate} onChange={e => updateRowDate(r.id, e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Invoice No {invoiceNoOptional ? '(optional)' : '*'}</label>
                      <input value={r.invoiceNo} onChange={e => updateRow(r.id, { invoiceNo: e.target.value })}
                        placeholder={invoiceNoOptional ? 'Not required' : 'Invoice number'}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">PO Number</label>
                      <input value={r.poNumber} onChange={e => updateRow(r.id, { poNumber: e.target.value })}
                        placeholder="PO reference"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        Category
                        {categoryLocked && <span className="text-gray-400 ml-1">· locked</span>}
                      </label>
                      {categoryLocked ? (
                        <select value={r.purpose} disabled
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-600">
                          <option>{vendorCategory}</option>
                        </select>
                      ) : (
                        <CategorySelect
                          value={r.purpose}
                          onChange={v => updateRow(r.id, { purpose: v })}
                          placeholder="Select"
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                        />
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Base Amount *</label>
                      <input type="number" step="0.01" min="0" value={r.baseAmount}
                        onChange={e => updateRow(r.id, { baseAmount: e.target.value })}
                        placeholder="0.00"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">CGST %</label>
                      <input type="number" step="0.01" min="0" max="100" value={r.cgstPct}
                        onChange={e => updateRow(r.id, { cgstPct: e.target.value })}
                        placeholder="0"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">SGST %</label>
                      <input type="number" step="0.01" min="0" max="100" value={r.sgstPct}
                        onChange={e => updateRow(r.id, { sgstPct: e.target.value })}
                        placeholder="0"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">IGST %</label>
                      <input type="number" step="0.01" min="0" max="100" value={r.igstPct}
                        onChange={e => updateRow(r.id, { igstPct: e.target.value })}
                        placeholder="0"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    </div>
                  </div>

                  {/* Additional charge toggle */}
                  <div>
                    <label className="inline-flex items-center text-xs text-gray-600 gap-2">
                      <input type="checkbox" checked={r.addlChargeOn}
                        onChange={e => updateRow(r.id, { addlChargeOn: e.target.checked })} />
                      Additional charge (transport, loading, round-off…)
                    </label>
                    {r.addlChargeOn && (
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Amount</label>
                          <input type="number" step="0.01" min="0" value={r.addlCharge}
                            onChange={e => updateRow(r.id, { addlCharge: e.target.value })}
                            placeholder="0.00"
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-gray-500 mb-1">Reason *</label>
                          <input value={r.addlReason}
                            onChange={e => updateRow(r.id, { addlReason: e.target.value })}
                            placeholder="e.g. Transport, Loading"
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                        </div>
                        <div>
                          <label className="inline-flex items-center text-xs text-gray-600 gap-2 mt-6">
                            <input type="checkbox" checked={r.addlGstOn}
                              onChange={e => updateRow(r.id, { addlGstOn: e.target.checked })} />
                            GST on charge
                          </label>
                        </div>
                        {r.addlGstOn && (
                          <>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">CGST %</label>
                              <input type="number" step="0.01" min="0" max="100" value={r.addlCgstPct}
                                onChange={e => updateRow(r.id, { addlCgstPct: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">SGST %</label>
                              <input type="number" step="0.01" min="0" max="100" value={r.addlSgstPct}
                                onChange={e => updateRow(r.id, { addlSgstPct: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">IGST %</label>
                              <input type="number" step="0.01" min="0" max="100" value={r.addlIgstPct}
                                onChange={e => updateRow(r.id, { addlIgstPct: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Remarks</label>
                      <input value={r.remarks} onChange={e => updateRow(r.id, { remarks: e.target.value })}
                        placeholder="Notes"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Attachments ({r.pendingFiles.length})</label>
                      <input type="file" multiple
                        onChange={(e: ChangeEvent<HTMLInputElement>) => {
                          const files = Array.from(e.target.files ?? []);
                          updateRow(r.id, { pendingFiles: [...r.pendingFiles, ...files] });
                          e.target.value = '';
                        }}
                        className="w-full text-xs text-gray-600" />
                      {r.pendingFiles.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.pendingFiles.map((f, fi) => (
                            <span key={fi} className="text-xs bg-gray-100 px-2 py-0.5 rounded inline-flex items-center gap-1">
                              {f.name}
                              <button type="button"
                                onClick={() => updateRow(r.id, { pendingFiles: r.pendingFiles.filter((_, j) => j !== fi) })}
                                className="text-gray-400 hover:text-red-600">&#10005;</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </fieldset>
              </div>
            );
          })}
        </div>

        <button type="button" onClick={addRow}
          className="text-sm text-[#1a3c5e] hover:underline mb-5">
          + Add another invoice
        </button>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
          <div className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">{editableRows.length}</span> to save
            {savedCount > 0 && <span className="text-green-700 ml-3">{savedCount} already saved</span>}
            <span className="text-gray-500 ml-3">· Total {formatINR(grandTotal)}</span>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              {savedCount > 0 ? 'Close' : 'Cancel'}
            </button>
            <button type="submit" disabled={submitting || editableRows.length === 0}
              className="px-5 py-2 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d] disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? 'Saving…' : `Save ${editableRows.length} invoice${editableRows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ── Export dropdown menu ───────────────────────────────────────────────────
interface ExportMenuProps {
  buildPath: (format: 'csv' | 'xlsx' | 'pdf') => string;
  filterCount: number;
  selectedCount: number;
}

function ExportMenu({ buildPath, filterCount, selectedCount }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<'csv' | 'xlsx' | 'pdf' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { notify } = useToast();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleScroll() { setOpen(false); }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  async function download(format: 'csv' | 'xlsx' | 'pdf') {
    setBusyFormat(format);
    try {
      await downloadAuthenticated(buildPath(format), `invoices.${format}`, format === 'pdf');
      setOpen(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setBusyFormat(null);
    }
  }

  const tip = selectedCount > 0
    ? `Exports the ${selectedCount} selected invoice${selectedCount === 1 ? '' : 's'}`
    : filterCount > 0
      ? `Exports the current filtered view (${filterCount} filter${filterCount === 1 ? '' : 's'} active)`
      : 'Exports all invoices';

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={tip}
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
      >
        Export
        {selectedCount > 0 ? (
          <span className="bg-blue-600 text-white text-[10px] font-medium px-1.5 rounded-full">{selectedCount}</span>
        ) : filterCount > 0 ? (
          <span className="bg-[#1a3c5e] text-white text-[10px] font-medium px-1.5 rounded-full">{filterCount}</span>
        ) : null}
        <span className="text-[10px]">&#9662;</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          <div className="px-3 py-2 text-[11px] text-gray-500 border-b border-gray-100">
            {selectedCount > 0
              ? `${selectedCount} selected invoice${selectedCount === 1 ? '' : 's'}`
              : filterCount > 0
                ? `Current filtered view (${filterCount})`
                : 'All invoices'}
          </div>
          <button onClick={() => download('csv')} disabled={busyFormat !== null} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 text-gray-700 disabled:opacity-50">
            <div className="font-medium">{busyFormat === 'csv' ? 'Preparing CSV…' : 'CSV'}</div>
            <div className="text-[10px] text-gray-500">Comma-separated · opens in Excel</div>
          </button>
          <button onClick={() => download('xlsx')} disabled={busyFormat !== null} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 text-gray-700 disabled:opacity-50">
            <div className="font-medium">{busyFormat === 'xlsx' ? 'Preparing Excel…' : 'Excel (.xlsx)'}</div>
            <div className="text-[10px] text-gray-500">Native Excel workbook</div>
          </button>
          <button onClick={() => download('pdf')} disabled={busyFormat !== null} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 text-gray-700 disabled:opacity-50">
            <div className="font-medium">{busyFormat === 'pdf' ? 'Preparing PDF…' : 'PDF'}</div>
            <div className="text-[10px] text-gray-500">Print-friendly summary</div>
          </button>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// BulkPayModal — single cheque / transaction spanning multiple invoices
// ---------------------------------------------------------------------------
interface BulkPayModalProps {
  invoices: Invoice[];
  agingMap: Map<string, { balance: number; daysLabel: string; daysNum: number }>;
  onClose: () => void;
  onSaved: () => void;
}

function BulkPayModal({ invoices, agingMap, onClose, onSaved }: BulkPayModalProps) {
  const { notify } = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const initialAllocs = useMemo(() => {
    const m: Record<string, string> = {};
    for (const inv of invoices) {
      const bal = Number(inv.balance ?? agingMap.get(inv.id)?.balance ?? inv.invoice_amount);
      m[inv.id] = bal > 0 ? String(bal) : '0';
    }
    return m;
  }, [invoices, agingMap]);

  const [allocs, setAllocs] = useState<Record<string, string>>(initialAllocs);
  // Per-invoice TDS % withheld (sec 194C/194J). Computed on the invoice's
  // pre-GST base_amount — same basis as the single-payment modal.
  const [tdsPcts, setTdsPcts] = useState<Record<string, string>>({});
  // Per-invoice GST % ADDED at payment — extra cash paid to the vendor on top
  // of the invoice, computed on the taxable base. This is NOT a withholding:
  // it settles nothing, it only increases the cheque total. Mirrors the
  // single-payment modal's "Add GST %" field (migration 052).
  const [gstAddedPcts, setGstAddedPcts] = useState<Record<string, string>>({});
  const [txnType, setTxnType] = useState('Cheque');
  const [txnRef, setTxnRef] = useState('');
  const [txnAmount, setTxnAmount] = useState('');
  const [txnDate, setTxnDate] = useState(today);
  const [bank, setBank] = useState('HDFC');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  const allocTotal = Object.values(allocs).reduce((s, v) => s + (Number(v) || 0), 0);
  const txnAmtNum = Number(txnAmount) || 0;

  function balanceFor(inv: Invoice): number {
    return Number(inv.balance ?? agingMap.get(inv.id)?.balance ?? inv.invoice_amount);
  }

  function tdsBaseFor(inv: Invoice): number {
    return Number(inv.base_amount ?? inv.invoice_amount);
  }

  function tdsAmountFor(inv: Invoice): number {
    const pct = Math.max(0, Math.min(10, Number(tdsPcts[inv.id]) || 0));
    return Math.round(tdsBaseFor(inv) * pct) / 100;
  }

  // GST added on top of the invoice — computed on the taxable base, matching
  // the single-payment path. Extra cash to the vendor; settles nothing.
  function gstAddedAmountFor(inv: Invoice): number {
    const pct = Math.max(0, Math.min(28, Number(gstAddedPcts[inv.id]) || 0));
    return Math.round((tdsBaseFor(inv) - tdsAmountFor(inv)) * pct) / 100;
  }

  // Total withheld (no cash) for an invoice — cash + this must fit the balance.
  // Added GST is excluded: it isn't settlement, so it doesn't eat into the
  // cash the invoice can absorb.
  function withheldFor(inv: Invoice): number {
    return tdsAmountFor(inv);
  }

  // Cash the invoice can still absorb without cash + TDS exceeding its balance.
  function cashRoomFor(inv: Invoice): number {
    return Math.max(0, balanceFor(inv) - withheldFor(inv));
  }

  const tdsTotal = invoices.reduce((s, inv) => s + tdsAmountFor(inv), 0);
  const gstAddedTotal = invoices.reduce((s, inv) => s + gstAddedAmountFor(inv), 0);

  // The cheque / transfer covers the cash allocations PLUS any GST added on
  // top, so that combined figure is what must equal the entered txn amount.
  const chequeTotal = allocTotal + gstAddedTotal;
  const diff = Number((txnAmtNum - chequeTotal).toFixed(2));
  const tallied = Math.abs(diff) < 1 && txnAmtNum > 0;

  // Changing a withholding % reduces the cash leg to the full-settle figure
  // (balance − withheld) so cash + TDS + GST-TDS lands exactly on the balance —
  // this is what keeps "allocation + TDS exceeds outstanding balance" from
  // firing when a user adds a withholding after the cash was pre-filled.
  function setTdsPct(inv: Invoice, value: string) {
    const tdsAmt = Math.round(tdsBaseFor(inv) * Math.max(0, Math.min(10, Number(value) || 0))) / 100;
    const cash = Math.max(0, balanceFor(inv) - tdsAmt);
    setTdsPcts(prev => ({ ...prev, [inv.id]: value }));
    setAllocs(prev => ({ ...prev, [inv.id]: String(Number(cash.toFixed(2))) }));
  }

  // Added GST doesn't touch the cash allocation — it only raises the cheque
  // total, so the user tops up the txn amount (or re-runs Auto-distribute).
  function setGstAddedPct(inv: Invoice, value: string) {
    setGstAddedPcts(prev => ({ ...prev, [inv.id]: value }));
  }

  function autoDistribute() {
    // The cheque covers cash + added GST, so only (txn − added GST) is
    // available as cash. Each invoice's cash leg is capped at balance − TDS so
    // cash + TDS can never exceed that invoice's outstanding balance.
    let remaining = Math.max(0, txnAmtNum - gstAddedTotal);
    const next: Record<string, string> = {};
    for (const inv of invoices) {
      if (remaining <= 0) { next[inv.id] = '0'; continue; }
      const take = Math.min(cashRoomFor(inv), remaining);
      next[inv.id] = String(Number(take.toFixed(2)));
      remaining -= take;
    }
    setAllocs(next);
  }

  async function handleSubmit() {
    if (txnType !== 'Cash' && !txnRef.trim()) { notify('Enter cheque / transaction reference', 'error'); return; }
    if (txnAmtNum <= 0) { notify('Enter cheque / transaction amount', 'error'); return; }
    if (!tallied) {
      notify(
        `Cash ₹${allocTotal.toLocaleString('en-IN')}${gstAddedTotal > 0 ? ` + GST added ₹${gstAddedTotal.toLocaleString('en-IN')}` : ''} = ₹${chequeTotal.toLocaleString('en-IN')} must equal txn amount ₹${txnAmtNum.toLocaleString('en-IN')}`,
        'error',
      );
      return;
    }

    const allocations = invoices
      .map(inv => ({
        invoice_id: inv.id,
        amount: Number(allocs[inv.id] || 0),
        tds_pct: Math.max(0, Math.min(10, Number(tdsPcts[inv.id]) || 0)),
        gst_added_pct: Math.max(0, Math.min(28, Number(gstAddedPcts[inv.id]) || 0)),
      }))
      .filter(a => a.amount > 0);

    if (allocations.length === 0) { notify('Allocate at least one invoice', 'error'); return; }

    setSaving(true);
    try {
      await bulkPayInvoices({
        txn_type: txnType,
        txn_ref: txnRef.trim(),
        txn_amount: txnAmtNum,
        txn_date: txnDate,
        bank,
        remarks: remarks.trim() || null,
        allocations,
      });
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Bulk payment failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-base font-medium text-gray-900">Bulk Pay — Single Cheque / Transaction</div>
            <div className="text-xs text-gray-500 mt-0.5">Record one cheque / bank transfer against {invoices.length} invoice{invoices.length > 1 ? 's' : ''}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {/* Transaction details */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Payment Type</label>
              <select value={txnType} onChange={e => setTxnType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                {PAYMENT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            {txnType !== 'Cash' && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Cheque No / Txn ID</label>
                <input value={txnRef} onChange={e => setTxnRef(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="e.g. 000123" />
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Total Amount</label>
              <input type="number" value={txnAmount} onChange={e => setTxnAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date</label>
              <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            {txnType !== 'Cash' && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Bank</label>
                <BankSelect
                  value={bank}
                  onChange={setBank}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Remarks (optional)</label>
              <input value={remarks} onChange={e => setRemarks(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Notes..." />
            </div>
          </div>

          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-gray-600">Allocate across selected invoices</div>
            <button onClick={autoDistribute}
              className="text-xs px-2.5 py-1 border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50">
              Auto-distribute
            </button>
          </div>

          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Invoice No</th>
                  <th className="text-left px-3 py-2 font-medium">Vendor</th>
                  <th className="text-left px-3 py-2 font-medium">Site</th>
                  <th className="text-right px-3 py-2 font-medium">Invoice Amt</th>
                  <th className="text-right px-3 py-2 font-medium">Balance</th>
                  <th className="text-right px-3 py-2 font-medium w-20">TDS %</th>
                  <th className="text-right px-3 py-2 font-medium w-20">GST %</th>
                  <th className="text-right px-3 py-2 font-medium w-36">Allocate (cash)</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const bal = balanceFor(inv);
                  const tds = tdsAmountFor(inv);
                  const gstAdded = gstAddedAmountFor(inv);
                  return (
                    <tr key={inv.id} className="border-t border-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{inv.invoice_no}</td>
                      <td className="px-3 py-2 text-gray-700">{inv.vendor_name}</td>
                      <td className="px-3 py-2 text-gray-600">{inv.site}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatINR(Number(inv.invoice_amount))}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatINR(bal)}</td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" min="0" max="10" step="0.01" value={tdsPcts[inv.id] ?? ''}
                          onChange={e => setTdsPct(inv, e.target.value)}
                          placeholder="0"
                          className="w-16 px-2 py-1 border border-gray-200 rounded-md text-sm text-right" />
                        {tds > 0 && (
                          <div className="text-[11px] text-amber-700 mt-0.5" title="TDS withheld on base amount">−{formatINR(tds)}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" min="0" max="28" step="0.01" value={gstAddedPcts[inv.id] ?? ''}
                          onChange={e => setGstAddedPct(inv, e.target.value)}
                          placeholder="0"
                          className="w-16 px-2 py-1 border border-gray-200 rounded-md text-sm text-right" />
                        {gstAdded > 0 && (
                          <div className="text-[11px] text-green-700 mt-0.5" title="GST added on top of the invoice — extra cash to the vendor, computed on the taxable base">+{formatINR(gstAdded)}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {/* Clamp to balance − TDS so cash + TDS can never exceed
                            the invoice balance (the server rejects that). */}
                        <input type="number" value={allocs[inv.id] ?? ''}
                          onChange={e => {
                            const raw = e.target.value;
                            const cap = cashRoomFor(inv);
                            const val = raw === '' ? '' : String(Math.min(Number(raw) || 0, cap));
                            setAllocs(prev => ({ ...prev, [inv.id]: val }));
                          }}
                          className="w-32 px-2 py-1 border border-gray-200 rounded-md text-sm text-right" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50/60 text-xs">
                <tr>
                  <td colSpan={7} className="px-3 py-2 text-right text-gray-500">Cheque / Txn amount</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{formatINR(txnAmtNum)}</td>
                </tr>
                <tr>
                  <td colSpan={7} className="px-3 py-2 text-right text-gray-500">Allocated total (cash)</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{formatINR(allocTotal)}</td>
                </tr>
                {gstAddedTotal > 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-2 text-right text-gray-500">GST added (extra cash to vendor)</td>
                    <td className="px-3 py-2 text-right font-medium text-green-700">+{formatINR(gstAddedTotal)}</td>
                  </tr>
                )}
                {gstAddedTotal > 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-2 text-right text-gray-500">Cheque total (cash + GST added)</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900">{formatINR(chequeTotal)}</td>
                  </tr>
                )}
                <tr>
                  <td colSpan={7} className="px-3 py-2 text-right text-gray-500">Difference</td>
                  <td className={`px-3 py-2 text-right font-medium ${tallied ? 'text-green-700' : 'text-amber-700'}`}>{formatINR(diff)}</td>
                </tr>
                {tdsTotal > 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-2 text-right text-gray-500">TDS withheld (settles invoices, no cash)</td>
                    <td className="px-3 py-2 text-right font-medium text-amber-700">{formatINR(tdsTotal)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !tallied}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">
            {saving ? 'Processing...' : tallied ? 'Record Bulk Payment' : 'Amounts must tally'}
          </button>
        </div>
      </div>
    </div>
  );
}
