// alerts.controller.ts
// GET  /api/alerts         — list unresolved alerts (filtered by role)
// GET  /api/alerts/count   — badge count (filtered by role)
// POST /api/alerts/:id/resolve — mark alert as resolved

import { Request, Response, NextFunction } from 'express';
import { query, queryOne } from '../db/query';

interface AlertRow {
  id: string;
  alert_type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  resolved: boolean;
  created_at: string;
}

// Each role sees only the alert types relevant to their job: HO handles
// invoice/vendor data hygiene; MD handles employee-account requests.
const ALERTS_BY_ROLE: Record<string, string[]> = {
  ho: ['duplicate_invoice', 'vendor_dedup'],
  mgmt: ['password_reset_request'],
};

function alertTypesForRole(role: string | undefined): string[] {
  return ALERTS_BY_ROLE[role ?? ''] ?? [];
}

export async function getAlerts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const types = alertTypesForRole(req.user?.role);
    if (types.length === 0) {
      res.json([]);
      return;
    }
    const alerts = await query<AlertRow>(
      `SELECT * FROM alerts
        WHERE resolved = FALSE AND alert_type = ANY($1::text[])
        ORDER BY created_at DESC LIMIT 50`,
      [types]
    );
    res.json(alerts);
  } catch (err) {
    next(err);
  }
}

export async function resolveAlert(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const alert = await queryOne<AlertRow>(
      'UPDATE alerts SET resolved = TRUE, resolved_by = $1, resolved_at = NOW() WHERE id = $2 RETURNING *',
      [req.user!.id, id]
    );
    if (!alert) {
      res.status(404).json({ error: 'Not Found', message: 'Alert not found' });
      return;
    }
    res.json(alert);
  } catch (err) {
    next(err);
  }
}

export async function getAlertCount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const types = alertTypesForRole(req.user?.role);
    if (types.length === 0) {
      res.json({ count: 0 });
      return;
    }
    const result = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::INT AS count FROM alerts
        WHERE resolved = FALSE AND alert_type = ANY($1::text[])`,
      [types]
    );
    res.json({ count: result?.count ?? 0 });
  } catch (err) {
    next(err);
  }
}
