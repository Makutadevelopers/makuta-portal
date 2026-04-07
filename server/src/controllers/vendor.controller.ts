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
    const vendor = await getVendorById(req.params.id);
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
    const { id } = req.params;
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
    const { id } = req.params;
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
