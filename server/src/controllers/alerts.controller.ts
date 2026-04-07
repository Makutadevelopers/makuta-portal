// alerts.controller.ts
// GET  /api/alerts         — list unresolved alerts (ho only)
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

export async function getAlerts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const alerts = await query<AlertRow>(
      'SELECT * FROM alerts WHERE resolved = FALSE ORDER BY created_at DESC LIMIT 50'
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

export async function getAlertCount(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await queryOne<{ count: number }>(
      'SELECT COUNT(*)::INT AS count FROM alerts WHERE resolved = FALSE'
    );
    res.json({ count: result?.count ?? 0 });
  } catch (err) {
    next(err);
  }
}
