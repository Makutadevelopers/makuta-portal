// analytics.controller.ts
// GET /api/analytics?site=All&month=All — ho + mgmt only
// Powers the Analytics dashboard:
//   - monthly: per (invoice_date) month — invoice count, total invoiced,
//     total paid against those invoices, and remaining balance
//   - vendors: per vendor — invoices raised, total invoiced, invoices
//     fully cleared, total amount paid, and remaining balance
//   - availableMonths: distinct months (site-filtered) for the month dropdown
//
// "Amount paid" / "total cleared" is the sum of all payments recorded against
// the invoice (incl. part-payments) — never trust the payment_status label for
// the rupee figure, only for the cleared-invoice count.

import { Request, Response, NextFunction } from 'express';
import { query } from '../db/query';

interface MonthlyRow {
  month: string;
  invoiceCount: number;
  totalInvoiced: number;
  totalPaid: number;
  balance: number;
}

interface VendorRow {
  vendorName: string;
  invoiceCount: number;
  totalInvoiced: number;
  clearedCount: number;
  totalCleared: number;
  balance: number;
}

export async function getAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const site = (req.query.site as string) || 'All';
    const month = (req.query.month as string) || 'All'; // 'YYYY-MM' or 'All'

    // Site filter applies to every query below. Month filter applies to the
    // monthly + vendor breakdowns but NOT to availableMonths (the dropdown must
    // keep listing every month even after one is picked).
    const siteConds = ['i.deleted_at IS NULL'];
    const siteParams: string[] = [];
    if (site !== 'All') {
      siteConds.push(`i.site = $${siteParams.length + 1}`);
      siteParams.push(site);
    }

    const conds = [...siteConds];
    const params = [...siteParams];
    if (month !== 'All') {
      conds.push(`TO_CHAR(i.invoice_date, 'YYYY-MM') = $${params.length + 1}`);
      params.push(month);
    }
    const whereClause = `WHERE ${conds.join(' AND ')}`;

    // Per-invoice paid total, joined once and reused.
    const paidJoin = `
      LEFT JOIN (
        SELECT invoice_id, SUM(amount) AS paid
        FROM payments
        GROUP BY invoice_id
      ) pay ON pay.invoice_id = i.id`;

    const monthly = await query<MonthlyRow>(
      `SELECT
         TO_CHAR(i.invoice_date, 'YYYY-MM')                              AS month,
         COUNT(*)::int                                                   AS "invoiceCount",
         COALESCE(SUM(i.invoice_amount), 0)                             AS "totalInvoiced",
         COALESCE(SUM(pay.paid), 0)                                    AS "totalPaid",
         COALESCE(SUM(i.invoice_amount), 0) - COALESCE(SUM(pay.paid), 0) AS balance
       FROM invoices i
       ${paidJoin}
       ${whereClause}
       GROUP BY TO_CHAR(i.invoice_date, 'YYYY-MM')
       ORDER BY month`,
      params
    );

    const vendors = await query<VendorRow>(
      `SELECT
         i.vendor_name                                                  AS "vendorName",
         COUNT(*)::int                                                  AS "invoiceCount",
         COALESCE(SUM(i.invoice_amount), 0)                            AS "totalInvoiced",
         (COUNT(*) FILTER (WHERE i.payment_status = 'Paid'))::int       AS "clearedCount",
         COALESCE(SUM(pay.paid), 0)                                   AS "totalCleared",
         COALESCE(SUM(i.invoice_amount), 0) - COALESCE(SUM(pay.paid), 0) AS balance
       FROM invoices i
       ${paidJoin}
       ${whereClause}
       GROUP BY i.vendor_name
       ORDER BY balance DESC, "totalInvoiced" DESC`,
      params
    );

    const monthsRows = await query<{ month: string }>(
      `SELECT DISTINCT TO_CHAR(i.invoice_date, 'YYYY-MM') AS month
       FROM invoices i
       WHERE ${siteConds.join(' AND ')}
       ORDER BY month DESC`,
      siteParams
    );

    res.json({
      monthly,
      vendors,
      availableMonths: monthsRows.map(r => r.month),
    });
  } catch (err) {
    next(err);
  }
}
