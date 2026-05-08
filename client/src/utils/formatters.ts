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
  return inrFormatter.format(Math.round(value));
}

/** Format with paisa preserved — only for line-item/breakdown contexts. */
export function formatINRPaisa(value: number): string {
  return inrPaisaFormatter.format(value);
}

/** Format an ISO date string as "14 Nov 2025". */
export function formatDate(dateStr: string): string {
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
