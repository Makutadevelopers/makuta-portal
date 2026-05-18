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
import { notifyInvoicePushed, notifyInvoiceDeleted } from '../services/email.service';
import { deleteInvoiceFilesFromDisk } from './attachment.controller';
import { userHasSite } from '../middleware/auth';
import { normaliseSiteName } from '../utils/sites';
import { paymentStatusCase } from '../services/payment.service';
import { normalizeVendorName } from '../services/vendor.service';

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
// Balance subtracts both the cash paid and any TDS withheld, since TDS
// (sec 194C/194J etc) settles part of the vendor's invoice without cash
// changing hands. See migration 027 + payment.service.ts.
const SITE_PROJECTION = `
  inv.id, inv.sl_no, inv.internal_no, inv.month, inv.invoice_date,
  inv.vendor_id, inv.vendor_name, inv.invoice_no, inv.po_number, inv.purpose,
  inv.site, inv.invoice_amount,
  inv.base_amount, inv.cgst_pct, inv.sgst_pct, inv.igst_pct,
  inv.additional_charge, inv.additional_charge_cgst_pct, inv.additional_charge_sgst_pct,
  inv.additional_charge_igst_pct, inv.additional_charge_reason,
  inv.disputed, inv.dispute_severity, inv.dispute_reason, inv.disputed_by, inv.disputed_at,
  inv.payment_status,
  (inv.invoice_amount - COALESCE(ps.paid_sum, 0))::NUMERIC(14,2) AS balance,
  inv.remarks, inv.pushed, inv.pushed_at, inv.minor_payment,
  inv.created_by, inv.created_at, inv.updated_at
`;

// Pre-aggregated subqueries fold per-invoice sums/counts into one scan each,
// so the planner runs three GROUP BYs (not three subqueries per row). Was the
// #1 cause of slow invoice-list responses once row counts grew.
const AGG_JOINS = `
  LEFT JOIN (
    SELECT invoice_id, SUM(amount + tds_amount) AS paid_sum
    FROM payments
    GROUP BY invoice_id
  ) ps  ON ps.invoice_id  = inv.id
  LEFT JOIN (
    SELECT invoice_id, SUM(allocated_amount) AS cn_sum
    FROM credit_note_allocations
    GROUP BY invoice_id
  ) cna ON cna.invoice_id = inv.id
  LEFT JOIN (
    SELECT invoice_id, COUNT(*)::int AS cnt
    FROM attachments
    GROUP BY invoice_id
  ) att ON att.invoice_id = inv.id
`;

// Computed columns that the AGG_JOINS make available — kept shape-identical
// to the previous correlated-subquery output so client code needs no change.
const AGG_FIELDS = `
  COALESCE(cna.cn_sum, 0)::NUMERIC(14,2) AS allocated_credits,
  (inv.invoice_amount - COALESCE(cna.cn_sum, 0))::NUMERIC(14,2) AS effective_payable,
  COALESCE(att.cnt, 0) AS attachment_count
`;

interface InvoiceRow {
  id: string;
  [key: string]: unknown;
}

// Defensive cap so a runaway client (or future growth) can't pull the entire
// table at once. At current scale (~1–2k invoices) this is invisible; if it
// ever clips real data we'll need server-side filter/sort + real pagination.
const INVOICE_LIST_LIMIT = 5000;

