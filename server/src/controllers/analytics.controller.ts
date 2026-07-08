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
import { scopedSites } from '../middleware/auth';

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

// Per-invoice paid total, joined once and reused by every aggregate below.
const PAID_JOIN = `
  LEFT JOIN (
    SELECT invoice_id, SUM(amount) AS paid
    FROM payments
    GROUP BY invoice_id
  ) pay ON pay.invoice_id = i.id`;

export async function getAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const site = (req.query.site as string) || 'All';
    const month = (req.query.month as string) || 'All'; // 'YYYY-MM' or 'All'

    // Project managers are hard-capped to their assigned sites; ho/mgmt are not.
    const allowedSites = scopedSites(req.user);
    if (allowedSites && site !== 'All' && !allowedSites.includes(site)) {
      res.status(403).json({ error: 'Forbidden', message: 'You are not assigned to this site' });
      return;
    }

    // Build a WHERE clause + positional params for the subset of filters a
    // given query should honour. Each query gets its own params array because
    // placeholders are positional ($1, $2, …). The role site-cap is appended to
    // EVERY query so a project manager's totals never include other sites.
    function buildWhere(opts: { site: boolean; month: boolean }): { where: string; params: (string | string[])[] } {
      const conds = ['i.deleted_at IS NULL'];
      const params: (string | string[])[] = [];
      if (opts.site && site !== 'All') {
        conds.push(`i.site = $${params.length + 1}`);
        params.push(site);
      }
      if (opts.month && month !== 'All') {
        conds.push(`TO_CHAR(i.invoice_date, 'YYYY-MM') = $${params.length + 1}`);
        params.push(month);
      }
      if (allowedSites) {
        conds.push(`i.site = ANY($${params.length + 1}::text[])`);
        params.push(allowedSites);
      }
      return { where: `WHERE ${conds.join(' AND ')}`, params };
    }

    const main = buildWhere({ site: true, month: true });
    const monthly = await query<MonthlyRow>(
      `SELECT
         TO_CHAR(i.invoice_date, 'YYYY-MM')                              AS month,
         COUNT(*)::int                                                   AS "invoiceCount",
         COALESCE(SUM(i.invoice_amount), 0)                             AS "totalInvoiced",
         COALESCE(SUM(pay.paid), 0)                                    AS "totalPaid",
         COALESCE(SUM(i.invoice_amount), 0) - COALESCE(SUM(pay.paid), 0) AS balance
       FROM invoices i
       ${PAID_JOIN}
       ${main.where}
       GROUP BY TO_CHAR(i.invoice_date, 'YYYY-MM')
       ORDER BY month`,
      main.params
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
       ${PAID_JOIN}
       ${main.where}
       GROUP BY i.vendor_name
       ORDER BY balance DESC, "totalInvoiced" DESC`,
      main.params
    );

    const months = buildWhere({ site: true, month: false });
    const monthsRows = await query<{ month: string }>(
      `SELECT DISTINCT TO_CHAR(i.invoice_date, 'YYYY-MM') AS month
       FROM invoices i
       ${months.where}
       ORDER BY month DESC`,
      months.params
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
