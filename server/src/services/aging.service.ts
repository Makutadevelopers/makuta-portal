// aging.service.ts
// Aging calculation logic.
// Vendor due date = invoice_date + vendor.payment_terms (days)
// Overdue = today > due_date AND balance > 0

import { query } from '../db/query';

export interface AgingRow {
  invoice_id: string;
  invoice_no: string;
  vendor_name: string;
  site: string;
  invoice_date: string;
  invoice_amount: number;
  payment_terms: number;
  due_date: string;
  total_paid: number;
  balance: number;
  days_past_due: number;
  days_left: number;
  overdue: boolean;
  payment_status: string;
}

/**
 * Get aging data for all unpaid/partial invoices joined with vendor payment terms.
 * Returns two arrays: withinTerms and overdue.
 */
export async function getAgingData(siteFilter?: string): Promise<{
  withinTerms: AgingRow[];
  overdue: AgingRow[];
}> {
  const siteClause = siteFilter && siteFilter !== 'All' ? 'AND i.site = $1' : '';
  const params = siteFilter && siteFilter !== 'All' ? [siteFilter] : [];

  // L6: Use DATE math (not NOW() timestamps) so the day-count is stable
  // regardless of server timezone. CURRENT_DATE is the server-local date.
  // We cast due_date to DATE and subtract, which yields an integer number of whole days.
  const rows = await query<AgingRow>(
    `SELECT
       i.id AS invoice_id,
       i.invoice_no,
       i.vendor_name,
       i.site,
       i.invoice_date,
       i.invoice_amount,
       COALESCE(v.payment_terms, 30) AS payment_terms,
       (i.invoice_date + COALESCE(v.payment_terms, 30) * INTERVAL '1 day')::DATE AS due_date,
       COALESCE(p.total_paid, 0) AS total_paid,
       i.invoice_amount - COALESCE(p.total_paid, 0) AS balance,
       (CURRENT_DATE - (i.invoice_date + COALESCE(v.payment_terms, 30) * INTERVAL '1 day')::DATE) AS days_past_due,
       ((i.invoice_date + COALESCE(v.payment_terms, 30) * INTERVAL '1 day')::DATE - CURRENT_DATE) AS days_left,
       CASE
         WHEN CURRENT_DATE > (i.invoice_date + COALESCE(v.payment_terms, 30) * INTERVAL '1 day')::DATE
              AND i.invoice_amount - COALESCE(p.total_paid, 0) > 0
         THEN TRUE ELSE FALSE
       END AS overdue,
       i.payment_status
     FROM invoices i
     LEFT JOIN vendors v ON v.id = i.vendor_id
     LEFT JOIN (
       SELECT invoice_id, SUM(amount) AS total_paid
       FROM payments
       GROUP BY invoice_id
     ) p ON p.invoice_id = i.id
     WHERE i.payment_status IN ('Not Paid', 'Partial')
       AND i.deleted_at IS NULL
     ${siteClause}
     ORDER BY overdue DESC, days_past_due DESC`,
    params
  );

  const withinTerms: AgingRow[] = [];
  const overdue: AgingRow[] = [];

  for (const row of rows) {
    if (row.overdue) {
      overdue.push(row);
    } else {
      withinTerms.push(row);
    }
  }

  return { withinTerms, overdue };
}