export async function getInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, site } = req.user!;

    if (role === 'site') {
      // Site: any of the user's assigned sites only, NO payment data.
      // created_at tiebreaker so a back-dated invoice added today still
      // appears above older rows with the same invoice_date.
      const userSites = req.user!.sites && req.user!.sites.length > 0
        ? req.user!.sites
        : (site ? [site] : []);
      const invoices = await query<InvoiceRow>(
        `SELECT ${SITE_PROJECTION}, ${AGG_FIELDS}
         FROM invoices inv
         ${AGG_JOINS}
         WHERE inv.site = ANY($1) AND inv.deleted_at IS NULL
         ORDER BY inv.invoice_date DESC, inv.created_at DESC
         LIMIT $2`,
        [userSites, INVOICE_LIST_LIMIT]
      );
      res.json(invoices);
    } else {
      // ho + mgmt: all invoices, full data
      const invoices = await query<InvoiceRow>(
        `SELECT inv.*, ${AGG_FIELDS}
         FROM invoices inv
         ${AGG_JOINS}
         WHERE inv.deleted_at IS NULL
         ORDER BY inv.invoice_date DESC, inv.created_at DESC
         LIMIT $1`,
        [INVOICE_LIST_LIMIT]
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

    // Cross-vendor duplicate check: the same invoice number under a vendor
    // whose normalised name matches this one (different spellings or suffix
    // variants — e.g. "ABC Pvt Ltd" vs "ABC Limited"). Catches the case
    // where the same physical bill is about to be entered under a second
    // vendor record before the dedup alert is acted on.
    if (data.invoice_no) {
      const normTarget = normalizeVendorName(data.vendor_name);
      if (normTarget) {
        const candidates = await query<{
          invoice_id: string;
          existing_invoice_no: string | null;
          existing_invoice_date: string;
          existing_invoice_amount: string;
          existing_vendor_id: string | null;
          existing_vendor_name: string;
        }>(
          `SELECT i.id AS invoice_id,
                  i.invoice_no AS existing_invoice_no,
                  i.invoice_date AS existing_invoice_date,
                  i.invoice_amount AS existing_invoice_amount,
                  i.vendor_id AS existing_vendor_id,
                  COALESCE(v.name, i.vendor_name) AS existing_vendor_name
           FROM invoices i
           LEFT JOIN vendors v ON v.id = i.vendor_id
           WHERE LOWER(TRIM(i.invoice_no)) = LOWER(TRIM($1))
             AND i.deleted_at IS NULL
             AND i.vendor_id IS DISTINCT FROM $2`,
          [data.invoice_no, data.vendor_id]
        );
        const crossMatch = candidates.find(
          c => normalizeVendorName(c.existing_vendor_name) === normTarget
        );
        if (crossMatch) {
          res.status(409).json({
            error: 'Conflict',
            code: 'duplicate_invoice_cross_vendor',
            message: `Invoice #${data.invoice_no} already exists under "${crossMatch.existing_vendor_name}", which appears to be the same vendor as "${data.vendor_name}". Merge the vendors first, or check the invoice number.`,
            existing: {
              id: crossMatch.invoice_id,
              invoice_no: crossMatch.existing_invoice_no,
              invoice_date: crossMatch.existing_invoice_date,
              invoice_amount: crossMatch.existing_invoice_amount,
              vendor_id: crossMatch.existing_vendor_id,
              vendor_name: crossMatch.existing_vendor_name,
            },
          });
          return;
        }
      }
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

        // Cross-vendor check (same logic as create): block if the same
        // invoice_no exists under a vendor whose normalised name matches.
        const normTarget = normalizeVendorName(finalVendorName);
        if (normTarget) {
          const candidates = await query<{
            invoice_id: string;
            existing_invoice_no: string | null;
            existing_vendor_id: string | null;
            existing_vendor_name: string;
          }>(
            `SELECT i.id AS invoice_id,
                    i.invoice_no AS existing_invoice_no,
                    i.vendor_id AS existing_vendor_id,
                    COALESCE(v.name, i.vendor_name) AS existing_vendor_name
             FROM invoices i
             LEFT JOIN vendors v ON v.id = i.vendor_id
             WHERE i.id <> $1
               AND LOWER(TRIM(i.invoice_no)) = LOWER(TRIM($2))
               AND i.deleted_at IS NULL
               AND i.vendor_id IS DISTINCT FROM $3`,
            [id, finalInvoiceNo, finalVendorId]
          );
          const crossMatch = candidates.find(
            c => normalizeVendorName(c.existing_vendor_name) === normTarget
          );
          if (crossMatch) {
            res.status(409).json({
              error: 'Conflict',
              code: 'duplicate_invoice_cross_vendor',
              message: `Invoice #${finalInvoiceNo} already exists under "${crossMatch.existing_vendor_name}", which appears to be the same vendor as "${finalVendorName}". Merge the vendors first, or check the invoice number.`,
              existing: {
                id: crossMatch.invoice_id,
                invoice_no: crossMatch.existing_invoice_no,
                vendor_id: crossMatch.existing_vendor_id,
                vendor_name: crossMatch.existing_vendor_name,
              },
            });
            return;
          }
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
    }).catch((err) => console.error('[email] notifyInvoicePushed failed:', err));

    res.json(invoice);
  } catch (err) {
    next(err);
  }
}

