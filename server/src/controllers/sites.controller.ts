// sites.controller.ts
// GET    /api/sites                   — list active projects (any authenticated)
// GET    /api/sites?includeInactive=1 — list all, with usage counts (HO + MD)
// POST   /api/sites                   — create (HO + MD); case-insensitive dedupe
// PATCH  /api/sites/:id               — rename and/or archive (HO + MD)
//
// Projects are never hard-deleted: invoices, credit notes, petty cash and user
// assignments all store the project NAME as text, so removing a row would
// orphan those labels. Archiving (active = false) retires it from new dropdowns
// while every historical record keeps reading correctly.

import { Request, Response, NextFunction } from 'express';
import {
  listSites, findSiteById, findSiteByName, siteUsage,
  createSite, setSiteActive, renameSite,
} from '../services/sites.service';

const MAX_NAME = 100; // matches the invoices.site zod max in invoice.controller

function validateName(raw: unknown): { name: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'Project name is required' };
  const name = raw.trim();
  if (!name) return { error: 'Project name is required' };
  if (name.length > MAX_NAME) return { error: `Project name must be ${MAX_NAME} characters or fewer` };
  return { name };
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const wantsAll = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
    // Only the roles that manage projects see archived ones — silently
    // downgrade for everyone else so a shared link can't leak them.
    const MANAGERS = ['ho', 'mgmt'];
    const includeInactive = wantsAll && MANAGERS.includes(req.user?.role ?? '');
    const rows = await listSites(includeInactive);

    if (!includeInactive) {
      res.set('Cache-Control', 'no-cache');
      res.json(rows);
      return;
    }

    // The management screen shows how much data hangs off each project, so
    // archiving or renaming is never done blind.
    const withUsage = await Promise.all(
      rows.map(async (r) => ({ ...r, usage: await siteUsage(r.name) }))
    );
    res.set('Cache-Control', 'no-cache');
    res.json(withUsage);
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = validateName(req.body?.name);
    if ('error' in parsed) {
      res.status(400).json({ error: 'Bad Request', message: parsed.error });
      return;
    }
    const { name } = parsed;

    // Case-insensitive match. A previously-archived project (including the
    // phantom sites migration 053 registered as inactive) is reactivated
    // rather than duplicated — that is almost always the intent, and a second
    // row differing only in case would fracture the dashboards.
    const existing = await findSiteByName(name);
    if (existing) {
      if (!existing.active) {
        const row = await setSiteActive(existing, true, req.user!.id);
        res.status(200).json({ ...row, alreadyExisted: true, reactivated: true });
        return;
      }
      res.status(200).json({ ...existing, alreadyExisted: true });
      return;
    }

    const row = await createSite(name, req.user!.id);
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const existing = await findSiteById(id);
    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Project not found' });
      return;
    }

    const hasName = req.body?.name !== undefined;
    const nextActive = typeof req.body?.active === 'boolean' ? req.body.active : undefined;
    if (!hasName && nextActive === undefined) {
      res.status(400).json({ error: 'Bad Request', message: 'Nothing to update — provide name or active' });
      return;
    }

    let result: unknown = existing;

    if (hasName) {
      const parsed = validateName(req.body.name);
      if ('error' in parsed) {
        res.status(400).json({ error: 'Bad Request', message: parsed.error });
        return;
      }
      const { name } = parsed;
      if (name !== existing.name) {
        const clash = await findSiteByName(name);
        if (clash && clash.id !== id) {
          res.status(409).json({ error: 'Conflict', message: 'Another project already uses that name' });
          return;
        }
        const renamed = await renameSite(existing, name, req.user!.id);
        result = { ...renamed.row, moved: renamed.moved };
      }
    }

    if (nextActive !== undefined && nextActive !== existing.active) {
      // Archiving a project with live invoices would drop it out of every
      // filter while its data stays on the dashboards — confusing rather than
      // dangerous, so warn by refusing and let HO confirm via the UI's
      // reassign flow instead of silently hiding work.
      if (!nextActive) {
        const usage = await siteUsage(existing.name);
        const open = usage.invoices + usage.creditNotes + usage.pettyCash;
        if (open > 0 && req.body?.confirmArchiveWithData !== true) {
          res.status(409).json({
            error: 'Conflict',
            message: `"${existing.name}" still has ${usage.invoices} invoice(s), ${usage.creditNotes} credit note(s) and ${usage.pettyCash} petty-cash record(s). Archiving keeps that data intact but removes the project from every dropdown.`,
            usage,
            requiresConfirmation: true,
          });
          return;
        }
      }
      const current = hasName ? await findSiteById(id) : existing;
      const row = await setSiteActive(current!, nextActive, req.user!.id);
      result = { ...row, ...(typeof result === 'object' && result && 'moved' in result ? { moved: (result as { moved: unknown }).moved } : {}) };
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}
