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
import { logAudit } from '../services/audit.service';
import { notifyInvoicePushed } from '../services/email.service';

const createInvoiceSchema = z.object({
  month: z.string().min(1, 'Month is required'),
  invoice_date: z.string().min(1, 'Invoice date is required'),
  vendor_id: z.string().uuid().nullable().optional().or(z.literal('')).transform(v => v || null),
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
  id, sl_no, internal_no, month, invoice_date, vendor_id, vendor_name,
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
        `SELECT ${SITE_COLUMNS},
           (SELECT COUNT(*) FROM attachments a WHERE a.invoice_id = invoices.id)::int AS attachment_count
         FROM invoices WHERE site = $1 AND deleted_at IS NULL ORDER BY invoice_date DESC`,
        [site]
      );
      res.json(invoices);
    } else {
      // ho + mgmt: all invoices, full data
      const invoices = await query<InvoiceRow>(
        `SELECT ${FULL_COLUMNS},
           (SELECT COUNT(*) FROM attachments a WHERE a.invoice_id = invoices.id)::int AS attachment_count
         FROM invoices WHERE deleted_at IS NULL ORDER BY invoice_date DESC`
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

    // Check for duplicate invoice (same invoice_no + vendor_name)
    const duplicate = await queryOne<{ id: string; invoice_no: string }>(
      `SELECT id, invoice_no FROM invoices
       WHERE invoice_no = $1 AND LOWER(vendor_name) = LOWER($2) AND deleted_at IS NULL`,
      [data.invoice_no, data.vendor_name]
    );
    if (duplicate) {
      // Create alert but still allow creation
      await queryOne(
        `INSERT INTO alerts (alert_type, title, message, metadata)
         VALUES ('duplicate_invoice', $1, $2, $3)`,
        [
          `Duplicate invoice #${data.invoice_no}`,
          `Invoice #${data.invoice_no} from "${data.vendor_name}" may be a duplicate — an invoice with the same number already exists.`,
          JSON.stringify({ existingInvoiceId: duplicate.id, invoiceNo: data.invoice_no, vendorName: data.vendor_name }),
        ]
      );
    }

    // Generate internal tracking number
    const seqResult = await queryOne<{ nextval: string }>("SELECT nextval('invoice_internal_seq')");
    const internalNo = `MKT-${String(seqResult!.nextval).padStart(5, '0')}`;

    const invoice = await queryOne<InvoiceRow>(
      `INSERT INTO invoices (
        month, invoice_date, vendor_id, vendor_name, invoice_no, po_number,
        purpose, site, invoice_amount, remarks, created_by, internal_no
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        data.month, data.invoice_date, data.vendor_id, data.vendor_name,
        data.invoice_no, data.po_number ?? null, data.purpose, data.site,
        data.invoice_amount, data.remarks ?? null, userId, internalNo,
      ]
    );

    await logAudit({
      userId,
      action: `Created invoice #${data.invoice_no} — ${data.vendor_name} ₹${Number(data.invoice_amount).toLocaleString('en-IN')}`,
      invoiceId: invoice?.id,
    });

    res.status(201).json(invoice);
  } catch (err) {
    next(err);
  }
}

export async function updateInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const data = updateInvoiceSchema.parse(req.body);
    const { role, site } = req.user!;

    // Verify invoice exists, check site ownership, and check finalized status
    const existing = await queryOne<InvoiceRow>(
      'SELECT id, site, pushed FROM invoices WHERE id = $1',
      [id]
    );

    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }

    if (existing.pushed) {
      res.status(403).json({ error: 'Forbidden', message: 'Cannot edit a finalized invoice' });
      return;
    }

    if (role === 'site' && existing.site !== site) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only edit invoices for your own site' });
      return;
    }

    const ALLOWED_UPDATE_FIELDS = [
      'month', 'invoice_date', 'vendor_id', 'vendor_name', 'invoice_no',
      'po_number', 'purpose', 'site', 'invoice_amount', 'remarks',
    ];

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && ALLOWED_UPDATE_FIELDS.includes(key)) {
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

    await logAudit({
      userId: req.user!.id,
      action: `Updated invoice #${invoice?.invoice_no ?? id}`,
      invoiceId: id,
      metadata: { fields_changed: Object.keys(data) },
    });

    res.json(invoice);
  } catch (err) {
    next(err);
  }
}

