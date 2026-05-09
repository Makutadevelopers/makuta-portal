// invoice.controller.ts
// GET   /api/invoices          — filtered by role
// POST  /api/invoices          — ho + site
// PATCH /api/invoices/:id      — ho + site (own site only)
// POST  /api/invoices/:id/push — ho only
//
// CRITICAL: site role sees only the payment_status badge (Paid/Partial/Not Paid).
// Payment amounts (total_paid, balance) and aging data remain HO+mgmt only.

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/query';
import { logAudit } from '../services/audit.service';
import { notifyInvoicePushed } from '../services/email.service';
import { deleteInvoiceFilesFromDisk } from './attachment.controller';
import { userHasSite } from '../middleware/auth';
import { normaliseSiteName } from '../utils/sites';

// ISO date YYYY-MM-DD (strict — rejects "banana", "2026/04/01", partial dates, etc.)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(v => !isNaN(new Date(v).getTime()), 'Invalid calendar date');

const createInvoiceSchema = z.object({
  month: isoDate,
  invoice_date: isoDate,
  // vendor_id is required — every invoice must point at a Vendor Master row.
  // Free-text vendor names are no longer accepted from the manual form.
  vendor_id: z.string().uuid('Pick a vendor from Vendor Master, or create a new one'),
  vendor_name: z.string().min(1, 'Vendor name is required').max(500, 'Vendor name too long'),
  // M1: invoice_no is optional — imports and contractor work orders often have no number.
  // The DB column is nullable (migration 010). We still enforce max length when present.
  invoice_no: z.string().max(100, 'Invoice number too long').nullable().optional().or(z.literal(''))
    .transform(v => (v && v.trim() ? v.trim() : null)),
  po_number: z.string().max(200).nullable().optional(),
  purpose: z.string().min(1, 'Purpose is required').max(100),
  site: z.string().min(1, 'Site is required').max(100),
  invoice_amount: z.number().positive('Amount must be positive').max(1e12, 'Amount too large'),
  base_amount: z.number().nonnegative('Base amount must be ≥ 0').max(1e12, 'Amount too large').optional(),
  cgst_pct: z.number().min(0).max(100).optional(),
  sgst_pct: z.number().min(0).max(100).optional(),
  igst_pct: z.number().min(0).max(100).optional(),
  // Additional charge (e.g. transport, loading). Separate GST % from the base.
  // Reason is required at the controller level when additional_charge > 0.
  additional_charge: z.number().nonnegative('Additional charge must be ≥ 0').max(1e12).optional(),
  additional_charge_cgst_pct: z.number().min(0).max(100).optional(),
  additional_charge_sgst_pct: z.number().min(0).max(100).optional(),
  additional_charge_igst_pct: z.number().min(0).max(100).optional(),
  additional_charge_reason: z.string().max(500).nullable().optional(),
  remarks: z.string().max(2000).nullable().optional(),
});

const updateInvoiceSchema = createInvoiceSchema.partial();

