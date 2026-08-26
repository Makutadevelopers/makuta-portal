// petty-cash.controller.ts
// Per-site petty cash float tracking.
//
// Roles:
// - ho   : list/create disbursements and expenses for any site; view all balances
// - site : view balance + ledger for own site only; log own-site expenses
// - mgmt : 403 everywhere (per product decision — MD does not see petty cash)
//
// Balance per site = Σ(disbursements.amount) − Σ(expenses.amount), both active.
// A petty-cash expense may optionally pay a ≤ MINOR_LIMIT invoice in its own site;
// when invoice_id is supplied the controller also inserts a `payments` row
// (payment_type = 'petty_cash') and recomputes invoice.payment_status.

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/query';
import { logAudit } from '../services/audit.service';
import { paymentStatusCase } from '../services/payment.service';
import { isSiteScoped, userHasSite } from '../middleware/auth';
import { normaliseSiteName } from '../utils/sites';

const MINOR_LIMIT = 50000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(v => !isNaN(new Date(v).getTime()), 'Invalid calendar date');

const disbursementSchema = z.object({
  site:      z.string().min(1, 'Site is required').max(100),
  amount:    z.number().positive('Amount must be positive').max(1e10),
  given_on:  isoDate,
  mode:      z.enum(['cash', 'bank']).default('cash'),
  reference: z.string().max(100).optional().nullable(),
  remarks:   z.string().max(500).optional().nullable(),
});

const expenseSchema = z.object({
  site:       z.string().min(1, 'Site is required').max(100),
  amount:     z.number().positive('Amount must be positive').max(1e10),
  spent_on:   isoDate,
  purpose:    z.string().min(1, 'Purpose is required').max(500),
  invoice_id: z.string().uuid('invoice_id must be a valid UUID').optional().nullable(),
  remarks:    z.string().max(500).optional().nullable(),
});

// Edits keep site and invoice linkage immutable — moving money between sites or
// invoices is a delete + recreate, not a quiet edit.
const updateDisbursementSchema = z.object({
  amount:    z.number().positive('Amount must be positive').max(1e10),
  given_on:  isoDate,
  mode:      z.enum(['cash', 'bank']).default('cash'),
  reference: z.string().max(100).optional().nullable(),
  remarks:   z.string().max(500).optional().nullable(),
});

const updateExpenseSchema = z.object({
  amount:   z.number().positive('Amount must be positive').max(1e10),
  spent_on: isoDate,
  purpose:  z.string().min(1, 'Purpose is required').max(500),
  remarks:  z.string().max(500).optional().nullable(),
});

const deleteReasonSchema = z.object({
  reason: z.string().trim().min(3, 'Please give a reason (e.g. wrong amount, duplicate entry)').max(500),
});

interface BalanceRow {
  site: string;
  total_in:       string;
  total_out:      string;
  balance:        string;
  last_activity:  string | null;
}

interface DisbursementRow {
  id: string;
  site: string;
  amount: string;
  given_on: string;
  given_by: string;
  given_by_name?: string;
  mode: string;
  reference: string | null;
  remarks: string | null;
  created_at: string;
}

interface ExpenseRow {
  id: string;
  site: string;
  amount: string;
  spent_on: string;
  purpose: string;
  invoice_id: string | null;
  payment_id: string | null;
  recorded_by: string;
  recorded_by_name?: string;
  invoice_no?: string | null;
  remarks: string | null;
  created_at: string;
}

