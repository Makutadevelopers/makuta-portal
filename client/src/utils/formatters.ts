// Shared formatting utilities used across all pages.

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** Format a number as ₹X,XX,XXX (en-IN locale, no decimals). */
export function formatINR(value: number): string {
  return inrFormatter.format(value);
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
