// credit-note.controller.ts
// GET    /api/credit-notes                      — list (site-scoped for site)
// GET    /api/credit-notes/:id                  — detail with allocations
// POST   /api/credit-notes                      — create (ho + site), optionally with allocations[]
// PATCH  /api/credit-notes/:id                  — update (ho + site, own site, unallocated only for site)
// DELETE /api/credit-notes/:id                  — soft-delete (ho)
// POST   /api/credit-notes/:id/allocations      — add an allocation to an invoice
// DELETE /api/credit-notes/:id/allocations/:allocId — remove an allocation
// GET    /api/credit-notes/vendor/:vendorId/balance    — unallocated balance (ho + mgmt)
// GET    /api/credit-notes/invoice/:invoiceId/suggestions — available credit for this vendor

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/query';
import { logAudit } from '../services/audit.service';
import { recomputeInvoiceStatus } from '../services/payment.service';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((v) => !isNaN(new Date(v).getTime()), 'Invalid calendar date');

const allocationInputSchema = z.object({
  invoice_id: z.string().uuid(),
  allocated_amount: z.number().positive().max(1e12),
});

const createCreditNoteSchema = z.object({
  cn_no: z.string().min(1, 'Credit note number is required').max(100),
  cn_date: isoDate,
  vendor_id: z.string().uuid(),
  vendor_name: z.string().min(1).max(500),
  site: z.string().min(1).max(100),
  base_amount: z.number().positive('Base amount must be > 0').max(1e12),
  cgst_pct: z.number().min(0).max(100).optional(),
  sgst_pct: z.number().min(0).max(100).optional(),
  igst_pct: z.number().min(0).max(100).optional(),
  total_amount: z.number().positive('Total amount must be > 0').max(1e12),
  remarks: z.string().max(2000).nullable().optional(),
  allocations: z.array(allocationInputSchema).optional(),
});

const updateCreditNoteSchema = createCreditNoteSchema
  .omit({ allocations: true })
  .partial();

interface CreditNoteRow {
  id: string;
  cn_no: string;
  cn_date: string;
  vendor_id: string;
  vendor_name: string;
  site: string;
  base_amount: string;
  cgst_pct: string;
  sgst_pct: string;
  igst_pct: string;
  total_amount: string;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

interface AllocationRow {
  id: string;
  credit_note_id: string;
  invoice_id: string;
  allocated_amount: string;
  allocated_by: string | null;
  allocated_at: string;
}

async function loadAllocations(cnIds: string[]): Promise<Record<string, AllocationRow[]>> {
  if (cnIds.length === 0) return {};
  const rows = await query<AllocationRow & { invoice_no: string | null; invoice_date: string; invoice_amount: string }>(
    `SELECT a.*, i.invoice_no, i.invoice_date, i.invoice_amount
     FROM credit_note_allocations a
     JOIN invoices i ON i.id = a.invoice_id
     WHERE a.credit_note_id = ANY($1::uuid[])
     ORDER BY a.allocated_at`,
    [cnIds]
  );
  const byCn: Record<string, AllocationRow[]> = {};
  for (const r of rows) {
    (byCn[r.credit_note_id] ||= []).push(r);
  }
  return byCn;
}

function unallocatedBalance(cn: CreditNoteRow, allocs: AllocationRow[]): number {
  const allocated = allocs.reduce((s, a) => s + Number(a.allocated_amount), 0);
  return Number(cn.total_amount) - allocated;
}

export async function listCreditNotes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, site } = req.user!;

    const sqlWhere = role === 'site' ? 'WHERE site = $1 AND deleted_at IS NULL' : 'WHERE deleted_at IS NULL';
    const params = role === 'site' ? [site] : [];

    const rows = await query<CreditNoteRow>(
      `SELECT * FROM credit_notes ${sqlWhere} ORDER BY cn_date DESC, created_at DESC`,
      params
    );

    const ids = rows.map((r) => r.id);
    const allocsByCn = await loadAllocations(ids);

    const withBalance = rows.map((r) => ({
      ...r,
      allocations: allocsByCn[r.id] ?? [],
      unallocated_balance: unallocatedBalance(r, allocsByCn[r.id] ?? []),
    }));

    res.json(withBalance);
  } catch (err) {
    next(err);
  }
}

