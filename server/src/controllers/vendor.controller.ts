// vendor.controller.ts
// GET  /api/vendors     — all authenticated roles
// POST /api/vendors     — ho only
// PATCH /api/vendors/:id — ho only

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/query';

const createVendorSchema = z.object({
  name: z.string().min(1, 'Vendor name is required'),
  payment_terms: z.number().int().positive().default(30),
  category: z.string().nullable().optional(),
  gstin: z.string().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const updateVendorSchema = createVendorSchema.partial();

interface VendorRow {
  id: string;
  name: string;
  payment_terms: number;
  category: string | null;
  gstin: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function getVendors(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const vendors = await query<VendorRow>(
      'SELECT * FROM vendors ORDER BY name'
    );
    res.json(vendors);
  } catch (err) {
    next(err);
  }
}

export async function createVendor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createVendorSchema.parse(req.body);

    const vendor = await queryOne<VendorRow>(
      `INSERT INTO vendors (name, payment_terms, category, gstin, contact_name, phone, email, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.name,
        data.payment_terms,
        data.category ?? null,
        data.gstin ?? null,
        data.contact_name ?? null,
        data.phone ?? null,
        data.email ?? null,
        data.notes ?? null,
        req.user!.id,
      ]
    );

    res.status(201).json(vendor);
  } catch (err) {
    next(err);
  }
}

export async function updateVendor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const data = updateVendorSchema.parse(req.body);

    // Build SET clause dynamically from provided fields
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        fields.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'No fields to update' });
      return;
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const vendor = await queryOne<VendorRow>(
      `UPDATE vendors SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (!vendor) {
      res.status(404).json({ error: 'Not Found', message: 'Vendor not found' });
      return;
    }

    res.json(vendor);
  } catch (err) {
    next(err);
  }
}
