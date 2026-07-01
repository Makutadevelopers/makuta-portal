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
import { userHasSite, JwtPayload } from '../middleware/auth';
import { normaliseSiteName } from '../utils/sites';
import { paymentStatusCase } from '../services/payment.service';
import { normalizeVendorName } from '../services/vendor.service';

// ISO date YYYY-MM-DD (strict — rejects "banana", "2026/04/01", partial dates, etc.)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(v => !isNaN(new Date(v).getTime()), 'Invalid calendar date');

// Additional line items — multiple per invoice, each with its own GST split.
// Generalises the single additional_charge (migration 017). The invoice's own
// base_amount/cgst_pct/etc (the primary line) are NOT modelled here; these are
// the EXTRA items only. When present, the controller derives the legacy
// additional_charge* columns from them (Σ amount, joined descriptions) so
// exports and detail fallbacks keep working.
const lineItemSchema = z.object({
  description: z.string().trim().max(500).optional().default(''),
  amount: z.number().nonnegative('Item amount must be ≥ 0').max(1e12),
  cgst_pct: z.number().min(0).max(100).optional().default(0),
  sgst_pct: z.number().min(0).max(100).optional().default(0),
  igst_pct: z.number().min(0).max(100).optional().default(0),
});

const createInvoiceSchema = z.object({
  month: isoDate,
  invoice_date: isoDate,
  // vendor_id is required — every invoice must point at a Vendor Master row.
  // Free-text vendor names are no longer accepted from the manual form.
  vendor_id: z.string().uuid('Pick a vendor from Vendor Master, or create a new one'),
  vendor_name: z.string().min(1, 'Vendor name is required').max(500, 'Vendor name too long'),
  // invoice_no is normally required, but vendors flagged "invoice number
  // optional" in Vendor Master (e.g. bank charges, refunds) may omit it. The
  // schema therefore accepts blank/missing and normalises it to null; the
  // controller (insertSingleInvoice) enforces the requirement per-vendor once
  // the vendor's flag is known. The DB column is nullable since migration 010.
  invoice_no: z.string().trim().max(100, 'Invoice number too long').nullable().optional()
    .transform(v => (v ? v : null)),
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
  // Multiple extra line items (each with its own GST). When supplied, this is
  // the source of truth for the invoice's extra charges and the
  // additional_charge* columns above are derived from it server-side.
  line_items: z.array(lineItemSchema).max(50).optional(),
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
    SELECT invoice_id, SUM(amount + tds_amount + gst_tds_amount) AS paid_sum,
           MAX(payment_date) AS last_paid_date
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
  COALESCE(att.cnt, 0) AS attachment_count,
  ps.last_paid_date
`;

// Outstanding balance (invoice_amount − cash paid − TDS withheld). Identical
// to the expression baked into SITE_PROJECTION. The ho/mgmt branches select
// inv.* (which can't contain this computed column), so it must be added
// explicitly there or inv.balance comes back undefined — which silently broke
// the Vendor Master Outstanding column. Can't fold into AGG_FIELDS: site rows
// already get balance via SITE_PROJECTION and would collide on the name.
const HO_BALANCE_FIELD = `
  (inv.invoice_amount - COALESCE(ps.paid_sum, 0))::NUMERIC(14,2) AS balance
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
        `SELECT inv.*, ${HO_BALANCE_FIELD}, ${AGG_FIELDS}
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

// GET /api/invoices/:id — single invoice with the SAME computed shape the
// list returns (balance, attachment_count, aging joins), filtered by role.
// Lets the client patch one row after an edit instead of re-fetching the
// whole list. Returns 404 if the row is deleted or outside the caller's scope.
export async function getInvoiceById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role } = req.user!;
    const id = req.params.id as string;

    let invoice: InvoiceRow | null;
    if (role === 'site') {
      const userSites = req.user!.sites && req.user!.sites.length > 0
        ? req.user!.sites
        : (req.user!.site ? [req.user!.site] : []);
      invoice = await queryOne<InvoiceRow>(
        `SELECT ${SITE_PROJECTION}, ${AGG_FIELDS}
         FROM invoices inv
         ${AGG_JOINS}
         WHERE inv.id = $1 AND inv.site = ANY($2) AND inv.deleted_at IS NULL`,
        [id, userSites]
      );
    } else {
      invoice = await queryOne<InvoiceRow>(
        `SELECT inv.*, ${HO_BALANCE_FIELD}, ${AGG_FIELDS}
         FROM invoices inv
         ${AGG_JOINS}
         WHERE inv.id = $1 AND inv.deleted_at IS NULL`,
        [id]
      );
    }

    if (!invoice) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }
    res.json(invoice);
  } catch (err) {
    next(err);
  }
}

interface LineItemRow {
  id: string;
  line_no: number;
  description: string;
  amount: string | number;
  cgst_pct: string | number;
  sgst_pct: string | number;
  igst_pct: string | number;
}

// GET /api/invoices/:id/line-items — the invoice's additional line items.
// Role-scoped: site accountants only see items for invoices on their own sites.
// Returns [] for legacy invoices that never had detail rows (the caller falls
// back to the single additional_charge column for display).
export async function getInvoiceLineItems(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { role } = req.user!;

    let visible: { id: string } | null;
    if (role === 'site') {
      const userSites = req.user!.sites && req.user!.sites.length > 0
        ? req.user!.sites
        : (req.user!.site ? [req.user!.site] : []);
      visible = await queryOne<{ id: string }>(
        'SELECT id FROM invoices WHERE id = $1 AND site = ANY($2) AND deleted_at IS NULL',
        [id, userSites]
      );
    } else {
      visible = await queryOne<{ id: string }>(
        'SELECT id FROM invoices WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
    }

    if (!visible) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }

    const items = await query<LineItemRow>(
      `SELECT id, line_no, description, amount, cgst_pct, sgst_pct, igst_pct
       FROM invoice_line_items
       WHERE invoice_id = $1
       ORDER BY line_no, created_at`,
      [id]
    );
    res.json(items);
  } catch (err) {
    next(err);
  }
}

// Per-row insert pipeline shared by createInvoice (single) and
// createInvoiceBatch (many). Runs site canonicalisation, vendor-master
// lookup, category-match, dedup checks, INSERT, and audit log. Returns a
// discriminated result so the batch handler can record per-row failures
// without throwing.
type InsertInvoiceData = z.infer<typeof createInvoiceSchema>;
type InsertResult =
  | { ok: true; invoice: InvoiceRow }
  | { ok: false; status: number; code?: string; message: string; existing?: unknown };

async function insertSingleInvoice(
  raw: InsertInvoiceData,
  user: { id: string; role: 'ho' | 'site' | 'mgmt'; sites?: string[]; site?: string | null },
): Promise<InsertResult> {
  const data = { ...raw };

  data.site = normaliseSiteName(data.site);

  if (user.role === 'site' && !userHasSite(user as JwtPayload, data.site)) {
    return { ok: false, status: 403, message: 'You can only create invoices for sites you are assigned to' };
  }

  const masterVendor = await queryOne<{ id: string; name: string; category: string | null; invoice_no_optional: boolean }>(
    'SELECT id, name, category, invoice_no_optional FROM vendors WHERE id = $1',
    [data.vendor_id]
  );
  if (!masterVendor) {
    return { ok: false, status: 400, message: 'Selected vendor is not in Vendor Master' };
  }
  data.vendor_name = masterVendor.name;

  // Invoice number is mandatory unless this vendor is flagged "invoice number
  // optional" in Vendor Master (e.g. bank charges, refunds — no invoice issued).
  if (!data.invoice_no && !masterVendor.invoice_no_optional) {
    return { ok: false, status: 400, message: 'Invoice number is required' };
  }

  if (masterVendor.category && masterVendor.category.trim()) {
    const expected = masterVendor.category.trim().toLowerCase();
    const actual = data.purpose.trim().toLowerCase();
    if (expected !== actual) {
      return {
        ok: false,
        status: 400,
        code: 'category_mismatch',
        message: `Category "${data.purpose}" does not match vendor "${masterVendor.name}" (Vendor Master: "${masterVendor.category}")`,
      };
    }
  }

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
    return {
      ok: false,
      status: 409,
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
    };
  }

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
        return {
          ok: false,
          status: 409,
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
        };
      }
    }
  }

  const baseAmount = data.base_amount ?? data.invoice_amount;
  const cgstPct = data.cgst_pct ?? 0;
  const sgstPct = data.sgst_pct ?? 0;
  const igstPct = data.igst_pct ?? 0;

  // Extra charges come from either the new multi-item array (preferred) or the
  // legacy single additional_charge fields (batch form, bulk import, old
  // clients). When line_items is supplied, derive the legacy columns from it so
  // exports / detail fallbacks that read additional_charge keep working.
  const lineItems = data.line_items?.filter(li => Number(li.amount) > 0) ?? null;
  let addlCharge: number;
  let addlCgstPct: number;
  let addlSgstPct: number;
  let addlIgstPct: number;
  let addlReason: string | null;
  if (lineItems !== null) {
    addlCharge = +lineItems.reduce((s, li) => s + Number(li.amount || 0), 0).toFixed(2);
    addlReason = lineItems.map(li => (li.description || '').trim()).filter(Boolean).join('; ').slice(0, 500) || null;
    // A single item can map cleanly onto the legacy per-rate columns; with
    // several rates the detail view reads invoice_line_items instead.
    addlCgstPct = lineItems.length === 1 ? Number(lineItems[0].cgst_pct) || 0 : 0;
    addlSgstPct = lineItems.length === 1 ? Number(lineItems[0].sgst_pct) || 0 : 0;
    addlIgstPct = lineItems.length === 1 ? Number(lineItems[0].igst_pct) || 0 : 0;
  } else {
    addlCharge = data.additional_charge ?? 0;
    addlCgstPct = data.additional_charge_cgst_pct ?? 0;
    addlSgstPct = data.additional_charge_sgst_pct ?? 0;
    addlIgstPct = data.additional_charge_igst_pct ?? 0;
    addlReason = data.additional_charge_reason?.trim() || null;
  }

  if (addlCharge > 0 && !addlReason) {
    return { ok: false, status: 400, message: 'Reason is required when an additional item / charge is entered' };
  }

  const seqResult = await queryOne<{ nextval: string }>("SELECT nextval('invoice_internal_seq')");
  const internalNo = `MKT-${String(seqResult!.nextval).padStart(5, '0')}`;

  const invoice = await withTransaction(async (tx) => {
    const inv = await tx.queryOne<InvoiceRow>(
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
        data.remarks ?? null, user.id, internalNo,
      ]
    );
    if (lineItems !== null && lineItems.length > 0 && inv) {
      for (let i = 0; i < lineItems.length; i++) {
        const li = lineItems[i];
        await tx.query(
          `INSERT INTO invoice_line_items (invoice_id, line_no, description, amount, cgst_pct, sgst_pct, igst_pct)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [inv.id, i + 1, (li.description || '').trim() || 'Additional charge',
           Number(li.amount) || 0, Number(li.cgst_pct) || 0, Number(li.sgst_pct) || 0, Number(li.igst_pct) || 0]
        );
      }
    }
    return inv;
  });

  await logAudit({
    userId: user.id,
    action: `Created invoice #${data.invoice_no} — ${data.vendor_name} ₹${Number(data.invoice_amount).toLocaleString('en-IN')}`,
    invoiceId: invoice?.id,
  });

  return { ok: true, invoice: invoice! };
}

