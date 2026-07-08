// aging.controller.ts
// GET /api/aging?site=All — ho + mgmt only
// Returns withinTerms and overdue as two separate arrays.

import { Request, Response, NextFunction } from 'express';
import { getAgingData } from '../services/aging.service';
import { scopedSites } from '../middleware/auth';

export async function getAging(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const site = (req.query.site as string) || 'All';
    // Project managers are hard-capped to their assigned sites; ho/mgmt are not.
    const allowedSites = scopedSites(req.user);
    if (allowedSites && site !== 'All' && !allowedSites.includes(site)) {
      res.status(403).json({ error: 'Forbidden', message: 'You are not assigned to this site' });
      return;
    }
    const data = await getAgingData(site, allowedSites);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