// Columns safe for site role — payment_status badge plus the outstanding
// balance (so site dashboards can show "outstanding per project"). Aging
// data (days_past_due, overdue) and total_paid stay HO+mgmt only.
const SITE_COLUMNS = `
  id, sl_no, internal_no, month, invoice_date, vendor_id, vendor_name,
  invoice_no, po_number, purpose, site, invoice_amount,
  base_amount, cgst_pct, sgst_pct, igst_pct,
  additional_charge, additional_charge_cgst_pct, additional_charge_sgst_pct,
  additional_charge_igst_pct, additional_charge_reason,
  disputed, dispute_severity, dispute_reason, disputed_by, disputed_at,
  payment_status,
  (invoice_amount - COALESCE(
    (SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = invoices.id), 0
  ))::NUMERIC(14,2) AS balance,
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

    // Computed fields shared by all roles: allocated_credits + effective_payable
    const CN_FIELDS = `
      COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE invoice_id = invoices.id), 0)::NUMERIC(14,2) AS allocated_credits,
      (invoice_amount - COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE invoice_id = invoices.id), 0))::NUMERIC(14,2) AS effective_payable
    `;

    if (role === 'site') {
      // Site: any of the user's assigned sites only, NO payment data.
      // created_at tiebreaker so a back-dated invoice added today still
      // appears above older rows with the same invoice_date.
      const userSites = req.user!.sites && req.user!.sites.length > 0
        ? req.user!.sites
        : (site ? [site] : []);
      const invoices = await query<InvoiceRow>(
        `SELECT ${SITE_COLUMNS}, ${CN_FIELDS},
           (SELECT COUNT(*) FROM attachments a WHERE a.invoice_id = invoices.id)::int AS attachment_count
         FROM invoices WHERE site = ANY($1) AND deleted_at IS NULL
         ORDER BY invoice_date DESC, created_at DESC`,
        [userSites]
      );
      res.json(invoices);
    } else {
      // ho + mgmt: all invoices, full data
      const invoices = await query<InvoiceRow>(
        `SELECT ${FULL_COLUMNS}, ${CN_FIELDS},
           (SELECT COUNT(*) FROM attachments a WHERE a.invoice_id = invoices.id)::int AS attachment_count
         FROM invoices WHERE deleted_at IS NULL
         ORDER BY invoice_date DESC, created_at DESC`
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
    const { role, id: userId } = req.user!;

    // Snap site name to canonical capitalisation so "Nirvana" and "nirvana"
    // can't both end up in the invoices table.
    data.site = normaliseSiteName(data.site);

    // Site accountants can only create invoices for sites they're assigned to.
    if (role === 'site' && !userHasSite(req.user, data.site)) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only create invoices for sites you are assigned to' });
      return;
    }

    // Vendor must exist in Vendor Master. Pull the canonical name from the master row
    // so the denormalized invoice.vendor_name can never drift from vendors.name.
    const masterVendor = await queryOne<{ id: string; name: string; category: string | null }>(
      'SELECT id, name, category FROM vendors WHERE id = $1',
      [data.vendor_id]
    );
    if (!masterVendor) {
      res.status(400).json({ error: 'Bad Request', message: 'Selected vendor is not in Vendor Master' });
      return;
    }
    data.vendor_name = masterVendor.name;

    // Material category must match the vendor's category in Vendor Master.
    // Vendors with a null/blank category are treated as legacy and skip the check.
    if (masterVendor.category && masterVendor.category.trim()) {
      const expected = masterVendor.category.trim().toLowerCase();
      const actual = data.purpose.trim().toLowerCase();
      if (expected !== actual) {
        res.status(400).json({
          error: 'Bad Request',
          code: 'category_mismatch',
          message: `Category "${data.purpose}" does not match vendor "${masterVendor.name}" (Vendor Master: "${masterVendor.category}")`,
        });
        return;
      }
    }

    // Strict per-vendor invoice number uniqueness — one vendor cannot have two
    // invoices with the same invoice_no. Match by vendor_id first (canonical),
    // and fall back to case-insensitive vendor_name to also catch legacy rows
    // whose vendor_id was never linked. When invoice_no is blank, fall back to
    // (vendor + amount + date) — the same heuristic the bulk import uses.
    // No override path: the client cannot force-create a duplicate.
    const duplicate = data.invoice_no
      ? await queryOne<{ id: string; invoice_no: string | null; invoice_date: string; invoice_amount: string }>(
          `SELECT id, invoice_no, invoice_date, invoice_amount FROM invoices
           WHERE LOWER(TRIM(invoice_no)) = LOWER(TRIM($1))
             AND (vendor_id = $2 OR (vendor_id IS NULL AND LOWER(TRIM(vendor_name)) = LOWER(TRIM($3))))
             AND deleted_at IS NULL`,
          [data.invoice_no, data.vendor_id, data.vendor_name]
        )
      : await queryOne<{ id: string; invoice_no: string | null; invoice_date: string; invoice_amount: string }>(
          `SELECT id, invoice_no, invoice_date, invoice_amount FROM invoices
           WHERE invoice_no IS NULL
             AND (vendor_id = $1 OR (vendor_id IS NULL AND LOWER(TRIM(vendor_name)) = LOWER(TRIM($2))))
             AND invoice_amount = $3
             AND invoice_date = $4
             AND deleted_at IS NULL`,
          [data.vendor_id, data.vendor_name, data.invoice_amount, data.invoice_date]
        );
    if (duplicate) {
      res.status(409).json({
        error: 'Conflict',
        code: 'duplicate_invoice',
        message: data.invoice_no
          ? `Invoice #${data.invoice_no} already exists for vendor "${data.vendor_name}". Each invoice number must be unique per vendor.`
          : `An invoice for vendor "${data.vendor_name}" with the same date and amount already exists.`,
        existing: {
          id: duplicate.id,
          invoice_no: duplicate.invoice_no,
          invoice_date: duplicate.invoice_date,
          invoice_amount: duplicate.invoice_amount,
        },
      });
      return;
    }

    // Generate internal tracking number
    const seqResult = await queryOne<{ nextval: string }>("SELECT nextval('invoice_internal_seq')");
    const internalNo = `MKT-${String(seqResult!.nextval).padStart(5, '0')}`;

    // Default the tax split when the caller didn't supply one (legacy/import paths)
    const baseAmount = data.base_amount ?? data.invoice_amount;
    const cgstPct = data.cgst_pct ?? 0;
    const sgstPct = data.sgst_pct ?? 0;
    const igstPct = data.igst_pct ?? 0;
    const addlCharge = data.additional_charge ?? 0;
    const addlCgstPct = data.additional_charge_cgst_pct ?? 0;
    const addlSgstPct = data.additional_charge_sgst_pct ?? 0;
    const addlIgstPct = data.additional_charge_igst_pct ?? 0;
    const addlReason = data.additional_charge_reason?.trim() || null;

    // Reason is mandatory when additional charge > 0 (agreed business rule)
    if (addlCharge > 0 && !addlReason) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Reason is required when additional charge is entered',
      });
      return;
    }

    const invoice = await queryOne<InvoiceRow>(
      `INSERT INTO invoices (
        month, invoice_date, vendor_id, vendor_name, invoice_no, po_number,
        purpose, site, invoice_amount, base_amount, cgst_pct, sgst_pct, igst_pct,
        additional_charge, additional_charge_cgst_pct, additional_charge_sgst_pct,
        additional_charge_igst_pct, additional_charge_reason,
        remarks, created_by, internal_no
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *`,
      [
        data.month, data.invoice_date, data.vendor_id, data.vendor_name,
        data.invoice_no, data.po_number ?? null, data.purpose, data.site,
        data.invoice_amount, baseAmount, cgstPct, sgstPct, igstPct,
        addlCharge, addlCgstPct, addlSgstPct, addlIgstPct, addlReason,
        data.remarks ?? null, userId, internalNo,
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

    // Same site-name normalisation as create.
    if (data.site !== undefined) {
      data.site = normaliseSiteName(data.site);
    }

    // Verify invoice exists (excludes soft-deleted), check site ownership, and finalized status
    const existing = await queryOne<InvoiceRow>(
      'SELECT id, site, pushed, vendor_id, purpose FROM invoices WHERE id = $1 AND deleted_at IS NULL',
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

    if (role === 'site' && !userHasSite(req.user, existing.site as string)) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only edit invoices for sites you are assigned to' });
      return;
    }

    // H1: site role cannot move an invoice to a site outside their assignment.
    // Reassignment within their own sites is allowed (a multi-site accountant
    // who picked the wrong site at entry-time should be able to correct it).
    if (role === 'site' && data.site !== undefined && data.site !== existing.site && !userHasSite(req.user, data.site)) {
      res.status(403).json({ error: 'Forbidden', message: 'You cannot move an invoice to a site you are not assigned to' });
      return;
    }

    // If vendor_id is being changed, verify the new vendor exists and pull its canonical name.
    // We also need vendor.category so we can enforce material/category matching below.
    let resolvedVendor: { id: string; name: string; category: string | null } | null = null;
    if (data.vendor_id !== undefined) {
      resolvedVendor = await queryOne<{ id: string; name: string; category: string | null }>(
        'SELECT id, name, category FROM vendors WHERE id = $1',
        [data.vendor_id]
      );
      if (!resolvedVendor) {
        res.status(400).json({ error: 'Bad Request', message: 'Selected vendor is not in Vendor Master' });
        return;
      }
      data.vendor_name = resolvedVendor.name;
    }

    // Material category must match the vendor's category. Run this whenever
    // either vendor_id or purpose is being changed, against the resulting state.
    if (data.vendor_id !== undefined || data.purpose !== undefined) {
      if (!resolvedVendor) {
        resolvedVendor = await queryOne<{ id: string; name: string; category: string | null }>(
          'SELECT id, name, category FROM vendors WHERE id = $1',
          [existing.vendor_id]
        );
      }
      if (resolvedVendor?.category && resolvedVendor.category.trim()) {
        const finalPurpose = (data.purpose ?? (existing.purpose as string | null) ?? '').trim();
        const expected = resolvedVendor.category.trim().toLowerCase();
        if (expected !== finalPurpose.toLowerCase()) {
          res.status(400).json({
            error: 'Bad Request',
            code: 'category_mismatch',
            message: `Category "${finalPurpose}" does not match vendor "${resolvedVendor.name}" (Vendor Master: "${resolvedVendor.category}")`,
          });
          return;
        }
      }
    }

    // Strict uniqueness on update: if invoice_no or vendor is changing, make
    // sure the resulting (vendor, invoice_no) wouldn't collide with a sibling
    // invoice. Same matching rules as createInvoice; rejects with 409, no
    // override path.
    if (data.invoice_no !== undefined || data.vendor_id !== undefined) {
      const finalInvoiceNo = data.invoice_no !== undefined
        ? data.invoice_no
        : (existing.invoice_no as string | null);
      const finalVendorId = data.vendor_id !== undefined
        ? data.vendor_id
        : (existing.vendor_id as string | null);
      const finalVendorName = (resolvedVendor?.name ?? (existing.vendor_name as string)) || '';
      if (finalInvoiceNo && finalInvoiceNo.trim()) {
        const collision = await queryOne<{ id: string; invoice_no: string | null }>(
          `SELECT id, invoice_no FROM invoices
           WHERE id <> $1
             AND LOWER(TRIM(invoice_no)) = LOWER(TRIM($2))
             AND (vendor_id = $3 OR (vendor_id IS NULL AND LOWER(TRIM(vendor_name)) = LOWER(TRIM($4))))
             AND deleted_at IS NULL`,
          [id, finalInvoiceNo, finalVendorId, finalVendorName]
        );
        if (collision) {
          res.status(409).json({
            error: 'Conflict',
            code: 'duplicate_invoice',
            message: `Invoice #${finalInvoiceNo} already exists for vendor "${finalVendorName}". Each invoice number must be unique per vendor.`,
            existing: { id: collision.id, invoice_no: collision.invoice_no },
          });
          return;
        }
      }
    }

    const ALLOWED_UPDATE_FIELDS = [
      'month', 'invoice_date', 'vendor_id', 'vendor_name', 'invoice_no',
      'po_number', 'purpose', 'site', 'invoice_amount',
      'base_amount', 'cgst_pct', 'sgst_pct', 'igst_pct',
      'additional_charge', 'additional_charge_cgst_pct',
      'additional_charge_sgst_pct', 'additional_charge_igst_pct',
      'additional_charge_reason',
      'remarks',
    ];

    // If additional_charge is being set > 0, require a reason either in this
    // update or already on the row.
    if (data.additional_charge !== undefined && data.additional_charge > 0) {
      const incomingReason = (data.additional_charge_reason ?? '').trim();
      if (!incomingReason) {
        const existingReason = await queryOne<{ additional_charge_reason: string | null }>(
          'SELECT additional_charge_reason FROM invoices WHERE id = $1',
          [id]
        );
        if (!existingReason?.additional_charge_reason) {
          res.status(400).json({
            error: 'Bad Request',
            message: 'Reason is required when additional charge is entered',
          });
          return;
        }
      }
    }

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
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [userId, id]
    );

    if (!invoice) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }

    try {
      await logAudit({
        userId,
        action: `Finalized invoice #${invoice.invoice_no ?? id}`,
        invoiceId: id,
      });
    } catch (auditErr) {
      console.error('[audit] pushInvoice audit log failed:', auditErr);
    }

    // Fire-and-forget email notification
    notifyInvoicePushed({
      vendorName: String(invoice.vendor_name ?? ''),
      invoiceNo: String(invoice.invoice_no ?? ''),
      amount: Number(invoice.invoice_amount ?? 0),
      site: String(invoice.site ?? ''),
      hoEmail: 'rajesh@makuta.in',
    }).catch((err) => console.error('[email] notifyInvoicePushed failed:', err));

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
       WHERE id = ANY($2) AND pushed = FALSE AND deleted_at IS NULL
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