export async function getCreditNote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { role, site } = req.user!;

    const row = await queryOne<CreditNoteRow>(
      'SELECT * FROM credit_notes WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (!row) {
      res.status(404).json({ error: 'Not Found', message: 'Credit note not found' });
      return;
    }
    if (role === 'site' && row.site !== site) {
      res.status(403).json({ error: 'Forbidden', message: 'Not your site' });
      return;
    }

    const allocsByCn = await loadAllocations([row.id]);
    const allocations = allocsByCn[row.id] ?? [];

    res.json({
      ...row,
      allocations,
      unallocated_balance: unallocatedBalance(row, allocations),
    });
  } catch (err) {
    next(err);
  }
}

export async function createCreditNote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createCreditNoteSchema.parse(req.body);
    const { role, site, id: userId } = req.user!;

    if (role === 'site' && data.site !== site) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only create credit notes for your own site' });
      return;
    }

    // Validate allocation sum ≤ total_amount
    if (data.allocations?.length) {
      const sum = data.allocations.reduce((s, a) => s + a.allocated_amount, 0);
      if (sum > data.total_amount + 0.01) {
        res.status(400).json({
          error: 'Bad Request',
          message: `Sum of allocations (₹${sum}) exceeds credit note total (₹${data.total_amount})`,
        });
        return;
      }
      // Site can only allocate to invoices of their own site
      if (role === 'site') {
        const invoiceIds = data.allocations.map((a) => a.invoice_id);
        const invs = await query<{ id: string; site: string }>(
          'SELECT id, site FROM invoices WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
          [invoiceIds]
        );
        if (invs.length !== invoiceIds.length) {
          res.status(400).json({ error: 'Bad Request', message: 'One or more invoices not found' });
          return;
        }
        const mismatched = invs.find((i) => i.site !== site);
        if (mismatched) {
          res.status(403).json({ error: 'Forbidden', message: 'Cannot allocate to invoices outside your site' });
          return;
        }
      }
    }

    const cgst = data.cgst_pct ?? 0;
    const sgst = data.sgst_pct ?? 0;
    const igst = data.igst_pct ?? 0;

    const result = await withTransaction(async (tx) => {
      const cn = await tx.queryOne<CreditNoteRow>(
        `INSERT INTO credit_notes (
          cn_no, cn_date, vendor_id, vendor_name, site,
          base_amount, cgst_pct, sgst_pct, igst_pct, total_amount,
          remarks, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          data.cn_no,
          data.cn_date,
          data.vendor_id,
          data.vendor_name,
          data.site,
          data.base_amount,
          cgst,
          sgst,
          igst,
          data.total_amount,
          data.remarks ?? null,
          userId,
        ]
      );
      if (!cn) throw new Error('Failed to create credit note');

      const touchedInvoiceIds: string[] = [];
      if (data.allocations?.length) {
        for (const a of data.allocations) {
          await tx.query(
            `INSERT INTO credit_note_allocations (credit_note_id, invoice_id, allocated_amount, allocated_by)
             VALUES ($1, $2, $3, $4)`,
            [cn.id, a.invoice_id, a.allocated_amount, userId]
          );
          touchedInvoiceIds.push(a.invoice_id);
        }
      }

      return { cn, touchedInvoiceIds };
    });

    // Recompute payment status for every affected invoice
    for (const invId of result.touchedInvoiceIds) {
      await recomputeInvoiceStatus(invId);
    }

    await logAudit({
      userId,
      action: `Created credit note #${data.cn_no} — ${data.vendor_name} ₹${data.total_amount.toLocaleString('en-IN')}`,
      creditNoteId: result.cn.id,
      metadata: { allocations: data.allocations?.length ?? 0 },
    });

    const allocsByCn = await loadAllocations([result.cn.id]);
    const allocations = allocsByCn[result.cn.id] ?? [];

    res.status(201).json({
      ...result.cn,
      allocations,
      unallocated_balance: unallocatedBalance(result.cn, allocations),
    });
  } catch (err) {
    next(err);
  }
}