// ── balances ────────────────────────────────────────────────────────────
// GET /api/petty-cash/balances        — HO: balances across all sites
// GET /api/petty-cash/balances/:site  — HO or site (site restricted to assigned sites)
export async function getBalances(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { site: userSite } = req.user!;
    const userSites = req.user!.sites && req.user!.sites.length > 0
      ? req.user!.sites
      : (userSite ? [userSite] : []);
    const siteParam = (req.params.site as string | undefined) ?? null;

    // Site accountants and project managers are both scoped to assigned sites.
    if (isSiteScoped(req.user)) {
      if (siteParam && !userHasSite(req.user, siteParam)) {
        res.status(403).json({ error: 'Forbidden', message: 'You can only view balances for sites you are assigned to' });
        return;
      }
      if (siteParam) {
        const row = await fetchSiteBalance(normaliseSiteName(siteParam));
        res.json(row);
        return;
      }
      // No specific site requested → return one row per assigned site
      const rows = await Promise.all(userSites.map(s => fetchSiteBalance(normaliseSiteName(s))));
      res.json(rows);
      return;
    }

    if (siteParam) {
      const row = await fetchSiteBalance(normaliseSiteName(siteParam));
      res.json(row);
      return;
    }

    // HO list across all sites present in either table
    const rows = await query<BalanceRow>(`
      WITH sites AS (
        SELECT site FROM petty_cash_disbursements WHERE deleted_at IS NULL
        UNION
        SELECT site FROM petty_cash_expenses      WHERE deleted_at IS NULL
      )
      SELECT
        s.site,
        COALESCE((SELECT SUM(amount) FROM petty_cash_disbursements d
                  WHERE d.site = s.site AND d.deleted_at IS NULL), 0)::TEXT AS total_in,
        COALESCE((SELECT SUM(amount) FROM petty_cash_expenses e
                  WHERE e.site = s.site AND e.deleted_at IS NULL), 0)::TEXT AS total_out,
        (
          COALESCE((SELECT SUM(amount) FROM petty_cash_disbursements d
                    WHERE d.site = s.site AND d.deleted_at IS NULL), 0)
        - COALESCE((SELECT SUM(amount) FROM petty_cash_expenses e
                    WHERE e.site = s.site AND e.deleted_at IS NULL), 0)
        )::TEXT AS balance,
        GREATEST(
          (SELECT MAX(created_at) FROM petty_cash_disbursements d WHERE d.site = s.site AND d.deleted_at IS NULL),
          (SELECT MAX(created_at) FROM petty_cash_expenses      e WHERE e.site = s.site AND e.deleted_at IS NULL)
        )::TEXT AS last_activity
      FROM sites s
      ORDER BY s.site
    `);
    res.json(rows);
  } catch (err) { next(err); }
}

async function fetchSiteBalance(site: string): Promise<BalanceRow> {
  const row = await queryOne<BalanceRow>(`
    SELECT
      $1::text AS site,
      COALESCE((SELECT SUM(amount) FROM petty_cash_disbursements
                WHERE site = $1 AND deleted_at IS NULL), 0)::TEXT AS total_in,
      COALESCE((SELECT SUM(amount) FROM petty_cash_expenses
                WHERE site = $1 AND deleted_at IS NULL), 0)::TEXT AS total_out,
      (
        COALESCE((SELECT SUM(amount) FROM petty_cash_disbursements
                  WHERE site = $1 AND deleted_at IS NULL), 0)
      - COALESCE((SELECT SUM(amount) FROM petty_cash_expenses
                  WHERE site = $1 AND deleted_at IS NULL), 0)
      )::TEXT AS balance,
      GREATEST(
        (SELECT MAX(created_at) FROM petty_cash_disbursements WHERE site = $1 AND deleted_at IS NULL),
        (SELECT MAX(created_at) FROM petty_cash_expenses      WHERE site = $1 AND deleted_at IS NULL)
      )::TEXT AS last_activity
  `, [site]);
  return row!;
}

