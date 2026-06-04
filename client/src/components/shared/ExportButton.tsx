import { useState, useRef, useEffect } from 'react';
import { downloadAuthenticated } from '../../api/client';
import { useToast } from '../../context/ToastContext';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

interface ExportButtonProps {
  /** Build the API path (incl. ?query) for a format, from the table's CURRENT filters. */
  buildPath: (format: ExportFormat) => string;
  /** Download filename stem, e.g. 'credit-notes' (extension added per format). */
  filenameBase: string;
  /** Singular noun for tooltips, e.g. 'credit note'. Default 'row'. */
  noun?: string;
  /** Count of active filters — drives the badge + "filtered view" tooltip. */
  filterCount?: number;
  /** Count of ticked rows — takes precedence over filterCount in the tooltip. */
  selectedCount?: number;
  /** Which formats to offer. Default: all three. */
  formats?: ExportFormat[];
  className?: string;
}

const FORMAT_META: Record<ExportFormat, { label: string; busy: string; hint: string }> = {
  csv: { label: 'CSV', busy: 'Preparing CSV…', hint: 'Comma-separated · opens in Excel' },
  xlsx: { label: 'Excel (.xlsx)', busy: 'Preparing Excel…', hint: 'Native Excel workbook' },
  pdf: { label: 'PDF', busy: 'Preparing PDF…', hint: 'Print-friendly summary' },
};

/**
 * Dropdown "Export" control shared by every table. Exports the table's current
 * view (filters/selection are baked into `buildPath`) as CSV/Excel/PDF via the
 * authenticated blob download. Extracted from InvoiceList's original ExportMenu.
 */
export default function ExportButton({
  buildPath,
  filenameBase,
  noun = 'row',
  filterCount = 0,
  selectedCount = 0,
  formats = ['csv', 'xlsx', 'pdf'],
  className = '',
}: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<ExportFormat | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { notify } = useToast();

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onScroll() { setOpen(false); }
    document.addEventListener('mousedown', onClickOutside);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  async function download(format: ExportFormat) {
    setBusyFormat(format);
    try {
      await downloadAuthenticated(buildPath(format), `${filenameBase}.${format}`, format === 'pdf');
      setOpen(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setBusyFormat(null);
    }
  }

  const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : 's'}`;
  const scope = selectedCount > 0
    ? `${plural(selectedCount, 'selected ' + noun)}`
    : filterCount > 0
      ? `Current filtered view (${filterCount})`
      : `All ${noun}s`;
  const tip = selectedCount > 0
    ? `Exports the ${plural(selectedCount, 'selected ' + noun)}`
    : filterCount > 0
      ? `Exports the current filtered view (${plural(filterCount, 'filter')} active)`
      : `Exports all ${noun}s`;
  const badge = selectedCount > 0 ? selectedCount : filterCount > 0 ? filterCount : null;

  return (
    <div className={`relative inline-block ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={tip}
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
      >
        Export
        {badge !== null && (
          <span className={`${selectedCount > 0 ? 'bg-blue-600' : 'bg-[#1a3c5e]'} text-white text-[10px] font-medium px-1.5 rounded-full`}>{badge}</span>
        )}
        <span className="text-[10px]">&#9662;</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          <div className="px-3 py-2 text-[11px] text-gray-500 border-b border-gray-100">{scope}</div>
          {formats.map(f => (
            <button
              key={f}
              onClick={() => download(f)}
              disabled={busyFormat !== null}
              className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 text-gray-700 disabled:opacity-50"
            >
              <div className="font-medium">{busyFormat === f ? FORMAT_META[f].busy : FORMAT_META[f].label}</div>
              <div className="text-[10px] text-gray-500">{FORMAT_META[f].hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