// Recompute every non-deleted invoice's denormalized payment_status from the
// authoritative sum(payments) + sum(credit_note_allocations). Heals rows that
// drifted out of sync (e.g. payments inserted by an older code path that
// skipped the recompute). HO-only — touches every invoice row.
export async function recomputeAllStatuses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const before = await query<{ id: string; payment_status: string }>(
      'SELECT id, payment_status FROM invoices WHERE deleted_at IS NULL'
    );
    const beforeMap = new Map(before.map(r => [r.id, r.payment_status]));

    const after = await query<{ id: string; payment_status: string }>(
      `UPDATE invoices
         SET payment_status = ${paymentStatusCase('invoices')},
             updated_at = NOW()
       WHERE deleted_at IS NULL
       RETURNING id, payment_status`
    );

    let changed = 0;
    const counts = { Paid: 0, Partial: 0, 'Not Paid': 0 } as Record<string, number>;
    for (const row of after) {
      if (beforeMap.get(row.id) !== row.payment_status) changed++;
      counts[row.payment_status] = (counts[row.payment_status] ?? 0) + 1;
    }

    await logAudit({
      userId: req.user!.id,
      action: `Recomputed payment_status across ${after.length} invoices (${changed} changed)`,
      metadata: { total: after.length, changed, counts },
    });

    res.json({ total: after.length, changed, counts });
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

    const existing = await queryOne<{
      id: string;
      invoice_no: string | null;
      pushed: boolean | null;
      vendor_name: string | null;
      invoice_amount: string | number;
      site: string | null;
    }>(
      'SELECT id, invoice_no, pushed, vendor_name, invoice_amount, site FROM invoices WHERE id = $1 AND deleted_at IS NULL',
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

    notifyInvoiceDeleted({
      vendorName: existing.vendor_name ?? '(vendor not set)',
      invoiceNo: existing.invoice_no ?? id.slice(0, 8),
      amount: Number(existing.invoice_amount ?? 0),
      site: existing.site ?? '—',
      deletedBy: req.user!.name,
      mode: 'bin',
    }).catch((err) => console.error('[email] notifyInvoiceDeleted (bin) failed:', err));

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

    const existing = await queryOne<{
      id: string;
      invoice_no: string | null;
      vendor_name: string | null;
      invoice_amount: string | number;
      site: string | null;
    }>(
      'SELECT id, invoice_no, vendor_name, invoice_amount, site FROM invoices WHERE id = $1 AND deleted_at IS NOT NULL',
      [id]
    );

    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found in bin' });
      return;
    }

    // Atomic purge — all dependents plus invoice in one transaction
    await withTransaction(async (tx) => {
      // Capture bank_txn_ids before deleting payments so we can prune
      // bank_transactions that no longer have any linked payments.
      const linked = await tx.query<{ bank_txn_id: string }>(
        'SELECT DISTINCT bank_txn_id FROM payments WHERE invoice_id = $1 AND bank_txn_id IS NOT NULL',
        [id]
      );
      const linkedTxnIds = linked.map(r => r.bank_txn_id);

      await tx.query('DELETE FROM payments WHERE invoice_id = $1', [id]);
      await tx.query('DELETE FROM attachments WHERE invoice_id = $1', [id]);
      // Null out audit FK instead of deleting — preserves history
      await tx.query('UPDATE audit_logs SET invoice_id = NULL WHERE invoice_id = $1', [id]);
      await tx.query('DELETE FROM invoices WHERE id = $1', [id]);

      if (linkedTxnIds.length > 0) {
        await tx.query(
          `DELETE FROM bank_transactions
           WHERE id = ANY($1)
             AND NOT EXISTS (SELECT 1 FROM payments WHERE bank_txn_id = bank_transactions.id)`,
          [linkedTxnIds]
        );
      }
    });

    // Clean up physical files from disk (local dev) after the DB rows are gone
    await deleteInvoiceFilesFromDisk(id);

    await logAudit({
      userId,
      action: `Permanently deleted invoice #${existing.invoice_no ?? id}`,
    });

    notifyInvoiceDeleted({
      vendorName: existing.vendor_name ?? '(vendor not set)',
      invoiceNo: existing.invoice_no ?? id.slice(0, 8),
      amount: Number(existing.invoice_amount ?? 0),
      site: existing.site ?? '—',
      deletedBy: req.user!.name,
      mode: 'permanent',
    }).catch((err) => console.error('[email] notifyInvoiceDeleted (permanent) failed:', err));

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

      // Same prune-orphans pattern as permanentDeleteInvoice — capture
      // the linked bank_transactions before payments are gone.
      const linked = await tx.query<{ bank_txn_id: string }>(
        'SELECT DISTINCT bank_txn_id FROM payments WHERE invoice_id = ANY($1) AND bank_txn_id IS NOT NULL',
        [ids]
      );
      const linkedTxnIds = linked.map(r => r.bank_txn_id);

      await tx.query('DELETE FROM payments WHERE invoice_id = ANY($1)', [ids]);
      await tx.query('DELETE FROM attachments WHERE invoice_id = ANY($1)', [ids]);
      await tx.query('UPDATE audit_logs SET invoice_id = NULL WHERE invoice_id = ANY($1)', [ids]);
      await tx.query('DELETE FROM invoices WHERE id = ANY($1)', [ids]);

      if (linkedTxnIds.length > 0) {
        await tx.query(
          `DELETE FROM bank_transactions
           WHERE id = ANY($1)
             AND NOT EXISTS (SELECT 1 FROM payments WHERE bank_txn_id = bank_transactions.id)`,
          [linkedTxnIds]
        );
      }
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