// ── disbursements ───────────────────────────────────────────────────────
// POST /api/petty-cash/disbursements — HO only
export async function createDisbursement(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: userId } = req.user!;
    const data = disbursementSchema.parse(req.body);
    const site = normaliseSiteName(data.site);

    const row = await queryOne<DisbursementRow>(
      `INSERT INTO petty_cash_disbursements
         (site, amount, given_on, given_by, mode, reference, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [site, data.amount, data.given_on, userId, data.mode,
       data.reference ?? null, data.remarks ?? null]
    );

    logAudit({
      userId,
      action: `Petty cash given: ₹${data.amount.toLocaleString('en-IN')} to ${site}`,
      metadata: { kind: 'petty_cash_disbursement', site, amount: data.amount },
    }).catch(e => console.error('[audit] petty cash disbursement log failed:', e));

    res.status(201).json(row);
  } catch (err) { next(err); }
}

// GET /api/petty-cash/disbursements?site=X — HO (any site) | site (assigned sites only)
export async function listDisbursements(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { site: userSite } = req.user!;
    const userSites = req.user!.sites && req.user!.sites.length > 0
      ? req.user!.sites
      : (userSite ? [userSite] : []);
    const qSite = (req.query.site as string | undefined) ?? null;
    const scoped = isSiteScoped(req.user);

    if (scoped && qSite && !userHasSite(req.user, qSite)) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only view sites you are assigned to' });
      return;
    }

    let where: string;
    let params: unknown[];
    if (qSite) {
      where = 'WHERE d.site = $1 AND d.deleted_at IS NULL';
      params = [normaliseSiteName(qSite)];
    } else if (scoped) {
      where = 'WHERE d.site = ANY($1) AND d.deleted_at IS NULL';
      params = [userSites];
    } else {
      where = 'WHERE d.deleted_at IS NULL';
      params = [];
    }
    const rows = await query<DisbursementRow>(
      `SELECT d.*, u.name AS given_by_name
         FROM petty_cash_disbursements d
         LEFT JOIN users u ON u.id = d.given_by
         ${where}
         ORDER BY d.given_on DESC, d.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

// PATCH /api/petty-cash/disbursements/:id — HO only
export async function updateDisbursement(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: userId } = req.user!;
    const id = req.params.id as string;
    const data = updateDisbursementSchema.parse(req.body);

    const result = await withTransaction(async (tx) => {
      const existing = await tx.queryOne<DisbursementRow>(
        `SELECT * FROM petty_cash_disbursements WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id]
      );
      if (!existing) {
        return { status: 404 as const, body: { error: 'Not Found', message: 'Disbursement not found' } };
      }

      // Lock the site's rows so a concurrent expense/disbursement write can't
      // race this balance check (mirrors createExpense's locking).
      await tx.query(`SELECT 1 FROM petty_cash_disbursements WHERE site = $1 AND deleted_at IS NULL FOR UPDATE`, [existing.site]);
      await tx.query(`SELECT 1 FROM petty_cash_expenses WHERE site = $1 AND deleted_at IS NULL FOR UPDATE`, [existing.site]);

      const aggRow = await tx.queryOne<{ other_in: string; total_out: string }>(
        `SELECT
           COALESCE((SELECT SUM(amount) FROM petty_cash_disbursements WHERE site = $1 AND id <> $2 AND deleted_at IS NULL), 0)::TEXT AS other_in,
           COALESCE((SELECT SUM(amount) FROM petty_cash_expenses WHERE site = $1 AND deleted_at IS NULL), 0)::TEXT AS total_out`,
        [existing.site, id]
      );
      const newBalance = Number(aggRow?.other_in ?? 0) + data.amount - Number(aggRow?.total_out ?? 0);
      if (newBalance < 0) {
        return { status: 400 as const, body: {
          error: 'Bad Request',
          message: `Reducing this to ₹${data.amount.toLocaleString('en-IN')} would leave ${existing.site} with a negative balance of ₹${newBalance.toLocaleString('en-IN')}. Adjust downstream expenses first.`,
        } };
      }

      const updated = await tx.queryOne<DisbursementRow>(
        `UPDATE petty_cash_disbursements
           SET amount = $1, given_on = $2, mode = $3, reference = $4, remarks = $5
         WHERE id = $6
         RETURNING *`,
        [data.amount, data.given_on, data.mode, data.reference ?? null, data.remarks ?? null, id]
      );

      return { status: 200 as const, body: { updated: updated!, existing } };
    });

    if (result.status !== 200) {
      res.status(result.status).json(result.body);
      return;
    }

    const { updated, existing } = result.body as { updated: DisbursementRow; existing: DisbursementRow };

    const diffs: string[] = [];
    if (Number(existing.amount) !== Number(updated.amount)) {
      diffs.push(`amount ₹${Number(existing.amount).toLocaleString('en-IN')} → ₹${Number(updated.amount).toLocaleString('en-IN')}`);
    }
    if (String(existing.given_on).slice(0, 10) !== String(updated.given_on).slice(0, 10)) {
      diffs.push(`date ${String(existing.given_on).slice(0, 10)} → ${String(updated.given_on).slice(0, 10)}`);
    }
    if (existing.mode !== updated.mode) diffs.push(`mode ${existing.mode} → ${updated.mode}`);
    if ((existing.reference ?? '') !== (updated.reference ?? '')) {
      diffs.push(`reference ${existing.reference ?? '—'} → ${updated.reference ?? '—'}`);
    }
    if ((existing.remarks ?? '') !== (updated.remarks ?? '')) diffs.push('remarks updated');

    logAudit({
      userId,
      action: `Edited petty cash disbursement at ${existing.site}: ${diffs.length ? diffs.join(' · ') : 'no field changes'}`,
      metadata: { kind: 'petty_cash_disbursement_edit', disbursementId: id, site: existing.site, before: existing, after: updated },
    }).catch(e => console.error('[audit] petty cash disbursement edit log failed:', e));

    res.json(updated);
  } catch (err) { next(err); }
}

// DELETE /api/petty-cash/disbursements/:id — HO only
export async function deleteDisbursement(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: userId } = req.user!;
    const id = req.params.id as string;
    const { reason } = deleteReasonSchema.parse(req.body);

    const result = await withTransaction(async (tx) => {
      const existing = await tx.queryOne<DisbursementRow>(
        `SELECT * FROM petty_cash_disbursements WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id]
      );
      if (!existing) {
        return { status: 404 as const, body: { error: 'Not Found', message: 'Disbursement not found' } };
      }

      await tx.query(`SELECT 1 FROM petty_cash_disbursements WHERE site = $1 AND deleted_at IS NULL FOR UPDATE`, [existing.site]);
      await tx.query(`SELECT 1 FROM petty_cash_expenses WHERE site = $1 AND deleted_at IS NULL FOR UPDATE`, [existing.site]);

      const aggRow = await tx.queryOne<{ other_in: string; total_out: string }>(
        `SELECT
           COALESCE((SELECT SUM(amount) FROM petty_cash_disbursements WHERE site = $1 AND id <> $2 AND deleted_at IS NULL), 0)::TEXT AS other_in,
           COALESCE((SELECT SUM(amount) FROM petty_cash_expenses WHERE site = $1 AND deleted_at IS NULL), 0)::TEXT AS total_out`,
        [existing.site, id]
      );
      const newBalance = Number(aggRow?.other_in ?? 0) - Number(aggRow?.total_out ?? 0);
      if (newBalance < 0) {
        return { status: 400 as const, body: {
          error: 'Bad Request',
          message: `Deleting this would leave ${existing.site} with a negative balance of ₹${newBalance.toLocaleString('en-IN')}. Adjust downstream expenses first.`,
        } };
      }

      await tx.query(
        `UPDATE petty_cash_disbursements SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2`,
        [userId, id]
      );

      return { status: 200 as const, body: { existing } };
    });

    if (result.status !== 200) {
      res.status(result.status).json(result.body);
      return;
    }

    const { existing } = result.body as { existing: DisbursementRow };

    logAudit({
      userId,
      action: `Deleted petty cash disbursement: ₹${Number(existing.amount).toLocaleString('en-IN')} given to ${existing.site} on ${String(existing.given_on).slice(0, 10)} — ${reason}`,
      metadata: { kind: 'petty_cash_disbursement_delete', disbursementId: id, site: existing.site, amount: existing.amount, reason, before: existing },
    }).catch(e => console.error('[audit] petty cash disbursement delete log failed:', e));

    res.json({ message: 'Disbursement deleted' });
  } catch (err) { next(err); }
}

