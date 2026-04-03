// aging.controller.ts
// GET /api/aging?site=All — ho + mgmt only
// Returns withinTerms and overdue as two separate arrays.

import { Request, Response, NextFunction } from 'express';
import { getAgingData } from '../services/aging.service';

export async function getAging(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const site = (req.query.site as string) || 'All';
    const data = await getAgingData(site);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
