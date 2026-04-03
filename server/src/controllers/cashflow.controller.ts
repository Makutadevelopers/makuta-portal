// cashflow.controller.ts
// GET /api/cashflow — ho + mgmt only
// Returns invoices grouped by category x month with
// invoice amounts (expenditure) and payment amounts (cashflow).

import { Request, Response, NextFunction } from 'express';
import { query } from '../db/query';

interface CashflowRow {
  month: string;
  purpose: string;
  total_invoiced: number;
  total_paid: number;
  invoice_count: number;
}

export async function getCashflow(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await query<CashflowRow>(
      `SELECT
         TO_CHAR(i.month, 'YYYY-MM') AS month,
         i.purpose,
         SUM(i.invoice_amount) AS total_invoiced,
         COALESCE(SUM(p.total_paid), 0) AS total_paid,
         COUNT(i.id)::INT AS invoice_count
       FROM invoices i
       LEFT JOIN (
         SELECT invoice_id, SUM(amount) AS total_paid
         FROM payments
         GROUP BY invoice_id
       ) p ON p.invoice_id = i.id
       GROUP BY TO_CHAR(i.month, 'YYYY-MM'), i.purpose
       ORDER BY month DESC, i.purpose`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}
