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
export async function getAgingData(siteFilter?: string, allowedSites?: string[]): Promise<{
  withinTerms: AgingRow[];
  overdue: AgingRow[];
}> {
  // Two independent constraints:
  //  - siteFilter: the UI's site dropdown ('All' or one site).
  //  - allowedSites: a hard role-scope cap (project managers see only their
  //    assigned sites). When provided it ALWAYS applies, even for 'All', so a
  //    scoped user can never widen past their assignment. undefined = no cap.
  const clauses: string[] = [];
  const params: (string | string[])[] = [];
  if (siteFilter && siteFilter !== 'All') {
    params.push(siteFilter);
    clauses.push(`AND i.site = $${params.length}`);
  }
  if (allowedSites) {
    params.push(allowedSites);
    clauses.push(`AND i.site = ANY($${params.length})`);
  }
  const siteClause = clauses.join('\n     ');

  // L6: Use DATE math (not NOW() timestamps) so the day-count is stable
  // regardless of server timezone. CURRENT_DATE is the server-local date.
  // We cast due_date to DATE and subtract, which yields an integer number of whole days.
  // Balance = invoice_amount − payments − credit-note allocations
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
       (i.invoice_amount - COALESCE(p.total_paid, 0) - COALESCE(c.total_credits, 0)) AS balance,
       (CURRENT_DATE - (i.invoice_date + COALESCE(v.payment_terms, 30) * INTERVAL '1 day')::DATE) AS days_past_due,
       ((i.invoice_date + COALESCE(v.payment_terms, 30) * INTERVAL '1 day')::DATE - CURRENT_DATE) AS days_left,
       CASE
         WHEN CURRENT_DATE > (i.invoice_date + COALESCE(v.payment_terms, 30) * INTERVAL '1 day')::DATE
              AND (i.invoice_amount - COALESCE(p.total_paid, 0) - COALESCE(c.total_credits, 0)) > 0
         THEN TRUE ELSE FALSE
       END AS overdue,
       i.payment_status
     FROM invoices i
     LEFT JOIN vendors v ON v.id = i.vendor_id
     LEFT JOIN (
       -- TDS settles the invoice from the vendor's POV, so it counts toward
       -- total_paid here (same rule as paymentStatusCase). Cashflow reports
       -- still sum just amount because TDS doesn't leave the business.
       SELECT invoice_id, SUM(amount + tds_amount + gst_tds_amount) AS total_paid
       FROM payments
       GROUP BY invoice_id
     ) p ON p.invoice_id = i.id
     LEFT JOIN (
       SELECT invoice_id, SUM(allocated_amount) AS total_credits
       FROM credit_note_allocations
       GROUP BY invoice_id
     ) c ON c.invoice_id = i.id
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