// ── expenses ────────────────────────────────────────────────────────────
// POST /api/petty-cash/expenses — HO (any site) | site (assigned sites only)
export async function createExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, id: userId } = req.user!;
    const data = expenseSchema.parse(req.body);
    const site = normaliseSiteName(data.site);

    if (role === 'site' && !userHasSite(req.user, site)) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only log expenses for sites you are assigned to' });
      return;
    }

    const result = await withTransaction(async (tx) => {
      // Lock the site's petty cash rows so two concurrent expenses can't both
      // pass the balance check and overdraw. Locking the aggregate means
      // serialising any writes on this site's float.
      await tx.query(
        `SELECT 1 FROM petty_cash_disbursements WHERE site = $1 AND deleted_at IS NULL FOR UPDATE`,
        [site]
      );
      await tx.query(
        `SELECT 1 FROM petty_cash_expenses WHERE site = $1 AND deleted_at IS NULL FOR UPDATE`,
        [site]
      );

      const balRow = await tx.queryOne<{ balance: string }>(
        `SELECT (
            COALESCE((SELECT SUM(amount) FROM petty_cash_disbursements
                      WHERE site = $1 AND deleted_at IS NULL), 0)
          - COALESCE((SELECT SUM(amount) FROM petty_cash_expenses
                      WHERE site = $1 AND deleted_at IS NULL), 0)
         )::TEXT AS balance`,
        [site]
      );
      const balance = Number(balRow?.balance ?? 0);
      if (data.amount > balance) {
        return { status: 400 as const, body: {
          error: 'Bad Request',
          message: `Expense of ₹${data.amount.toLocaleString('en-IN')} exceeds petty cash balance of ₹${balance.toLocaleString('en-IN')}`,
        } };
      }

      let paymentId: string | null = null;

      if (data.invoice_id) {
        // Pay this invoice from petty cash — mirrors payment.controller logic
        const inv = await tx.queryOne<{ id: string; invoice_amount: string; site: string; pushed: boolean; deleted_at: string | null }>(
          `SELECT id, invoice_amount, site, pushed, deleted_at
             FROM invoices WHERE id = $1 FOR UPDATE`,
          [data.invoice_id]
        );
        if (!inv || inv.deleted_at) {
          return { status: 404 as const, body: { error: 'Not Found', message: 'Invoice not found' } };
        }
        if (normaliseSiteName(inv.site) !== site) {
          return { status: 400 as const, body: { error: 'Bad Request', message: 'Invoice is not from this site' } };
        }
        if (role === 'site' && inv.pushed) {
          return { status: 403 as const, body: { error: 'Forbidden', message: 'Finalized invoices can only be paid by Head Office' } };
        }
        if (role === 'site' && data.amount > MINOR_LIMIT) {
          return { status: 403 as const, body: { error: 'Forbidden', message: `Site accountants can only pay invoices up to ₹${MINOR_LIMIT.toLocaleString('en-IN')}` } };
        }

        const sumRow = await tx.queryOne<{ paid: string; allocated: string }>(
          `SELECT
             COALESCE((SELECT SUM(amount + tds_amount + gst_tds_amount) FROM payments             WHERE invoice_id = $1), 0)::TEXT AS paid,
             COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE invoice_id = $1), 0)::TEXT AS allocated`,
          [data.invoice_id]
        );
        const alreadyPaid = Number(sumRow?.paid ?? 0);
        const allocated   = Number(sumRow?.allocated ?? 0);
        const invBalance  = Number(inv.invoice_amount) - alreadyPaid - allocated;
        if (data.amount > invBalance) {
          return { status: 400 as const, body: {
            error: 'Bad Request',
            message: `Payment of ₹${data.amount.toLocaleString('en-IN')} exceeds outstanding invoice balance of ₹${invBalance.toLocaleString('en-IN')}`,
          } };
        }

        const payment = await tx.queryOne<{ id: string }>(
          `INSERT INTO payments (invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by)
           VALUES ($1,$2,'petty_cash',NULL,$3,NULL,$4)
           RETURNING id`,
          [data.invoice_id, data.amount, data.spent_on, userId]
        );
        paymentId = payment!.id;

        if (role === 'site') {
          await tx.query(
            `UPDATE invoices SET minor_payment = TRUE, updated_at = NOW() WHERE id = $1`,
            [data.invoice_id]
          );
        }
        await tx.query(
          `UPDATE invoices
             SET payment_status = ${paymentStatusCase('invoices')},
                 updated_at = NOW()
           WHERE id = $1`,
          [data.invoice_id]
        );
      }

      const expense = await tx.queryOne<ExpenseRow>(
        `INSERT INTO petty_cash_expenses
           (site, amount, spent_on, purpose, invoice_id, payment_id, recorded_by, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [site, data.amount, data.spent_on, data.purpose,
         data.invoice_id ?? null, paymentId, userId, data.remarks ?? null]
      );

      return { status: 201 as const, body: expense };
    });

    if (result.status !== 201) {
      res.status(result.status).json(result.body);
      return;
    }

    logAudit({
      userId,
      action: `Petty cash spent: ₹${data.amount.toLocaleString('en-IN')} at ${site} — ${data.purpose}`,
      invoiceId: data.invoice_id ?? undefined,
      metadata: { kind: 'petty_cash_expense', site, amount: data.amount, purpose: data.purpose, invoice_id: data.invoice_id ?? null },
    }).catch(e => console.error('[audit] petty cash expense log failed:', e));

    res.status(201).json(result.body);
  } catch (err) { next(err); }
}

// GET /api/petty-cash/expenses?site=X — HO (any site) | site (assigned sites only)
export async function listExpenses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { site: userSite } = req.user!;
    const userSites = req.user!.sites && req.user!.sites.length > 0
      ? req.user!.sites
      : (userSite ? [userSite] : []);
    const qSite = (req.query.site as string | undefined) ?? null;
    const scoped = isSiteScoped(req.user);

    if (scoped && qSite && !userHasSite(req.user, qSite)) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only view sites you are assigned to' });
      return;
    }

    let where: string;
    let params: unknown[];
    if (qSite) {
      where = 'WHERE e.site = $1 AND e.deleted_at IS NULL';
      params = [normaliseSiteName(qSite)];
    } else if (scoped) {
      where = 'WHERE e.site = ANY($1) AND e.deleted_at IS NULL';
      params = [userSites];
    } else {
      where = 'WHERE e.deleted_at IS NULL';
      params = [];
    }
    const rows = await query<ExpenseRow>(
      `SELECT e.*, u.name AS recorded_by_name, i.invoice_no
         FROM petty_cash_expenses e
         LEFT JOIN users u    ON u.id = e.recorded_by
         LEFT JOIN invoices i ON i.id = e.invoice_id
         ${where}
         ORDER BY e.spent_on DESC, e.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

// PATCH /api/petty-cash/expenses/:id — HO (any site) | site (assigned sites only)
export async function updateExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, id: userId } = req.user!;
    const id = req.params.id as string;
    const data = updateExpenseSchema.parse(req.body);

    const result = await withTransaction(async (tx) => {
      const existing = await tx.queryOne<ExpenseRow>(
        `SELECT * FROM petty_cash_expenses WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id]
      );
      if (!existing) {
        return { status: 404 as const, body: { error: 'Not Found', message: 'Expense not found' } };
      }
      if (role === 'site' && !userHasSite(req.user, existing.site)) {
        return { status: 403 as const, body: { error: 'Forbidden', message: 'You can only edit expenses for sites you are assigned to' } };
      }

      await tx.query(`SELECT 1 FROM petty_cash_disbursements WHERE site = $1 AND deleted_at IS NULL FOR UPDATE`, [existing.site]);
      await tx.query(`SELECT 1 FROM petty_cash_expenses WHERE site = $1 AND deleted_at IS NULL FOR UPDATE`, [existing.site]);

      const aggRow = await tx.queryOne<{ total_in: string; other_out: string }>(
        `SELECT
           COALESCE((SELECT SUM(amount) FROM petty_cash_disbursements WHERE site = $1 AND deleted_at IS NULL), 0)::TEXT AS total_in,
           COALESCE((SELECT SUM(amount) FROM petty_cash_expenses WHERE site = $1 AND id <> $2 AND deleted_at IS NULL), 0)::TEXT AS other_out`,
        [existing.site, id]
      );
      const availableBalance = Number(aggRow?.total_in ?? 0) - Number(aggRow?.other_out ?? 0);
      if (data.amount > availableBalance) {
        return { status: 400 as const, body: {
          error: 'Bad Request',
          message: `Expense of ₹${data.amount.toLocaleString('en-IN')} exceeds petty cash balance of ₹${availableBalance.toLocaleString('en-IN')}`,
        } };
      }

      let newInvoiceStatus: string | null = null;

      if (existing.invoice_id && existing.payment_id) {
        const inv = await tx.queryOne<{ id: string; invoice_amount: string; pushed: boolean; deleted_at: string | null }>(
          `SELECT id, invoice_amount, pushed, deleted_at FROM invoices WHERE id = $1 FOR UPDATE`,
          [existing.invoice_id]
        );
        if (!inv || inv.deleted_at) {
          return { status: 404 as const, body: { error: 'Not Found', message: 'Linked invoice not found' } };
        }
        if (role === 'site' && inv.pushed) {
          return { status: 403 as const, body: { error: 'Forbidden', message: 'Finalized invoices can only be adjusted by Head Office' } };
        }
        if (role === 'site' && data.amount > MINOR_LIMIT) {
          return { status: 403 as const, body: { error: 'Forbidden', message: `Site accountants can only pay invoices up to ₹${MINOR_LIMIT.toLocaleString('en-IN')}` } };
        }

        const sumRow = await tx.queryOne<{ paid: string; allocated: string }>(
          `SELECT
             COALESCE((SELECT SUM(amount + tds_amount + gst_tds_amount) FROM payments WHERE invoice_id = $1 AND id <> $2), 0)::TEXT AS paid,
             COALESCE((SELECT SUM(allocated_amount) FROM credit_note_allocations WHERE invoice_id = $1), 0)::TEXT AS allocated`,
          [existing.invoice_id, existing.payment_id]
        );
        const invBalance = Number(inv.invoice_amount) - Number(sumRow?.paid ?? 0) - Number(sumRow?.allocated ?? 0);
        if (data.amount > invBalance) {
          return { status: 400 as const, body: {
            error: 'Bad Request',
            message: `Payment of ₹${data.amount.toLocaleString('en-IN')} exceeds outstanding invoice balance of ₹${invBalance.toLocaleString('en-IN')}`,
          } };
        }

        await tx.query(`UPDATE payments SET amount = $1, payment_date = $2 WHERE id = $3`, [data.amount, data.spent_on, existing.payment_id]);
        const statusRow = await tx.queryOne<{ payment_status: string }>(
          `UPDATE invoices SET payment_status = ${paymentStatusCase('invoices')}, updated_at = NOW() WHERE id = $1 RETURNING payment_status`,
          [existing.invoice_id]
        );
        newInvoiceStatus = statusRow?.payment_status ?? null;
      }

      const updated = await tx.queryOne<ExpenseRow>(
        `UPDATE petty_cash_expenses
           SET amount = $1, spent_on = $2, purpose = $3, remarks = $4
         WHERE id = $5
         RETURNING *`,
        [data.amount, data.spent_on, data.purpose, data.remarks ?? null, id]
      );

      return { status: 200 as const, body: { updated: updated!, existing, newInvoiceStatus } };
    });

    if (result.status !== 200) {
      res.status(result.status).json(result.body);
      return;
    }

    const { updated, existing, newInvoiceStatus } = result.body as { updated: ExpenseRow; existing: ExpenseRow; newInvoiceStatus: string | null };

    const diffs: string[] = [];
    if (Number(existing.amount) !== Number(updated.amount)) {
      diffs.push(`amount ₹${Number(existing.amount).toLocaleString('en-IN')} → ₹${Number(updated.amount).toLocaleString('en-IN')}`);
    }
    if (String(existing.spent_on).slice(0, 10) !== String(updated.spent_on).slice(0, 10)) {
      diffs.push(`date ${String(existing.spent_on).slice(0, 10)} → ${String(updated.spent_on).slice(0, 10)}`);
    }
    if (existing.purpose !== updated.purpose) diffs.push(`purpose "${existing.purpose}" → "${updated.purpose}"`);
    if ((existing.remarks ?? '') !== (updated.remarks ?? '')) diffs.push('remarks updated');

    logAudit({
      userId,
      action: `Edited petty cash expense at ${existing.site}: ${diffs.length ? diffs.join(' · ') : 'no field changes'}`,
      invoiceId: existing.invoice_id ?? undefined,
      metadata: { kind: 'petty_cash_expense_edit', expenseId: id, site: existing.site, before: existing, after: updated },
    }).catch(e => console.error('[audit] petty cash expense edit log failed:', e));

    res.json({ ...updated, invoice_payment_status: newInvoiceStatus ?? undefined });
  } catch (err) { next(err); }
}

// DELETE /api/petty-cash/expenses/:id — HO (any site) | site (assigned sites only)
export async function deleteExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, id: userId } = req.user!;
    const id = req.params.id as string;
    const { reason } = deleteReasonSchema.parse(req.body);

    const result = await withTransaction(async (tx) => {
      const existing = await tx.queryOne<ExpenseRow>(
        `SELECT * FROM petty_cash_expenses WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id]
      );
      if (!existing) {
        return { status: 404 as const, body: { error: 'Not Found', message: 'Expense not found' } };
      }
      if (role === 'site' && !userHasSite(req.user, existing.site)) {
        return { status: 403 as const, body: { error: 'Forbidden', message: 'You can only delete expenses for sites you are assigned to' } };
      }

      let newInvoiceStatus: string | null = null;

      if (existing.invoice_id && existing.payment_id) {
        const inv = await tx.queryOne<{ id: string; pushed: boolean; deleted_at: string | null }>(
          `SELECT id, pushed, deleted_at FROM invoices WHERE id = $1 FOR UPDATE`,
          [existing.invoice_id]
        );
        if (role === 'site' && inv && inv.pushed) {
          return { status: 403 as const, body: { error: 'Forbidden', message: 'Finalized invoices can only be adjusted by Head Office' } };
        }
        await tx.query(`DELETE FROM payments WHERE id = $1`, [existing.payment_id]);
        if (inv && !inv.deleted_at) {
          const statusRow = await tx.queryOne<{ payment_status: string }>(
            `UPDATE invoices SET payment_status = ${paymentStatusCase('invoices')}, updated_at = NOW() WHERE id = $1 RETURNING payment_status`,
            [existing.invoice_id]
          );
          newInvoiceStatus = statusRow?.payment_status ?? null;
        }
      }

      await tx.query(
        `UPDATE petty_cash_expenses SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2`,
        [userId, id]
      );

      return { status: 200 as const, body: { existing, newInvoiceStatus } };
    });

    if (result.status !== 200) {
      res.status(result.status).json(result.body);
      return;
    }

    const { existing, newInvoiceStatus } = result.body as { existing: ExpenseRow; newInvoiceStatus: string | null };

    logAudit({
      userId,
      action: `Deleted petty cash expense: ₹${Number(existing.amount).toLocaleString('en-IN')} at ${existing.site} — ${existing.purpose} — ${reason}`,
      invoiceId: existing.invoice_id ?? undefined,
      metadata: { kind: 'petty_cash_expense_delete', expenseId: id, site: existing.site, amount: existing.amount, purpose: existing.purpose, reason, before: existing },
    }).catch(e => console.error('[audit] petty cash expense delete log failed:', e));

    res.json({ message: 'Expense deleted', invoice_payment_status: newInvoiceStatus ?? undefined });
  } catch (err) { next(err); }
}

