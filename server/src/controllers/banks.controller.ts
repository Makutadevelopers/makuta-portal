// banks.controller.ts
// GET    /api/banks                  — list active banks (any authenticated)
// GET    /api/banks?includeInactive=1 — list ALL banks (HO only — checked in route)
// POST   /api/banks                  — create (HO only); case-insensitive dedupe
// PATCH  /api/banks/:id              — rename and/or toggle active (HO only)
//
// Banks are never hard-deleted: historical payments store the bank name as a
// denormalized string, so wiping a row could orphan that label. Use the
// active flag to retire a bank from new dropdowns instead.

import { Request, Response, NextFunction } from 'express';
import { query, queryOne } from '../db/query';
import { logAudit } from '../services/audit.service';

interface BankRow {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export async function listBanks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
    // Only HO is allowed to see inactive rows — silently downgrade for other roles
    // so a stray query string from a shared link doesn't leak admin-only data.
    const showAll = includeInactive && req.user?.role === 'ho';
    const rows = await query<BankRow>(
      showAll
        ? 'SELECT id, name, active, created_at, updated_at, created_by FROM banks ORDER BY name'
        : 'SELECT id, name, active, created_at, updated_at, created_by FROM banks WHERE active = TRUE ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function createBank(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = typeof req.body?.name === 'string' ? req.body.name : '';
    const name = raw.trim();
    if (!name) {
      res.status(400).json({ error: 'Bad Request', message: 'Bank name is required' });
      return;
    }
    if (name.length > 64) {
      res.status(400).json({ error: 'Bad Request', message: 'Bank name must be 64 characters or fewer' });
      return;
    }

    // Case-insensitive duplicate check — return the existing row (and quietly
    // reactivate it if it was disabled) so callers get a consistent payload.
    const existing = await queryOne<BankRow>(
      'SELECT id, name, active, created_at, updated_at, created_by FROM banks WHERE LOWER(name) = LOWER($1)',
      [name]
    );
    if (existing) {
      if (!existing.active) {
        const reactivated = await queryOne<BankRow>(
          `UPDATE banks SET active = TRUE, updated_at = NOW() WHERE id = $1
           RETURNING id, name, active, created_at, updated_at, created_by`,
          [existing.id]
        );
        await logAudit({ userId: req.user!.id, action: `Reactivated bank "${existing.name}"` });
        res.status(200).json({ ...reactivated, alreadyExisted: true, reactivated: true });
        return;
      }
      res.status(200).json({ ...existing, alreadyExisted: true });
      return;
    }

    const row = await queryOne<BankRow>(
      `INSERT INTO banks (name, created_by)
       VALUES ($1, $2)
       RETURNING id, name, active, created_at, updated_at, created_by`,
      [name, req.user?.id ?? null]
    );
    await logAudit({ userId: req.user!.id, action: `Added bank "${name}"` });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

export async function updateBank(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const existing = await queryOne<BankRow>(
      'SELECT id, name, active FROM banks WHERE id = $1',
      [id]
    );
    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Bank not found' });
      return;
    }

    const nextName = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
    const nextActive = typeof req.body?.active === 'boolean' ? req.body.active : undefined;

    if (nextName === undefined && nextActive === undefined) {
      res.status(400).json({ error: 'Bad Request', message: 'Nothing to update — provide name or active' });
      return;
    }

    if (nextName !== undefined) {
      if (!nextName) {
        res.status(400).json({ error: 'Bad Request', message: 'Bank name cannot be blank' });
        return;
      }
      if (nextName.length > 64) {
        res.status(400).json({ error: 'Bad Request', message: 'Bank name must be 64 characters or fewer' });
        return;
      }
      const clash = await queryOne<BankRow>(
        'SELECT id FROM banks WHERE LOWER(name) = LOWER($1) AND id != $2',
        [nextName, id]
      );
      if (clash) {
        res.status(409).json({ error: 'Conflict', message: 'Another bank already uses that name' });
        return;
      }
    }

    const row = await queryOne<BankRow>(
      `UPDATE banks
         SET name   = COALESCE($1, name),
             active = COALESCE($2, active),
             updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, active, created_at, updated_at, created_by`,
      [nextName ?? null, nextActive ?? null, id]
    );

    const actions: string[] = [];
    if (nextName !== undefined && nextName !== existing.name) actions.push(`renamed "${existing.name}" → "${nextName}"`);
    if (nextActive !== undefined && nextActive !== existing.active) actions.push(nextActive ? `reactivated "${existing.name}"` : `deactivated "${existing.name}"`);
    if (actions.length > 0) {
      await logAudit({ userId: req.user!.id, action: `Bank: ${actions.join(', ')}` });
    }

    res.json(row);
  } catch (err) {
    next(err);
  }
}
