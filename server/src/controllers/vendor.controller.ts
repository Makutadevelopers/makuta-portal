// vendor.controller.ts
// GET  /api/vendors       — all authenticated roles
// GET  /api/vendors/:id   — all authenticated roles
// POST /api/vendors       — ho only
// PATCH /api/vendors/:id  — ho only

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getAllVendors,
  getVendorById,
  getVendorByName,
  createVendor as createVendorService,
  updateVendor as updateVendorService,
  deleteVendor as deleteVendorService,
  findSimilarVendors,
  findAllDuplicatePairs,
  mergeVendors as mergeVendorsService,
} from '../services/vendor.service';
import { logAudit } from '../services/audit.service';

const createVendorSchema = z.object({
  name: z.string().min(1, 'Vendor name is required').trim(),
  payment_terms: z.number().int().min(1).max(365).default(30),
  category: z.string().nullable().optional(),
  gstin: z.string().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const updateVendorSchema = createVendorSchema.partial();

export async function getVendors(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const vendors = await getAllVendors();
    res.json(vendors);
  } catch (err) {
    next(err);
  }
}

export async function getVendor(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const vendor = await getVendorById(req.params.id as string);
    if (!vendor) {
      res.status(404).json({ error: 'Not Found', message: 'Vendor not found' });
      return;
    }
    res.json(vendor);
  } catch (err) {
    next(err);
  }
}

export async function createVendor(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = createVendorSchema.parse(req.body);

    const existing = await getVendorByName(data.name);
    if (existing) {
      res.status(409).json({
        error: 'Conflict',
        message: `Vendor "${data.name}" already exists`,
      });
      return;
    }

    const vendor = await createVendorService(data, req.user!.id);

    await logAudit({
      userId: req.user!.id,
      action: `Added vendor "${data.name}" to Vendor Master (${data.payment_terms ?? 30}-day terms)`,
    });

    res.status(201).json(vendor);
  } catch (err) {
    next(err);
  }
}

export async function updateVendor(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = req.params.id as string;
    const data = updateVendorSchema.parse(req.body);

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'No fields to update' });
      return;
    }

    // If renaming, check uniqueness against other vendors
    if (data.name) {
      const existing = await getVendorByName(data.name);
      if (existing && existing.id !== id) {
        res.status(409).json({
          error: 'Conflict',
          message: `Vendor "${data.name}" already exists`,
        });
        return;
      }
    }

    const vendor = await updateVendorService(id, data, req.user!.id);
    if (!vendor) {
      res.status(404).json({ error: 'Not Found', message: 'Vendor not found' });
      return;
    }

    await logAudit({
      userId: req.user!.id,
      action: `Updated vendor "${vendor.name}" in Vendor Master`,
    });

    res.json(vendor);
  } catch (err) {
    next(err);
  }
}

export async function deleteVendor(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = req.params.id as string;
    const vendor = await deleteVendorService(id);

    if (!vendor) {
      res.status(404).json({ error: 'Not Found', message: 'Vendor not found' });
      return;
    }

    await logAudit({
      userId: req.user!.id,
      action: `Removed vendor "${vendor.name}" from Vendor Master`,
    });

    res.json({ message: 'Vendor deleted', vendor });
  } catch (err) {
    next(err);
  }
}

export async function getSimilar(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const name = req.query.name;
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Bad Request', message: 'Query parameter "name" is required' });
      return;
    }
    const matches = await findSimilarVendors(name);
    res.json(matches);
  } catch (err) {
    next(err);
  }
}

export async function getDuplicates(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const pairs = await findAllDuplicatePairs();
    res.json(pairs);
  } catch (err) {
    next(err);
  }
}

const mergeBodySchema = z.object({
  keepId: z.string().uuid(),
  removeId: z.string().uuid(),
});

export async function mergeVendors(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { keepId, removeId } = mergeBodySchema.parse(req.body);

    if (keepId === removeId) {
      res.status(400).json({ error: 'Bad Request', message: 'Cannot merge a vendor with itself' });
      return;
    }

    const result = await mergeVendorsService(keepId, removeId);
    if (!result) {
      res.status(404).json({ error: 'Not Found', message: 'One or both vendors not found' });
      return;
    }

    await logAudit({
      userId: req.user!.id,
      action: `Merged vendor "${result.removedName}" into "${result.keptVendor.name}" (${result.repointedCount} invoice${result.repointedCount === 1 ? '' : 's'} re-pointed)`,
      metadata: { keepId, removeId, repointedCount: result.repointedCount, removedName: result.removedName },
    });

    res.json({
      ...result.keptVendor,
      repointedCount: result.repointedCount,
      removedName: result.removedName,
    });
  } catch (err) {
    next(err);
  }
}
