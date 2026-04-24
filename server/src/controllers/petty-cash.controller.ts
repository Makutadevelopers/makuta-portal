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
// GET /api/petty-cash/balances/:site  — HO or site (site restricted to own)
export async function getBalances(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, site: userSite } = req.user!;
    const siteParam = (req.params.site as string | undefined) ?? null;

    if (role === 'site') {
      if (siteParam && siteParam !== userSite) {
        res.status(403).json({ error: 'Forbidden', message: 'You can only view your own site balance' });
        return;
      }
      const row = await fetchSiteBalance(userSite!);
      res.json(row);
      return;
    }

    if (siteParam) {
      const row = await fetchSiteBalance(siteParam);
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

    const row = await queryOne<DisbursementRow>(
      `INSERT INTO petty_cash_disbursements
         (site, amount, given_on, given_by, mode, reference, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [data.site, data.amount, data.given_on, userId, data.mode,
       data.reference ?? null, data.remarks ?? null]
    );

    logAudit({
      userId,
      action: `Petty cash given: ₹${data.amount.toLocaleString('en-IN')} to ${data.site}`,
      metadata: { kind: 'petty_cash_disbursement', site: data.site, amount: data.amount },
    }).catch(e => console.error('[audit] petty cash disbursement log failed:', e));

    res.status(201).json(row);
  } catch (err) { next(err); }
}

// GET /api/petty-cash/disbursements?site=X — HO (any site) | site (own only)
export async function listDisbursements(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, site: userSite } = req.user!;
    const qSite = (req.query.site as string | undefined) ?? null;
    const site = role === 'site' ? userSite! : qSite;

    if (role === 'site' && qSite && qSite !== userSite) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only view your own site' });
      return;
    }

    const where = site ? 'WHERE d.site = $1 AND d.deleted_at IS NULL'
                       : 'WHERE d.deleted_at IS NULL';
    const params = site ? [site] : [];
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

// ── expenses ────────────────────────────────────────────────────────────
// POST /api/petty-cash/expenses — HO (any site) | site (own only)
export async function createExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, site: userSite, id: userId } = req.user!;
    const data = expenseSchema.parse(req.body);

    if (role === 'site' && data.site !== userSite) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only log expenses for your own site' });
      return;
    }

    const result = await withTransaction(async (tx) => {
      // Lock the site's petty cash rows so two concurrent expenses can't both
      // pass the balance check and overdraw. Locking the aggregate means
      // serialising any writes on this site's float.
      await tx.query(
        `SELECT 1 FROM petty_cash_disbursements WHERE site = $1 AND deleted_at IS NULL FOR UPDATE`,
        [data.site]
      );
      await tx.query(
        `SELECT 1 FROM petty_cash_expenses WHERE site = $1 AND deleted_at IS NULL FOR UPDATE`,
        [data.site]
      );

      const balRow = await tx.queryOne<{ balance: string }>(
        `SELECT (
            COALESCE((SELECT SUM(amount) FROM petty_cash_disbursements
                      WHERE site = $1 AND deleted_at IS NULL), 0)
          - COALESCE((SELECT SUM(amount) FROM petty_cash_expenses
                      WHERE site = $1 AND deleted_at IS NULL), 0)
         )::TEXT AS balance`,
        [data.site]
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
        if (inv.site !== data.site) {
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
             COALESCE((SELECT SUM(amount)          FROM payments                 WHERE invoice_id = $1), 0)::TEXT AS paid,
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
        [data.site, data.amount, data.spent_on, data.purpose,
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
      action: `Petty cash spent: ₹${data.amount.toLocaleString('en-IN')} at ${data.site} — ${data.purpose}`,
      invoiceId: data.invoice_id ?? undefined,
      metadata: { kind: 'petty_cash_expense', site: data.site, amount: data.amount, purpose: data.purpose, invoice_id: data.invoice_id ?? null },
    }).catch(e => console.error('[audit] petty cash expense log failed:', e));

    res.status(201).json(result.body);
  } catch (err) { next(err); }
}

// GET /api/petty-cash/expenses?site=X — HO (any site) | site (own only)
export async function listExpenses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, site: userSite } = req.user!;
    const qSite = (req.query.site as string | undefined) ?? null;
    const site = role === 'site' ? userSite! : qSite;

    if (role === 'site' && qSite && qSite !== userSite) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only view your own site' });
      return;
    }

    const where = site ? 'WHERE e.site = $1 AND e.deleted_at IS NULL'
                       : 'WHERE e.deleted_at IS NULL';
    const params = site ? [site] : [];
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

// GET /api/petty-cash/ledger?site=X — combined, chronological
// site role: own site only; HO: any site (defaults to all if no site query param)
export async function getLedger(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, site: userSite } = req.user!;
    const qSite = (req.query.site as string | undefined) ?? null;

    if (role === 'site' && qSite && qSite !== userSite) {
      res.status(403).json({ error: 'Forbidden', message: 'You can only view your own site' });
      return;
    }

    const site = role === 'site' ? userSite! : qSite;
    const filter = site ? 'AND site = $1' : '';
    const params = site ? [site] : [];

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
         WHERE deleted_at IS NULL ${filter}
         UNION ALL
         SELECT
           e.id, e.site, 'out'::text AS event_type, e.amount::text,
           e.spent_on AS event_date,
           e.purpose AS description,
           e.invoice_id AS ref_id,
           (SELECT u.name FROM users u WHERE u.id = e.recorded_by) AS by_name,
           e.created_at
         FROM petty_cash_expenses e
         WHERE e.deleted_at IS NULL ${filter ? 'AND e.site = $1' : ''}
         ORDER BY event_date DESC, created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}
