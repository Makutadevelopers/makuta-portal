// invoice.controller.ts
// GET   /api/invoices          — filtered by role
// POST  /api/invoices          — ho + site
// PATCH /api/invoices/:id      — ho + site (own site only)
// POST  /api/invoices/:id/push — ho only
//
// CRITICAL: site role NEVER receives payment_status, payment amounts, or aging data.

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/query';

const createInvoiceSchema = z.object({
  month: z.string().min(1, 'Month is required'),
  invoice_date: z.string().min(1, 'Invoice date is required'),
  vendor_id: z.string().uuid('Valid vendor_id is required'),
  vendor_name: z.string().min(1, 'Vendor name is required'),
  invoice_no: z.string().min(1, 'Invoice number is required'),
  po_number: z.string().nullable().optional(),
  purpose: z.string().min(1, 'Purpose is required'),
  site: z.string().min(1, 'Site is required'),
  invoice_amount: z.number().positive('Amount must be positive'),
  remarks: z.string().nullable().optional(),
});

const updateInvoiceSchema = createInvoiceSchema.partial();

// Columns safe for site role — excludes all payment-related fields
const SITE_COLUMNS = `
  id, sl_no, month, invoice_date, vendor_id, vendor_name,
  invoice_no, po_number, purpose, site, invoice_amount,
  remarks, pushed, pushed_at, minor_payment,
  created_by, created_at, updated_at
`;

// All columns for ho and mgmt
const FULL_COLUMNS = `*`;

interface InvoiceRow {
  id: string;
  [key: string]: unknown;
}

export async function getInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, site } = req.user!;

    if (role === 'site') {
      // Site: own site only, NO payment data
      const invoices = await query<InvoiceRow>(
        `SELECT ${SITE_COLUMNS} FROM invoices WHERE site = $1 ORDER BY invoice_date DESC`,
        [site]
      );
      res.json(invoices);
    } else {
      // ho + mgmt: all invoices, full data
      const invoices = await query<InvoiceRow>(
        `SELECT ${FULL_COLUMNS} FROM invoices ORDER BY invoice_date DESC`
      );
      res.json(invoices);
    }
  } catch (err) {
    next(err);
  }
}

export async function createInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createInvoiceSchema.parse(req.body);
    const { role, site, id: userId } = req.user!;

    // Site accountants can only create invoices for their own site
    if (role === 'site' && data.site !== site) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only create invoices for your own site' });
      return;
    }

    const invoice = await queryOne<InvoiceRow>(
      `INSERT INTO invoices (
        month, invoice_date, vendor_id, vendor_name, invoice_no, po_number,
        purpose, site, invoice_amount, remarks, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        data.month, data.invoice_date, data.vendor_id, data.vendor_name,
        data.invoice_no, data.po_number ?? null, data.purpose, data.site,
        data.invoice_amount, data.remarks ?? null, userId,
      ]
    );

    res.status(201).json(invoice);
  } catch (err) {
    next(err);
  }
}

export async function updateInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const data = updateInvoiceSchema.parse(req.body);
    const { role, site } = req.user!;

    // Verify invoice exists and check site ownership
    const existing = await queryOne<InvoiceRow>(
      'SELECT id, site FROM invoices WHERE id = $1',
      [id]
    );

    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }

    if (role === 'site' && existing.site !== site) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only edit invoices for your own site' });
      return;
    }

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

    fields.push('updated_at = NOW()');
    values.push(id);

    const invoice = await queryOne<InvoiceRow>(
      `UPDATE invoices SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json(invoice);
  } catch (err) {
    next(err);
  }
}

export async function pushInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const invoice = await queryOne<InvoiceRow>(
      `UPDATE invoices
       SET pushed = TRUE, pushed_at = NOW(), approved_by = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [userId, id]
    );

    if (!invoice) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }

    res.json(invoice);
  } catch (err) {
    next(err);
  }
}