export async function pushInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
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

    await logAudit({
      userId,
      action: `Finalized invoice #${invoice.invoice_no ?? id}`,
      invoiceId: id,
    });

    // Fire-and-forget email notification
    notifyInvoicePushed({
      vendorName: String(invoice.vendor_name ?? ''),
      invoiceNo: String(invoice.invoice_no ?? ''),
      amount: Number(invoice.invoice_amount ?? 0),
      site: String(invoice.site ?? ''),
      hoEmail: 'rajesh@makuta.in',
    }).catch(() => {});

    res.json(invoice);
  } catch (err) {
    next(err);
  }
}

export async function bulkPushInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const bulkSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
    const { ids } = bulkSchema.parse(req.body);
    const userId = req.user!.id;

    const result = await query<InvoiceRow>(
      `UPDATE invoices
       SET pushed = TRUE, pushed_at = NOW(), approved_by = $1, updated_at = NOW()
       WHERE id = ANY($2) AND pushed = FALSE
       RETURNING id, invoice_no`,
      [userId, ids]
    );

    await logAudit({
      userId,
      action: `Bulk finalized ${result.length} invoices`,
    });

    res.json({ finalized: result.length, total: ids.length });
  } catch (err) {
    next(err);
  }
}

export async function deleteInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const existing = await queryOne<InvoiceRow>(
      'SELECT id, invoice_no, pushed FROM invoices WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }

    if (existing.pushed) {
      res.status(403).json({ error: 'Forbidden', message: 'Cannot delete a finalized invoice. Undo finalization first.' });
      return;
    }

    // Soft-delete — move to bin
    await queryOne(
      'UPDATE invoices SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2',
      [userId, id]
    );

    await logAudit({
      userId,
      action: `Moved invoice #${existing.invoice_no ?? id} to bin`,
      invoiceId: id,
    });

    res.json({ message: 'Invoice moved to bin' });
  } catch (err) {
    next(err);
  }
}

export async function getBinInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoices = await query<InvoiceRow>(
      `SELECT i.*, u.name AS deleted_by_name
       FROM invoices i
       LEFT JOIN users u ON u.id = i.deleted_by
       WHERE i.deleted_at IS NOT NULL
       ORDER BY i.deleted_at DESC`
    );
    res.json(invoices);
  } catch (err) {
    next(err);
  }
}

export async function restoreInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const invoice = await queryOne<InvoiceRow>(
      'UPDATE invoices SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING *',
      [id]
    );

    if (!invoice) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found in bin' });
      return;
    }

    await logAudit({
      userId,
      action: `Restored invoice #${invoice.invoice_no ?? id} from bin`,
      invoiceId: id,
    });

    res.json(invoice);
  } catch (err) {
    next(err);
  }
}

export async function permanentDeleteInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const existing = await queryOne<InvoiceRow>(
      'SELECT id, invoice_no FROM invoices WHERE id = $1 AND deleted_at IS NOT NULL',
      [id]
    );

    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found in bin' });
      return;
    }

    await query('DELETE FROM payments WHERE invoice_id = $1', [id]);
    await query('DELETE FROM attachments WHERE invoice_id = $1', [id]);
    await query('DELETE FROM audit_logs WHERE invoice_id = $1', [id]);
    await query('DELETE FROM invoices WHERE id = $1', [id]);

    await logAudit({
      userId,
      action: `Permanently deleted invoice #${existing.invoice_no ?? id}`,
    });

    res.json({ message: 'Invoice permanently deleted' });
  } catch (err) {
    next(err);
  }
}

export async function purgeOldBinInvoices(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Delete invoices in bin for more than 30 days
    const old = await query<InvoiceRow>(
      "SELECT id FROM invoices WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'"
    );

    for (const inv of old) {
      await query('DELETE FROM payments WHERE invoice_id = $1', [inv.id]);
      await query('DELETE FROM attachments WHERE invoice_id = $1', [inv.id]);
      await query('DELETE FROM audit_logs WHERE invoice_id = $1', [inv.id]);
      await query('DELETE FROM invoices WHERE id = $1', [inv.id]);
    }

    res.json({ purged: old.length });
  } catch (err) {
    next(err);
  }
}

export async function undoPushInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const invoice = await queryOne<InvoiceRow>(
      `UPDATE invoices
       SET pushed = FALSE, pushed_at = NULL, approved_by = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (!invoice) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }

    await logAudit({
      userId,
      action: `Reverted finalization of invoice #${invoice.invoice_no ?? id}`,
      invoiceId: id,
    });

    res.json(invoice);
  } catch (err) {
    next(err);
  }
}