export async function bulkDeleteInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const bulkSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
    const { ids } = bulkSchema.parse(req.body);
    const userId = req.user!.id;

    // Soft-delete only draft (non-pushed) invoices that aren't already in the bin.
    // Finalized invoices must be undone first — silently skipped here, count surfaces in response.
    const result = await query<InvoiceRow>(
      `UPDATE invoices
       SET deleted_at = NOW(), deleted_by = $1
       WHERE id = ANY($2) AND pushed = FALSE AND deleted_at IS NULL
       RETURNING id, invoice_no`,
      [userId, ids]
    );

    await logAudit({
      userId,
      action: `Bulk moved ${result.length} invoice(s) to bin`,
    });

    res.json({ deleted: result.length, total: ids.length });
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

    // Atomic purge — all dependents plus invoice in one transaction
    await withTransaction(async (tx) => {
      await tx.query('DELETE FROM payments WHERE invoice_id = $1', [id]);
      await tx.query('DELETE FROM attachments WHERE invoice_id = $1', [id]);
      // Null out audit FK instead of deleting — preserves history
      await tx.query('UPDATE audit_logs SET invoice_id = NULL WHERE invoice_id = $1', [id]);
      await tx.query('DELETE FROM invoices WHERE id = $1', [id]);
    });

    // Clean up physical files from disk (local dev) after the DB rows are gone
    await deleteInvoiceFilesFromDisk(id);

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
    // Collect the IDs that will be purged so we can also wipe their disk files
    const purgedIds: string[] = [];
    const purgedCount = await withTransaction(async (tx) => {
      const old = await tx.query<{ id: string }>(
        "SELECT id FROM invoices WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'"
      );
      if (old.length === 0) return 0;

      const ids = old.map(r => r.id);
      purgedIds.push(...ids);
      await tx.query('DELETE FROM payments WHERE invoice_id = ANY($1)', [ids]);
      await tx.query('DELETE FROM attachments WHERE invoice_id = ANY($1)', [ids]);
      await tx.query('UPDATE audit_logs SET invoice_id = NULL WHERE invoice_id = ANY($1)', [ids]);
      await tx.query('DELETE FROM invoices WHERE id = ANY($1)', [ids]);
      return old.length;
    });

    // Clean up physical files for every purged invoice (outside the transaction)
    for (const id of purgedIds) {
      await deleteInvoiceFilesFromDisk(id);
    }

    res.json({ purged: purgedCount });
  } catch (err) {
    next(err);
  }
}

