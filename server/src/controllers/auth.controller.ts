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
import { notifyResetOtp } from '../services/email.service';

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

// ── Forgot password — OTP flow ─────────────────────────────────────────────
//
// Two-step self-service reset:
//
//   POST /api/auth/forgot-password { email }
//     -> emails a 6-digit OTP to the user; stores its bcrypt hash + expiry
//        on the user row. The user's current password is NOT changed yet.
//
//   POST /api/auth/reset-password   { email, otp, newPassword }
//     -> verifies the OTP, sets the new password, clears the OTP.
//
// Properties:
//   * No enumeration leak: forgot-password always returns { ok: true }.
//   * 15-min throttle on send (alerts table) + 15-min OTP expiry.
//   * If SMTP delivery fails the OTP is still stored, and the MD-managed
//     "Send Temp Password" path in Employees still works as a fallback.

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

    // Per-user throttle: only block if THIS user has a live, unexpired OTP
    // that was issued in the last 60 seconds. This prevents OTP-email
    // spamming without piling up on stale `password_reset_request` alerts
    // from earlier flows. The IP-based rate-limit middleware (5/hr) already
    // covers the broader anti-abuse case.
    const existing = await queryOne<{ issued_recently: boolean }>(
      `SELECT (reset_token_expires_at > NOW() + INTERVAL '14 minutes') AS issued_recently
         FROM users
        WHERE id = $1
          AND reset_token_hash IS NOT NULL
          AND reset_token_expires_at > NOW()`,
      [user.id]
    );
    if (existing?.issued_recently) {
      console.log(`[auth] Forgot-password throttled for ${email} (OTP issued <60s ago)`);
      res.json(genericResponse);
      return;
    }

    // Generate a 6-digit OTP and store its bcrypt hash + a 15-min expiry on
    // the user row. The user's current password is NOT touched here — they
    // keep using it until they successfully verify the OTP via /reset-password.
    const otp = generateNumericOtp(6);
    const otpHash = await bcrypt.hash(otp, 12);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await query(
      `UPDATE users
          SET reset_token_hash = $1,
              reset_token_expires_at = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [otpHash, expiresAt, user.id]
    );

    // Best-effort email. If SMTP is down the OTP is still stored, but the user
    // can't proceed; we record emailSent=false so MD can intervene out-of-band.
    const emailSent = await notifyResetOtp({
      name: user.name,
      email: user.email,
      otp,
    });

    // Audit-only alert (auto-resolved) so MD has visibility into who reset.
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
        `Password reset code sent — ${user.name}`,
        emailSent
          ? `${user.name} (${email}) requested a password reset. 6-digit code emailed.`
          : `${user.name} (${email}) requested a password reset. Email delivery FAILED — reach out via WhatsApp/phone.`,
        JSON.stringify({ userId: user.id, email, name: user.name, autoSent: true, emailSent }),
      ]
    );

    try {
      await logAudit({
        userId: user.id,
        action: 'Password reset code requested',
        metadata: { email, emailSent, method: 'forgot-password-otp' },
      });
    } catch (auditErr) {
      console.error('[audit] forgotPassword audit log failed:', auditErr);
    }

    console.log(`[auth] Forgot-password OTP sent to ${email} (emailSent=${emailSent})`);

    res.json(genericResponse);
  } catch (err) {
    next(err);
  }
}

// ── Reset password — verify OTP and set new password ───────────────────────
//
// POST /api/auth/reset-password { email, otp, newPassword }
//   * Looks up the user, checks reset_token_hash + reset_token_expires_at,
//     then on a match writes the new password and clears the OTP.
//   * Returns a single generic error message for every failure mode (no user,
//     no OTP on file, wrong OTP, expired OTP) so an attacker can't probe
//     which email belongs to a real user.

const resetSchema = z.object({
  email: z.string().email('Valid email is required'),
  otp: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, otp, newPassword } = resetSchema.parse(req.body);
    const genericFail = { error: 'Bad Request', message: 'Invalid or expired code' };

    const user = await queryOne<{
      id: string;
      name: string;
      is_active: boolean;
      reset_token_hash: string | null;
      reset_token_expires_at: string | null;
    }>(
      `SELECT id, name, is_active, reset_token_hash, reset_token_expires_at
         FROM users WHERE email = $1`,
      [email]
    );

    if (
      !user ||
      !user.is_active ||
      !user.reset_token_hash ||
      !user.reset_token_expires_at ||
      new Date(user.reset_token_expires_at) < new Date()
    ) {
      res.status(400).json(genericFail);
      return;
    }

    const matches = await bcrypt.compare(otp, user.reset_token_hash);
    if (!matches) {
      res.status(400).json(genericFail);
      return;
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await query(
      `UPDATE users
          SET password_hash = $1,
              reset_token_hash = NULL,
              reset_token_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $2`,
      [hash, user.id]
    );

    try {
      await logAudit({
        userId: user.id,
        action: 'Self-service password reset (OTP verified)',
        metadata: { email, method: 'forgot-password-otp' },
      });
    } catch (auditErr) {
      console.error('[audit] resetPassword audit log failed:', auditErr);
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
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

// Helper: numeric-only OTP for email codes the user must type back. Uses
// crypto.randomInt so the distribution is uniform across [0, 10^length).
export function generateNumericOtp(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String(crypto.randomInt(0, 10));
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
