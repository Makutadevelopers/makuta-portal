// user.controller.ts
// Employee management endpoints — MD (mgmt) can manage users.

import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { query, queryOne } from '../db/query';
import { logAudit } from '../services/audit.service';
import { generateOtp } from './auth.controller';
import { notifyTempPassword } from '../services/email.service';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  site: string | null;
  sites: string[] | null;
  title: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// GET /api/users — list all users
export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await query<UserRow>(
      `SELECT id, name, email, role, site, sites, title, is_active, created_at, updated_at
       FROM users ORDER BY role, name`
    );
    res.json(users);
  } catch (err) {
    next(err);
  }
}

// Accepts either `sites: string[]` (preferred) or legacy `site: string`.
// Normalises to a non-null array. Empty array is valid for HO/MD.
const sitesField = z.array(z.string().min(1).max(100)).max(20).optional();

// POST /api/users — create a new user
const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email is required'),
  password: z.string().min(4, 'Password must be at least 4 characters'),
  role: z.enum(['ho', 'site', 'mgmt', 'project_manager']),
  site: z.string().nullable().default(null),
  sites: sitesField,
  title: z.string().nullable().default(null),
});

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createSchema.parse(req.body);

    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [data.email]
    );
    if (existing) {
      res.status(409).json({ error: 'Conflict', message: 'Email already exists' });
      return;
    }

    const hash = await bcrypt.hash(data.password, 12);

    // Resolve `sites` array, falling back to legacy `site` string. `site` is
    // kept populated as the "primary" (= sites[0]) for backwards compatibility.
    const sitesArr = data.sites && data.sites.length > 0
      ? data.sites
      : (data.site ? [data.site] : []);
    const primarySite = sitesArr[0] ?? null;

    const user = await queryOne<UserRow>(
      `INSERT INTO users (name, email, password_hash, role, site, sites, title)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, role, site, sites, title, is_active, created_at, updated_at`,
      [data.name, data.email, hash, data.role, primarySite, sitesArr, data.title]
    );

    await logAudit({
      userId: req.user!.id,
      action: `Created user "${data.name}" (${data.role}${sitesArr.length > 0 ? `, ${sitesArr.join(', ')}` : ''})`,
      metadata: { targetUserId: user?.id, role: data.role, sites: sitesArr },
    });

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
}

// PUT /api/users/:id — update user details
const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(['ho', 'site', 'mgmt', 'project_manager']).optional(),
  site: z.string().nullable().optional(),
  sites: sitesField,
  title: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const data = updateSchema.parse(req.body);

    const existing = await queryOne<UserRow>(
      'SELECT id, name, email, role FROM users WHERE id = $1',
      [id]
    );
    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'User not found' });
      return;
    }

    // Check email uniqueness if changing email
    if (data.email && data.email !== existing.email) {
      const dup = await queryOne<{ id: string }>(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [data.email, id]
      );
      if (dup) {
        res.status(409).json({ error: 'Conflict', message: 'Email already in use' });
        return;
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // If caller sent `sites`, also keep `site` in lockstep as the primary
    // (sites[0]). If only `site` was sent, expand it into `sites` so both
    // columns stay consistent without making the caller think about it.
    const dataForSql: Record<string, unknown> = { ...data };
    if (data.sites !== undefined) {
      dataForSql.sites = data.sites;
      dataForSql.site = data.sites[0] ?? null;
    } else if (data.site !== undefined) {
      dataForSql.site = data.site;
      dataForSql.sites = data.site ? [data.site] : [];
    }

    for (const [key, val] of Object.entries(dataForSql)) {
      if (val !== undefined) {
        fields.push(`${key} = $${idx}`);
        values.push(val);
        idx++;
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'No fields to update' });
      return;
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const user = await queryOne<UserRow>(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}
       RETURNING id, name, email, role, site, sites, title, is_active, created_at, updated_at`,
      values
    );

    await logAudit({
      userId: req.user!.id,
      action: `Updated user "${existing.name}" (${Object.keys(data).join(', ')})`,
      metadata: { targetUserId: id, changes: data },
    });

    res.json(user);
  } catch (err) {
    next(err);
  }
}

// POST /api/users/:id/reset-password — reset a user's password
const resetSchema = z.object({
  newPassword: z.string().min(4, 'Password must be at least 4 characters'),
});

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { newPassword } = resetSchema.parse(req.body);

    const existing = await queryOne<{ id: string; name: string }>(
      'SELECT id, name FROM users WHERE id = $1',
      [id]
    );
    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'User not found' });
      return;
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await queryOne(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hash, id]
    );

    await logAudit({
      userId: req.user!.id,
      action: `Reset password for "${existing.name}"`,
      metadata: { targetUserId: id },
    });

    res.json({ message: `Password reset for ${existing.name}` });
  } catch (err) {
    next(err);
  }
}

// POST /api/users/:id/send-temp-password — generate an OTP, set it as the
// user's password, resolve the linked password_reset_request alert, and
// return the OTP so the MD can copy it (also emails it if SMTP is set).
export async function sendTempPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    const user = await queryOne<{ id: string; name: string; email: string; is_active: boolean }>(
      'SELECT id, name, email, is_active FROM users WHERE id = $1',
      [id]
    );
    if (!user) {
      res.status(404).json({ error: 'Not Found', message: 'User not found' });
      return;
    }
    if (!user.is_active) {
      res.status(400).json({ error: 'Bad Request', message: 'Cannot reset password for a deactivated account' });
      return;
    }

    const tempPassword = generateOtp(8);
    const hash = await bcrypt.hash(tempPassword, 12);

    await query(
      `UPDATE users
          SET password_hash = $1,
              reset_token_hash = NULL,
              reset_token_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $2`,
      [hash, id]
    );

    // Resolve any pending password_reset_request alert for this user so the
    // MD's bell badge clears.
    await query(
      `UPDATE alerts
          SET resolved = TRUE, resolved_by = $1, resolved_at = NOW()
        WHERE alert_type = 'password_reset_request'
          AND resolved = FALSE
          AND metadata->>'userId' = $2`,
      [req.user!.id, id]
    );

    // Best-effort email — silently no-ops when SMTP is unconfigured or when
    // the recipient is a placeholder address that Gmail rejects.
    const emailSent = await notifyTempPassword({
      name: user.name,
      email: user.email,
      tempPassword,
    });

    await logAudit({
      userId: req.user!.id,
      action: `Sent temp password to "${user.name}"`,
      metadata: { targetUserId: id, method: 'temp-password', emailSent },
    });

    res.json({
      tempPassword,
      userName: user.name,
      userEmail: user.email,
      emailSent,
      message: emailSent
        ? `Temporary password emailed to ${user.email}.`
        : `Temporary password generated for ${user.name}. Email could not be delivered — share it via WhatsApp or phone.`,
    });
  } catch (err) {
    next(err);
  }
}
