// cashflow.controller.ts
// GET /api/cashflow?site=All&category=All — ho + mgmt only
// Returns expenditure (by invoice_date month) and cashflow (by payment_date month)

import { Request, Response, NextFunction } from 'express';
import { query } from '../db/query';

interface PivotRow {
  month: string;
  purpose: string;
  total: number;
}

export async function getCashflow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const site = (req.query.site as string) || 'All';
    const category = (req.query.category as string) || 'All';

    const conditions: string[] = [];
    const params: string[] = [];
    let idx = 1;

    if (site !== 'All') {
      conditions.push(`i.site = $${idx++}`);
      params.push(site);
    }
    if (category !== 'All') {
      conditions.push(`i.purpose = $${idx++}`);
      params.push(category);
    }

    // Always exclude soft-deleted invoices
    conditions.push('i.deleted_at IS NULL');
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // When a specific category is selected, group by vendor_name instead of purpose
    const groupCol = category !== 'All' ? 'i.vendor_name' : 'i.purpose';

    // Expenditure: grouped by accounting month
    const expenditure = await query<PivotRow>(
      `SELECT
         TO_CHAR(i.month, 'YYYY-MM') AS month,
         ${groupCol} AS purpose,
         SUM(i.invoice_amount) AS total
       FROM invoices i
       ${whereClause}
       GROUP BY TO_CHAR(i.month, 'YYYY-MM'), ${groupCol}
       ORDER BY month, ${groupCol}`,
      params
    );

    // Cashflow: grouped by payment_month (matches Google Sheet Cashflow Summary)
    const cashflow = await query<PivotRow>(
      `SELECT
         TO_CHAR(COALESCE(p.payment_month, p.payment_date), 'YYYY-MM') AS month,
         ${groupCol} AS purpose,
         SUM(p.amount) AS total
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       ${whereClause}
       GROUP BY TO_CHAR(COALESCE(p.payment_month, p.payment_date), 'YYYY-MM'), ${groupCol}
       ORDER BY month, ${groupCol}`,
      params
    );

    res.json({ expenditure, cashflow });
  } catch (err) {
    next(err);
  }
}
