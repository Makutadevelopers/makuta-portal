import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getVendorDetail, VendorDetailResponse } from '../../api/vendors';
import { formatINR, formatDate } from '../../utils/formatters';
import AppShell from '../../components/layout/AppShell';

type StatusFilter = 'All' | 'Paid' | 'Partial' | 'Not Paid';

export default function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<VendorDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    getVendorDetail(id)
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load vendor'))
      .finally(() => setLoading(false));
  }, [id]);

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

  const { vendor, stats, invoices } = data;

  const filtered = invoices.filter(inv =>
    statusFilter === 'All' || inv.payment_status === statusFilter
  );

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

  const kpiCards = [
    { label: 'Total Invoices', value: String(stats.totalInvoices), sub: 'all time', accent: '#1a3c5e', bg: '#e8eef5' },
    { label: 'Total Amount', value: formatINR(stats.totalAmount), sub: 'total invoiced value', accent: '#1a3c5e', bg: '#eff6ff' },
    { label: 'Paid Amount', value: formatINR(stats.paidAmount), sub: 'payments received', accent: '#15803d', bg: '#dcfce7' },
    { label: 'Outstanding', value: formatINR(stats.outstandingAmount), sub: stats.oldestUnpaid ? `oldest unpaid: ${formatDate(stats.oldestUnpaid)}` : 'fully settled', accent: stats.outstandingAmount > 0 ? '#dc2626' : '#15803d', bg: stats.outstandingAmount > 0 ? '#fef2f2' : '#dcfce7' },
  ];

  return (
    <AppShell>
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
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
          <span className="text-xs text-gray-400 ml-auto">{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Invoice Table */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50">
              <tr>
                {['Date', 'Inv No', 'PO No', 'Category', 'Site', 'Amount', 'Balance', 'Status'].map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap ${i >= 5 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => (
                <tr key={inv.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
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
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">
                    {invoices.length === 0 ? 'No invoices for this vendor.' : 'No invoices match the selected filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