// GET /api/petty-cash/ledger?site=X — combined, chronological
// site role: assigned sites only; HO: any site (defaults to all if no site query param)
export async function getLedger(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { site: userSite } = req.user!;
    const userSites = req.user!.sites && req.user!.sites.length > 0
      ? req.user!.sites
      : (userSite ? [userSite] : []);
    const qSite = (req.query.site as string | undefined) ?? null;
    const scoped = isSiteScoped(req.user);

    if (scoped && qSite && !userHasSite(req.user, qSite)) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only view sites you are assigned to' });
      return;
    }

    // Build matching SQL fragments for both halves of the UNION (one uses
    // bare `site`, the other uses alias `e.site`).
    let filterDisb = '';
    let filterExp = '';
    let params: unknown[] = [];
    if (qSite) {
      filterDisb = 'AND site = $1';
      filterExp  = 'AND e.site = $1';
      params = [normaliseSiteName(qSite)];
    } else if (scoped) {
      filterDisb = 'AND site = ANY($1)';
      filterExp  = 'AND e.site = ANY($1)';
      params = [userSites];
    }

    const rows = await query<{
      id: string; site: string; event_type: 'in' | 'out'; amount: string;
      event_date: string; description: string; ref_id: string | null;
      by_name: string | null; created_at: string;
    }>(
      `SELECT
           id, site, 'in'::text AS event_type, amount::text,
           given_on AS event_date,
           COALESCE('Received via ' || mode || COALESCE(' — ' || reference, ''), 'Received') AS description,
           NULL::uuid AS ref_id,
           (SELECT u.name FROM users u WHERE u.id = given_by) AS by_name,
           created_at
         FROM petty_cash_disbursements
         WHERE deleted_at IS NULL ${filterDisb}
         UNION ALL
         SELECT
           e.id, e.site, 'out'::text AS event_type, e.amount::text,
           e.spent_on AS event_date,
           e.purpose AS description,
           e.invoice_id AS ref_id,
           (SELECT u.name FROM users u WHERE u.id = e.recorded_by) AS by_name,
           e.created_at
         FROM petty_cash_expenses e
         WHERE e.deleted_at IS NULL ${filterExp}
         ORDER BY event_date DESC, created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}