export async function createInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createInvoiceSchema.parse(req.body);
    const result = await insertSingleInvoice(data, req.user!);
    if (!result.ok) {
      res.status(result.status).json({
        error: result.status === 409 ? 'Conflict' : result.status === 403 ? 'Forbidden' : 'Bad Request',
        ...(result.code ? { code: result.code } : {}),
        message: result.message,
        ...(result.existing ? { existing: result.existing } : {}),
      });
      return;
    }
    res.status(201).json(result.invoice);
  } catch (err) {
    next(err);
  }
}

const batchInvoiceSchema = z.object({
  vendor_id: z.string().uuid('Pick a vendor from Vendor Master'),
  vendor_name: z.string().min(1).max(500),
  site: z.string().min(1).max(100),
  invoices: z.array(createInvoiceSchema).min(1, 'Add at least one invoice').max(100, 'Batch limited to 100 invoices'),
});

export async function createInvoiceBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = batchInvoiceSchema.parse(req.body);
    const user = req.user!;

    const masterVendor = await queryOne<{ id: string; name: string }>(
      'SELECT id, name FROM vendors WHERE id = $1',
      [body.vendor_id]
    );
    if (!masterVendor) {
      res.status(400).json({ error: 'Bad Request', message: 'Selected vendor is not in Vendor Master' });
      return;
    }

    const site = normaliseSiteName(body.site);

    const results: Array<{
      index: number;
      ok: boolean;
      invoice_id?: string;
      error?: { code?: string; message: string; existing?: unknown };
    }> = [];

    let created = 0;
    let failed = 0;

    for (let i = 0; i < body.invoices.length; i++) {
      const row = body.invoices[i];
      const forced: InsertInvoiceData = {
        ...row,
        vendor_id: masterVendor.id,
        vendor_name: masterVendor.name,
        site,
      };
      const result = await insertSingleInvoice(forced, user);
      if (result.ok) {
        created++;
        results.push({ index: i, ok: true, invoice_id: String(result.invoice.id) });
      } else {
        failed++;
        results.push({
          index: i,
          ok: false,
          error: {
            ...(result.code ? { code: result.code } : {}),
            message: result.message,
            ...(result.existing ? { existing: result.existing } : {}),
          },
        });
      }
    }

    await logAudit({
      userId: user.id,
      action: `Batch-created ${created}/${body.invoices.length} invoices for ${masterVendor.name}${failed ? ` — ${failed} failed` : ''}`,
    });

    res.status(200).json({ created, failed, results });
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
      // Leaving the invoice number blank is only allowed when the (final) vendor
      // is flagged "invoice number optional" in Vendor Master.
      if (!finalInvoiceNo || !finalInvoiceNo.trim()) {
        const allowsBlank = finalVendorId
          ? await queryOne<{ invoice_no_optional: boolean }>(
              'SELECT invoice_no_optional FROM vendors WHERE id = $1',
              [finalVendorId]
            )
          : null;
        if (!allowsBlank?.invoice_no_optional) {
          res.status(400).json({ error: 'Bad Request', message: 'Invoice number is required' });
          return;
        }
      }
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

    // Multi-item: when line_items is supplied it's the source of truth for the
    // invoice's extra charges — derive the legacy additional_charge* columns
    // from it so the dynamic UPDATE below persists a consistent aggregate that
    // exports and the detail fallback can read.
    if (data.line_items !== undefined) {
      const items = data.line_items.filter(li => Number(li.amount) > 0);
      data.additional_charge = +items.reduce((s, li) => s + Number(li.amount || 0), 0).toFixed(2);
      data.additional_charge_reason = items.map(li => (li.description || '').trim()).filter(Boolean).join('; ').slice(0, 500) || null;
      data.additional_charge_cgst_pct = items.length === 1 ? Number(items[0].cgst_pct) || 0 : 0;
      data.additional_charge_sgst_pct = items.length === 1 ? Number(items[0].sgst_pct) || 0 : 0;
      data.additional_charge_igst_pct = items.length === 1 ? Number(items[0].igst_pct) || 0 : 0;
    }

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

    const invoice = await withTransaction(async (tx) => {
      const updated = await tx.queryOne<InvoiceRow>(
        `UPDATE invoices SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      // Replace the detail rows wholesale when line_items is supplied (a normal
      // human edit — fine to overwrite per the human-edits-are-final rule, which
      // only protects against automated repairs/backfills, not user edits).
      if (data.line_items !== undefined) {
        await tx.query('DELETE FROM invoice_line_items WHERE invoice_id = $1', [id]);
        const items = data.line_items.filter(li => Number(li.amount) > 0);
        for (let i = 0; i < items.length; i++) {
          const li = items[i];
          await tx.query(
            `INSERT INTO invoice_line_items (invoice_id, line_no, description, amount, cgst_pct, sgst_pct, igst_pct)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, i + 1, (li.description || '').trim() || 'Additional charge',
             Number(li.amount) || 0, Number(li.cgst_pct) || 0, Number(li.sgst_pct) || 0, Number(li.igst_pct) || 0]
          );
        }
      }
      return updated;
    });

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
