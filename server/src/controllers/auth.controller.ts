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
import { notifyTempPassword } from '../services/email.service';

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
  sites: string[] | null;
  title: string | null;
  is_active: boolean;
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await queryOne<UserRow>(
      'SELECT id, name, email, password_hash, role, site, sites, title, is_active FROM users WHERE email = $1',
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

    // Resolve the sites array, falling back to single `site` if the array is
    // empty (legacy users who were created before migration 018).
    const sites = (Array.isArray(user.sites) && user.sites.length > 0)
      ? user.sites
      : (user.site ? [user.site] : []);

    const payload = {
      id: user.id,
      name: user.name,
      role: user.role as 'ho' | 'site' | 'mgmt',
      site: user.site,
      sites,
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

// ── Forgot password (self-service flow) ────────────────────────────────────
//
// POST /api/auth/forgot-password { email }
//   * Generates an 8-char temporary password, hashes it into users, and emails
//     it directly to the requesting user. No admin in the loop.
//   * An audit-only alert is still recorded (auto-resolved) so the MD can see
//     who reset their password and intervene if the email failed to deliver.
//   * Rate-limited to one reset per 15 minutes per user to prevent an
//     attacker from repeatedly invalidating someone's password.
//   * Always returns 200 OK (no enumeration leak) regardless of whether the
//     email matched a real user, or whether we actually did the reset.

const forgotSchema = z.object({
  email: z.string().email('Valid email is required'),
});

export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = forgotSchema.parse(req.body);

    const user = await queryOne<{ id: string; name: string; email: string; is_active: boolean }>(
      'SELECT id, name, email, is_active FROM users WHERE email = $1',
      [email]
    );

    const genericResponse = { ok: true };

    if (!user || !user.is_active) {
      res.json(genericResponse);
      return;
    }

    // Rate-limit: if this user has already requested a reset in the last 15
    // minutes (resolved or not), don't churn their password again — just
    // return the generic OK. Uses the alerts table so we don't need a
    // dedicated migration.
    const recent = await queryOne<{ id: string }>(
      `SELECT id FROM alerts
        WHERE alert_type = 'password_reset_request'
          AND metadata->>'userId' = $1
          AND created_at > NOW() - INTERVAL '15 minutes'
        LIMIT 1`,
      [user.id]
    );
    if (recent) {
      console.log(`[auth] Forgot-password throttled for ${email} (recent request exists)`);
      res.json(genericResponse);
      return;
    }

    // Generate temp password, hash it, and replace the user's password.
    const tempPassword = generateOtp(8);
    const hash = await bcrypt.hash(tempPassword, 12);
    await query(
      `UPDATE users
          SET password_hash = $1,
              reset_token_hash = NULL,
              reset_token_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $2`,
      [hash, user.id]
    );

    // Best-effort email to the user. notifyTempPassword swallows SMTP errors
    // and returns false; the alert metadata records that so MD can follow up
    // out-of-band if delivery failed.
    const emailSent = await notifyTempPassword({
      name: user.name,
      email: user.email,
      tempPassword,
    });

    // Record an audit-only alert. It's auto-resolved because no admin action
    // is required — this is just so MD can see who's been resetting and
    // intervene if a delivery failed.
    await query(
      `INSERT INTO alerts (
         alert_type, title, message, metadata,
         resolved, resolved_at
       )
       VALUES (
         'password_reset_request', $1, $2, $3,
         TRUE, NOW()
       )`,
      [
        `Password auto-reset — ${user.name}`,
        emailSent
          ? `${user.name} (${email}) requested a password reset. Temp password emailed.`
          : `${user.name} (${email}) requested a password reset. Email delivery FAILED — please reach out via WhatsApp/phone.`,
        JSON.stringify({ userId: user.id, email, name: user.name, autoSent: true, emailSent }),
      ]
    );

    try {
      await logAudit({
        userId: user.id,
        action: 'Self-service password reset',
        metadata: { email, emailSent, method: 'forgot-password' },
      });
    } catch (auditErr) {
      console.error('[audit] forgotPassword audit log failed:', auditErr);
    }

    console.log(`[auth] Forgot-password processed for ${email} (emailSent=${emailSent})`);

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
