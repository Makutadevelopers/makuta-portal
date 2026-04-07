// audit.controller.ts
// GET /api/audit — ho only
// Returns audit_logs joined with user names, sorted newest first.

import { Request, Response, NextFunction } from 'express';
import { query } from '../db/query';

interface AuditRow {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  invoice_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function getAuditLogs(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const logs = await query<AuditRow>(
      `SELECT
         a.id, a.user_id, u.name AS user_name,
         a.action, a.invoice_id, a.metadata, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC`
    );
    res.json(logs);
  } catch (err) {
    next(err);
  }
}

export async function getInvoiceHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { invoiceId } = req.params;
    const logs = await query<AuditRow>(
      `SELECT
         a.id, a.user_id, u.name AS user_name,
         a.action, a.invoice_id, a.metadata, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.invoice_id = $1
       ORDER BY a.created_at DESC`,
      [invoiceId]
    );
    res.json(logs);
  } catch (err) {
    next(err);
  }
}
