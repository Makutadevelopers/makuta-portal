// tds.controller.ts
// GET /api/tds?from=&to=&site=  — TDS register (deductions withheld in a period)

import { Request, Response, NextFunction } from 'express';
import { getTdsRegister } from '../services/tds.service';
import { scopedSites } from '../middleware/auth';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reject anything that isn't a canonical YYYY-MM-DD rather than letting Postgres
 * coerce it — a silently-misread bound would understate the register, which is
 * the one thing an audit report must never do.
 */
function parseDateParam(raw: unknown, label: string): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const s = String(raw);
  if (!DATE_RE.test(s)) {
    throw Object.assign(new Error(`${label} must be YYYY-MM-DD`), { status: 400 });
  }
  return s;
}

export async function getTds(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const from = parseDateParam(req.query.from, 'from');
    const to = parseDateParam(req.query.to, 'to');

    if (from && to && from > to) {
      res.status(400).json({ error: 'Bad Request', message: '"from" must not be after "to"' });
      return;
    }

    const site = (req.query.site as string) || 'All';
    // ho + mgmt are unscoped (scopedSites → undefined); the cap is honoured
    // anyway so this endpoint stays correct if the route guard ever widens.
    const allowedSites = scopedSites(req.user);
    if (allowedSites && site !== 'All' && !allowedSites.includes(site)) {
      res.status(403).json({ error: 'Forbidden', message: 'You are not assigned to this site' });
      return;
    }

    const register = await getTdsRegister({ from, to, site, allowedSites });
    res.json(register);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400) {
      res.status(400).json({ error: 'Bad Request', message: (err as Error).message });
      return;
    }
    next(err);
  }
}
