// user.controller.ts
// Employee management endpoints — MD (mgmt) can manage users.

import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { query, queryOne } from '../db/query';
import { logAudit } from '../services/audit.service';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  site: string | null;
  title: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// GET /api/users — list all users
export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await query<UserRow>(
      `SELECT id, name, email, role, site, title, is_active, created_at, updated_at
       FROM users ORDER BY role, name`
    );
    res.json(users);
  } catch (err) {
    next(err);
  }
}

// POST /api/users — create a new user
const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email is required'),
  password: z.string().min(4, 'Password must be at least 4 characters'),
  role: z.enum(['ho', 'site', 'mgmt']),
  site: z.string().nullable().default(null),
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

    const user = await queryOne<UserRow>(
      `INSERT INTO users (name, email, password_hash, role, site, title)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, role, site, title, is_active, created_at, updated_at`,
      [data.name, data.email, hash, data.role, data.site, data.title]
    );

    await logAudit({
      userId: req.user!.id,
      action: `Created user "${data.name}" (${data.role}${data.site ? `, ${data.site}` : ''})`,
      metadata: { targetUserId: user?.id, role: data.role, site: data.site },
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
  role: z.enum(['ho', 'site', 'mgmt']).optional(),
  site: z.string().nullable().optional(),
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

    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        const col = key === 'is_active' ? 'is_active' : key;
        fields.push(`${col} = $${idx}`);
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
       RETURNING id, name, email, role, site, title, is_active, created_at, updated_at`,
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