const markDisputeSchema = z.object({
  severity: z.enum(['minor', 'major']),
  reason: z.string().min(1, 'Dispute reason is required').max(1000),
});

const clearDisputeSchema = z.object({
  reason: z.string().min(1, 'Clearance reason is required').max(1000).optional(),
});

export async function markDisputed(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const data = markDisputeSchema.parse(req.body);
    const { role, id: userId } = req.user!;

    const existing = await queryOne<InvoiceRow>(
      'SELECT id, site, invoice_no FROM invoices WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }
    if (role === 'site' && !userHasSite(req.user, existing.site as string)) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only dispute invoices for sites you are assigned to',
      });
      return;
    }

    const invoice = await queryOne<InvoiceRow>(
      `UPDATE invoices
       SET disputed = TRUE, dispute_severity = $1, dispute_reason = $2,
           disputed_by = $3, disputed_at = NOW(), updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [data.severity, data.reason, userId, id]
    );

    await logAudit({
      userId,
      action: `Disputed invoice #${existing.invoice_no ?? id} (${data.severity}) — ${data.reason}`,
      invoiceId: id,
      metadata: { severity: data.severity, reason: data.reason },
    });

    res.json(invoice);
  } catch (err) {
    next(err);
  }
}

export async function clearDispute(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const data = clearDisputeSchema.parse(req.body ?? {});
    const { role, id: userId } = req.user!;

    const existing = await queryOne<InvoiceRow>(
      'SELECT id, site, invoice_no FROM invoices WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }
    if (role === 'site' && !userHasSite(req.user, existing.site as string)) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only clear disputes for sites you are assigned to',
      });
      return;
    }

    const invoice = await queryOne<InvoiceRow>(
      `UPDATE invoices
       SET disputed = FALSE, dispute_severity = NULL, dispute_reason = NULL,
           disputed_by = NULL, disputed_at = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    await logAudit({
      userId,
      action: `Cleared dispute on invoice #${existing.invoice_no ?? id}${data.reason ? ` — ${data.reason}` : ''}`,
      invoiceId: id,
      metadata: data.reason ? { clearance_reason: data.reason } : undefined,
    });

    res.json(invoice);
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
       WHERE id = $1 AND deleted_at IS NULL
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