export async function updateCreditNote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const data = updateCreditNoteSchema.parse(req.body);
    const { role, site, id: userId } = req.user!;

    const existing = await queryOne<CreditNoteRow>(
      'SELECT * FROM credit_notes WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Credit note not found' });
      return;
    }
    if (role === 'site' && existing.site !== site) {
      res.status(403).json({ error: 'Forbidden', message: 'Not your site' });
      return;
    }
    // Site cannot change site field
    if (role === 'site' && data.site !== undefined && data.site !== existing.site) {
      res.status(403).json({ error: 'Forbidden', message: 'Site accountants cannot change site' });
      return;
    }
    // If the CN already has allocations, prevent changing total_amount below current allocated sum
    if (data.total_amount !== undefined) {
      const row = await queryOne<{ sum: string }>(
        'SELECT COALESCE(SUM(allocated_amount), 0)::text AS sum FROM credit_note_allocations WHERE credit_note_id = $1',
        [id]
      );
      const allocated = Number(row?.sum ?? 0);
      if (data.total_amount < allocated - 0.01) {
        res.status(400).json({
          error: 'Bad Request',
          message: `Cannot reduce total below allocated amount (₹${allocated})`,
        });
        return;
      }
    }

    const ALLOWED = ['cn_no', 'cn_date', 'vendor_id', 'vendor_name', 'site', 'base_amount', 'cgst_pct', 'sgst_pct', 'igst_pct', 'total_amount', 'remarks'];
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && ALLOWED.includes(k)) {
        fields.push(`${k} = $${idx++}`);
        values.push(v);
      }
    }
    if (fields.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'No fields to update' });
      return;
    }
    fields.push('updated_at = NOW()');
    values.push(id);

    const updated = await queryOne<CreditNoteRow>(
      `UPDATE credit_notes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    await logAudit({
      userId,
      action: `Updated credit note #${updated?.cn_no ?? id}`,
      creditNoteId: id,
      metadata: { fields_changed: Object.keys(data) },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteCreditNote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { id: userId } = req.user!;

    const existing = await queryOne<CreditNoteRow>(
      'SELECT * FROM credit_notes WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Credit note not found' });
      return;
    }

    // Collect invoices touched by allocations so we can recompute their status after detach
    const allocs = await query<{ invoice_id: string }>(
      'SELECT invoice_id FROM credit_note_allocations WHERE credit_note_id = $1',
      [id]
    );

    await withTransaction(async (tx) => {
      // Remove allocations so effective payable goes back up
      await tx.query('DELETE FROM credit_note_allocations WHERE credit_note_id = $1', [id]);
      await tx.query(
        'UPDATE credit_notes SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2',
        [userId, id]
      );
    });

    for (const a of allocs) {
      await recomputeInvoiceStatus(a.invoice_id);
    }

    await logAudit({
      userId,
      action: `Deleted credit note #${existing.cn_no}`,
      creditNoteId: id,
    });

    res.json({ message: 'Credit note deleted' });
  } catch (err) {
    next(err);
  }
}

export async function addAllocation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cnId = req.params.id as string;
    const { role, site, id: userId } = req.user!;
    const data = allocationInputSchema.parse(req.body);

    const cn = await queryOne<CreditNoteRow>(
      'SELECT * FROM credit_notes WHERE id = $1 AND deleted_at IS NULL',
      [cnId]
    );
    if (!cn) {
      res.status(404).json({ error: 'Not Found', message: 'Credit note not found' });
      return;
    }
    if (role === 'site' && cn.site !== site) {
      res.status(403).json({ error: 'Forbidden', message: 'Not your site' });
      return;
    }

    const inv = await queryOne<{ id: string; site: string; vendor_id: string | null; invoice_no: string | null }>(
      'SELECT id, site, vendor_id, invoice_no FROM invoices WHERE id = $1 AND deleted_at IS NULL',
      [data.invoice_id]
    );
    if (!inv) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }
    if (role === 'site' && inv.site !== site) {
      res.status(403).json({ error: 'Forbidden', message: 'Cannot allocate to invoices outside your site' });
      return;
    }
    if (inv.vendor_id && inv.vendor_id !== cn.vendor_id) {
      res.status(400).json({ error: 'Bad Request', message: 'Credit note vendor does not match invoice vendor' });
      return;
    }

    try {
      await queryOne<AllocationRow>(
        `INSERT INTO credit_note_allocations (credit_note_id, invoice_id, allocated_amount, allocated_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [cnId, data.invoice_id, data.allocated_amount, userId]
      );
    } catch (err) {
      // Trigger-raised errors (over-allocation) come through as pg errors
      const msg = err instanceof Error ? err.message : 'Allocation failed';
      if (msg.includes('exceeds')) {
        res.status(400).json({ error: 'Bad Request', message: msg });
        return;
      }
      if (msg.includes('duplicate key')) {
        res.status(409).json({ error: 'Conflict', message: 'This invoice already has an allocation from this credit note. Remove it first to change the amount.' });
        return;
      }
      throw err;
    }

    await recomputeInvoiceStatus(data.invoice_id);

    await logAudit({
      userId,
      action: `Allocated ₹${data.allocated_amount.toLocaleString('en-IN')} of CN #${cn.cn_no} to invoice #${inv.invoice_no ?? inv.id.slice(0, 8)}`,
      creditNoteId: cnId,
      invoiceId: data.invoice_id,
    });

    res.status(201).json({ message: 'Allocation created' });
  } catch (err) {
    next(err);
  }
}

