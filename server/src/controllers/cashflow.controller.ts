// cashflow.controller.ts
// GET /api/cashflow?site=All&category=All&vendor= — ho + mgmt only
// Returns expenditure (by invoice_date month) and cashflow (by payment_date month)

import { Request, Response, NextFunction } from 'express';
import { query } from '../db/query';
import { scopedSites } from '../middleware/auth';

interface PivotRow {
  month: string;
  purpose: string;
  total: number;
}

export async function getCashflow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const site = (req.query.site as string) || 'All';
    const category = (req.query.category as string) || 'All';
    const vendor = (req.query.vendor as string) || '';

    // Project managers are hard-capped to their assigned sites; ho/mgmt are not.
    const allowedSites = scopedSites(req.user);
    if (allowedSites && site !== 'All' && !allowedSites.includes(site)) {
      res.status(403).json({ error: 'Forbidden', message: 'You are not assigned to this site' });
      return;
    }

    const conditions: string[] = [];
    const params: (string | string[])[] = [];
    let idx = 1;

    if (site !== 'All') {
      conditions.push(`i.site = $${idx++}`);
      params.push(site);
    }
    if (category !== 'All') {
      conditions.push(`i.purpose = $${idx++}`);
      params.push(category);
    }
    if (vendor) {
      // Case-insensitive so a vendor picked from the dropdown matches its
      // invoices regardless of stored casing variants.
      conditions.push(`LOWER(TRIM(i.vendor_name)) = LOWER(TRIM($${idx++}))`);
      params.push(vendor);
    }
    if (allowedSites) {
      conditions.push(`i.site = ANY($${idx++}::text[])`);
      params.push(allowedSites);
    }

    // Always exclude soft-deleted invoices
    conditions.push('i.deleted_at IS NULL');
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Drill into vendors when a category is picked; otherwise group by category.
    // When vendor is picked alone, keep category grouping so the user sees the
    // vendor's spend broken down by category.
    //
    // For the vendor breakdown, group on the CANONICAL identity rather than the
    // raw vendor_name text: prefer the linked Vendor Master name, fall back to
    // the denormalised text, and collapse case/whitespace variants. This mirrors
    // Vendor Master's aggregation so one vendor never splits into two rows over
    // a casing difference (e.g. "ROBO SILICON..." vs "Robo Silicon..."). The
    // displayed label picks a representative canonical name via MAX().
    const byVendor = category !== 'All';
    const vendorJoin = byVendor ? 'LEFT JOIN vendors v ON v.id = i.vendor_id' : '';
    const groupExpr = byVendor
      ? 'LOWER(TRIM(COALESCE(v.name, i.vendor_name)))'
      : 'i.purpose';
    const labelExpr = byVendor
      ? 'MAX(COALESCE(v.name, i.vendor_name))'
      : 'i.purpose';

    // Expenditure: grouped by accounting month
    const expenditure = await query<PivotRow>(
      `SELECT
         TO_CHAR(i.month, 'YYYY-MM') AS month,
         ${labelExpr} AS purpose,
         SUM(i.invoice_amount) AS total
       FROM invoices i
       ${vendorJoin}
       ${whereClause}
       GROUP BY TO_CHAR(i.month, 'YYYY-MM'), ${groupExpr}
       ORDER BY month, purpose`,
      params
    );

    // Cashflow: grouped by payment_month (matches Google Sheet Cashflow Summary)
    const cashflow = await query<PivotRow>(
      `SELECT
         TO_CHAR(COALESCE(p.payment_month, p.payment_date), 'YYYY-MM') AS month,
         ${labelExpr} AS purpose,
         SUM(p.amount) AS total
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       ${vendorJoin}
       ${whereClause}
       GROUP BY TO_CHAR(COALESCE(p.payment_month, p.payment_date), 'YYYY-MM'), ${groupExpr}
       ORDER BY month, purpose`,
      params
    );

    res.json({ expenditure, cashflow });
  } catch (err) {
    next(err);
  }
}
