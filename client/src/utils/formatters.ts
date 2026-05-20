// Shared formatting utilities used across all pages.

// Default display rounds to whole rupees — paisa cluttered KPI/totals at
// scale (lakhs/crores). For places that genuinely need paisa precision
// (e.g. importer line-item breakdowns), use formatINRPaisa instead.
const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const inrPaisaFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a number as ₹X,XX,XXX (en-IN locale, rounded to nearest rupee). */
export function formatINR(value: number): string {
  const rounded = Math.round(value);
  // Math.round(-0.4) yields -0, which Intl renders as "-₹0". Normalise to 0.
  return inrFormatter.format(rounded === 0 ? 0 : rounded);
}

/** Format with paisa preserved — only for line-item/breakdown contexts. */
export function formatINRPaisa(value: number): string {
  return inrPaisaFormatter.format(value);
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format an ISO date string as "14 Nov 2025".
 *
 * The DB stores invoice_date etc. as DATE (no time) — pg serializes that as
 * UTC midnight ("2026-05-12T00:00:00.000Z"). Round-tripping through
 * `new Date(...).toLocaleDateString()` would render that in the BROWSER's
 * timezone, which shifts the displayed day by one for any client west of
 * UTC (a CSV row dated 12 May then shows as 11 May). We parse the YYYY-MM-DD
 * prefix directly to keep the display tied to the stored calendar date.
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const [, y, mo, d] = m;
    const monthIdx = parseInt(mo, 10) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${d} ${MONTH_ABBR[monthIdx]} ${y}`;
    }
  }
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Format bytes as "245 KB" or "1.2 MB". */
export function formatSize(bytes: number): string {
  if (bytes > 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
