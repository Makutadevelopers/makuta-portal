// auth.controller.ts
// Login + password flows. Forgot-password is MD-mediated: user requests a
// reset, MD is alerted, MD generates a temp password from /employees.

import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { queryOne, query } from '../db/query';
import { env } from '../config/env';
import { logAudit } from '../services/audit.service';

const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  site: string | null;
  title: string | null;
  is_active: boolean;
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await queryOne<UserRow>(
      'SELECT id, name, email, password_hash, role, site, title, is_active FROM users WHERE email = $1',
      [email]
    );

    if (!user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({ error: 'Forbidden', message: 'Account is deactivated' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
      return;
    }

    const payload = {
      id: user.id,
      name: user.name,
      role: user.role as 'ho' | 'site' | 'mgmt',
      site: user.site,
      title: user.title,
    };

    const token = jwt.sign(payload, env.JWT_SECRET as string, { expiresIn: '8h' });

    res.json({
      token,
      user: payload,
    });
  } catch (err) {
    next(err);
  }
}

// ── Forgot password (MD-mediated flow) ─────────────────────────────────────
//
// POST /api/auth/forgot-password { email }
//   * The user does NOT receive a reset link by email.
//   * Instead, an alert is created so the MD sees the request on the bell
//     dropdown / Employees page; MD then clicks "Send Temp Password" which
//     generates an OTP, updates the user's password hash, and shows the OTP
//     to the MD (and emails it if SMTP is configured) so they can share it
//     with the user.
//   * Always returns 200 OK (no enumeration leak) regardless of whether the
//     email matched a real user.

const forgotSchema = z.object({
  email: z.string().email('Valid email is required'),
});

export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = forgotSchema.parse(req.body);

    const user = await queryOne<{ id: string; name: string; is_active: boolean }>(
      'SELECT id, name, is_active FROM users WHERE email = $1',
      [email]
    );

    const genericResponse = { ok: true };

    if (!user || !user.is_active) {
      res.json(genericResponse);
      return;
    }

    // Avoid spamming MD with duplicate alerts: dedupe on (alert_type, user.id)
    // when an unresolved request already exists.
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM alerts
        WHERE alert_type = 'password_reset_request'
          AND resolved = FALSE
          AND metadata->>'userId' = $1`,
      [user.id]
    );

    if (!existing) {
      await query(
        `INSERT INTO alerts (alert_type, title, message, metadata)
         VALUES ('password_reset_request', $1, $2, $3)`,
        [
          `Password reset requested — ${user.name}`,
          `${user.name} (${email}) requested a password reset. Send a temporary password from the Employees page.`,
          JSON.stringify({ userId: user.id, email, name: user.name }),
        ]
      );
    }

    console.log(`[auth] Password reset requested by ${email} (alerted MD)`);

    res.json(genericResponse);
  } catch (err) {
    next(err);
  }
}

// ── Legacy reset-via-token endpoint ─────────────────────────────────────────
// Kept for backwards-compat URLs that may have been emailed before the flow
// changed to MD-mediated. Returns a generic 410 so old links fail gracefully.

export async function resetPassword(_req: Request, res: Response, _next: NextFunction): Promise<void> {
  res.status(410).json({
    error: 'Gone',
    message: 'Password reset by emailed link has been replaced. Ask your MD to send you a temporary password.',
  });
}

// Helper: 8-character alphanumeric OTP, ambiguity-free (no 0/O/1/l/I).
const OTP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function generateOtp(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += OTP_ALPHABET[bytes[i] % OTP_ALPHABET.length];
  }
  return out;
}

// ── Change password (authenticated user) ────────────────────────────────────
//
// POST /api/auth/change-password { currentPassword, newPassword }

const changeSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(4, 'New password must be at least 4 characters'),
});

export async function changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    const { currentPassword, newPassword } = changeSchema.parse(req.body);

    const user = await queryOne<{ id: string; name: string; password_hash: string }>(
      'SELECT id, name, password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      res.status(404).json({ error: 'Not Found', message: 'Account not found' });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Unauthorized', message: 'Current password is incorrect' });
      return;
    }

    if (currentPassword === newPassword) {
      res.status(400).json({ error: 'Bad Request', message: 'New password must differ from current password' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await query(
      `UPDATE users
          SET password_hash = $1,
              reset_token_hash = NULL,
              reset_token_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $2`,
      [newHash, user.id]
    );

    await logAudit({
      userId: user.id,
      action: 'Password changed by user',
      metadata: { method: 'self-change' },
    });

    res.json({ ok: true, message: 'Password updated' });
  } catch (err) {
    next(err);
  }
}
