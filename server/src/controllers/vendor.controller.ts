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
  dismissDuplicatePair,
  mergeVendors as mergeVendorsService,
  revertVendorMerge as revertVendorMergeService,
  listVendorMerges as listVendorMergesService,
  getVendorMergeById,
  getVendorDetail as getVendorDetailService,
} from '../services/vendor.service';
import { logAudit } from '../services/audit.service';

const createVendorSchema = z.object({
  name: z.string().min(1, 'Vendor name is required').trim(),
  payment_terms: z.number().int().min(1).max(365).default(30),
  category: z.string().nullable().optional(),
  gstin: z.string().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  phone: z.string()
    .nullable()
    .optional()
    .transform(v => (v == null ? null : v.trim() || null)),
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

    // Site accountants may only edit vendors they created themselves.
    if (req.user!.role === 'site') {
      const target = await getVendorById(id);
      if (!target) {
        res.status(404).json({ error: 'Not Found', message: 'Vendor not found' });
        return;
      }
      if (target.created_by !== req.user!.id) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Site accountants may only edit vendors they added themselves',
        });
        return;
      }
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

    // Site accountants may only delete vendors they created themselves.
    if (req.user!.role === 'site') {
      const target = await getVendorById(id);
      if (!target) {
        res.status(404).json({ error: 'Not Found', message: 'Vendor not found' });
        return;
      }
      if (target.created_by !== req.user!.id) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Site accountants may only delete vendors they added themselves',
        });
        return;
      }
    }

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

export async function getVendorDetailHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Site role can view vendor detail too, but their invoice list and the
    // accompanying stats must be scoped to the sites they're assigned to —
    // they should never see a row from another project.
    let siteFilter: string[] | undefined;
    if (req.user!.role === 'site') {
      siteFilter = (req.user!.sites && req.user!.sites.length > 0)
        ? req.user!.sites
        : (req.user!.site ? [req.user!.site] : []);
      if (siteFilter.length === 0) {
        res.status(403).json({ error: 'Forbidden', message: 'No sites assigned to this account' });
        return;
      }
    }
    const detail = await getVendorDetailService(req.params.id as string, { siteFilter });
    if (!detail) {
      res.status(404).json({ error: 'Not Found', message: 'Vendor not found' });
      return;
    }
    res.json(detail);
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

const dismissBodySchema = z.object({
  vendorAId: z.string().uuid(),
  vendorBId: z.string().uuid(),
});

export async function dismissDuplicate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { vendorAId, vendorBId } = dismissBodySchema.parse(req.body);
    if (vendorAId === vendorBId) {
      res.status(400).json({ error: 'Bad Request', message: 'Cannot dismiss a pair of the same vendor' });
      return;
    }
    await dismissDuplicatePair(vendorAId, vendorBId, req.user!.id);
    res.json({ ok: true });
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

    // Site accountants can merge any two vendors. The audit log records who
    // did the merge and revert is one click from Recent Merges, so HO has a
    // clear undo path if a merge was wrong.
    const result = await mergeVendorsService(keepId, removeId, req.user!.id);
    if (!result) {
      res.status(404).json({ error: 'Not Found', message: 'One or both vendors not found' });
      return;
    }

    await logAudit({
      userId: req.user!.id,
      action: `Merged vendor "${result.removedName}" into "${result.keptVendor.name}" (${result.repointedCount} invoice${result.repointedCount === 1 ? '' : 's'} re-pointed)`,
      metadata: {
        mergeId: result.mergeId,
        keepId,
        removeId,
        repointedCount: result.repointedCount,
        removedName: result.removedName,
      },
    });

    res.json({
      ...result.keptVendor,
      mergeId: result.mergeId,
      repointedCount: result.repointedCount,
      removedName: result.removedName,
    });
  } catch (err) {
    next(err);
  }
}

// ── Revert + list ─────────────────────────────────────────────────────────

export async function listVendorMerges(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const role = req.user!.role;
    const includeReverted = req.query.includeReverted === 'true';
    const merges = await listVendorMergesService({
      // Site accountants only see their own merges.  HO/mgmt see everything.
      onlyUserId: role === 'site' ? req.user!.id : undefined,
      includeReverted,
      limit: 100,
    });
    res.json(merges);
  } catch (err) {
    next(err);
  }
}

export async function revertVendorMerge(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = req.params.id as string;
    const merge = await getVendorMergeById(id);
    if (!merge) {
      res.status(404).json({ error: 'Not Found', message: 'Merge record not found' });
      return;
    }
    if (merge.reverted_at) {
      res.status(409).json({ error: 'Conflict', message: 'This merge has already been reverted' });
      return;
    }
    if (req.user!.role === 'site' && merge.merged_by !== req.user!.id) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only revert merges you performed. Ask HO to revert this one.',
      });
      return;
    }

    const result = await revertVendorMergeService(id, req.user!.id);
    if (!result) {
      res.status(409).json({ error: 'Conflict', message: 'Could not revert merge' });
      return;
    }

    await logAudit({
      userId: req.user!.id,
      action: `Reverted vendor merge — restored "${result.restoredVendor.name}" (${result.restoredInvoiceCount} invoice${result.restoredInvoiceCount === 1 ? '' : 's'} re-pointed back)`,
      metadata: {
        mergeId: id,
        restoredVendorId: result.restoredVendor.id,
        restoredVendorName: result.restoredVendor.name,
        restoredInvoiceCount: result.restoredInvoiceCount,
      },
    });

    res.json({
      ok: true,
      restoredVendor: result.restoredVendor,
      restoredInvoiceCount: result.restoredInvoiceCount,
    });
  } catch (err) {
    next(err);
  }
}
