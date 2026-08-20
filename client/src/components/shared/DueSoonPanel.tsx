import { useState } from 'react';
import { DueSoonRow } from '../../hooks/useDashboardData';
import { formatINR, formatDate } from '../../utils/formatters';

// "Payments Due — Next 15 Days", shared by the HO dashboard and the MD
// overview. Both rendered an identical copy of this markup; extracting it means
// a change to one can't silently leave the other behind.
//
// Only the first PREVIEW_COUNT rows show by default. There are routinely
// 200+ invoices in the window, and rendering them all pushed everything below
// this panel off the bottom of a very long page. The Overdue panel beside it
// has always capped at 6, so the two now sit at matching heights.
//
// Expanding keeps the list inside a fixed-height scroller rather than growing
// the page, so the rest of the dashboard stays where it is.
const PREVIEW_COUNT = 6;

export default function DueSoonPanel({ rows }: { rows: DueSoonRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const total = rows.reduce((s, r) => s + r.balance, 0);
  const shown = expanded ? rows : rows.slice(0, PREVIEW_COUNT);
  const hidden = rows.length - PREVIEW_COUNT;

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 bg-blue-50">
        <div className="text-sm font-medium text-[#1a3c5e]">Payments Due — Next 15 Days</div>
        <div className="text-[11px] text-[#1a3c5e] opacity-70 mt-0.5">
          {rows.length} invoice{rows.length !== 1 ? 's' : ''} · {formatINR(total)}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-7 text-center text-sm text-green-600">No payments falling due in the next 15 days</div>
      ) : (
        <>
          <div className={expanded ? 'max-h-[420px] overflow-y-auto' : ''}>
            {shown.map((r, i) => (
              <div key={r.invoiceId} className={`px-5 py-3.5 flex items-center justify-between ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                <div className="flex-1 min-w-0 mr-3">
                  <div className="font-medium text-sm text-gray-900 truncate">{r.vendorName}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{r.site} · Due {formatDate(r.dueDate)}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[15px] font-semibold text-gray-900">{formatINR(r.balance)}</div>
                  <span className={`inline-block mt-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${
                    r.daysLeft <= 3 ? 'text-red-700 bg-red-100'
                      : r.daysLeft <= 7 ? 'text-orange-700 bg-orange-100'
                        : 'text-[#1a3c5e] bg-blue-50'
                  }`}>
                    {r.daysLeft === 0 ? 'Due today' : `${r.daysLeft}d left`}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {hidden > 0 && (
            <div className="px-5 py-3 border-t border-gray-100 text-center">
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="text-xs text-blue-600 hover:underline"
              >
                {expanded ? 'Show less' : `Show all ${rows.length} — +${hidden} more`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