export async function removeAllocation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cnId = req.params.id as string;
    const allocId = req.params.allocId as string;
    const { id: userId } = req.user!;

    const alloc = await queryOne<AllocationRow>(
      'SELECT * FROM credit_note_allocations WHERE id = $1 AND credit_note_id = $2',
      [allocId, cnId]
    );
    if (!alloc) {
      res.status(404).json({ error: 'Not Found', message: 'Allocation not found' });
      return;
    }

    await query('DELETE FROM credit_note_allocations WHERE id = $1', [allocId]);
    await recomputeInvoiceStatus(alloc.invoice_id);

    await logAudit({
      userId,
      action: `Removed allocation of ₹${Number(alloc.allocated_amount).toLocaleString('en-IN')} from CN`,
      creditNoteId: cnId,
      invoiceId: alloc.invoice_id,
    });

    res.json({ message: 'Allocation removed' });
  } catch (err) {
    next(err);
  }
}

export async function getVendorCreditBalance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const vendorId = req.params.vendorId as string;

    const row = await queryOne<{ total: string; allocated: string }>(
      `SELECT
         COALESCE((SELECT SUM(total_amount) FROM credit_notes WHERE vendor_id = $1 AND deleted_at IS NULL), 0)::text AS total,
         COALESCE((SELECT SUM(a.allocated_amount) FROM credit_note_allocations a
                   JOIN credit_notes cn ON cn.id = a.credit_note_id
                   WHERE cn.vendor_id = $1 AND cn.deleted_at IS NULL), 0)::text AS allocated`,
      [vendorId]
    );

    const total = Number(row?.total ?? 0);
    const allocated = Number(row?.allocated ?? 0);
    res.json({
      total_credit: total,
      allocated,
      unallocated_balance: total - allocated,
    });
  } catch (err) {
    next(err);
  }
}

export async function getInvoiceCreditSuggestions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoiceId = req.params.invoiceId as string;

    const inv = await queryOne<{
      id: string;
      vendor_id: string | null;
      vendor_name: string;
      invoice_amount: string;
      allocated: string;
    }>(
      `SELECT i.id, i.vendor_id, i.vendor_name, i.invoice_amount::text,
              COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE invoice_id = i.id), 0)::text AS allocated
       FROM invoices i
       WHERE i.id = $1 AND i.deleted_at IS NULL`,
      [invoiceId]
    );
    if (!inv) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }
    if (!inv.vendor_id) {
      res.json({ available_credits: [], unallocated_balance: 0, invoice_effective_payable: Number(inv.invoice_amount) });
      return;
    }

    // List CNs for this vendor with remaining (unallocated) balance > 0
    const cns = await query<{
      id: string;
      cn_no: string;
      cn_date: string;
      total_amount: string;
      allocated: string;
    }>(
      `SELECT cn.id, cn.cn_no, cn.cn_date, cn.total_amount::text,
              COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE credit_note_id = cn.id), 0)::text AS allocated
       FROM credit_notes cn
       WHERE cn.vendor_id = $1 AND cn.deleted_at IS NULL
       ORDER BY cn.cn_date DESC`,
      [inv.vendor_id]
    );

    const available = cns
      .map((cn) => ({
        id: cn.id,
        cn_no: cn.cn_no,
        cn_date: cn.cn_date,
        total_amount: Number(cn.total_amount),
        unallocated_balance: Number(cn.total_amount) - Number(cn.allocated),
      }))
      .filter((c) => c.unallocated_balance > 0.009);

    const vendorBalance = available.reduce((s, c) => s + c.unallocated_balance, 0);
    const invoiceEffective = Number(inv.invoice_amount) - Number(inv.allocated);

    res.json({
      available_credits: available,
      unallocated_balance: vendorBalance,
      invoice_effective_payable: invoiceEffective,
    });
  } catch (err) {
    next(err);
  }
}
