// auth.routes.ts
// Login + self-service password flows.

import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { authenticate } from '../middleware/auth';
import {
  login,
  forgotPassword,
  resetPassword,
  changePassword,
} from '../controllers/auth.controller';

const router = Router();

/**
 * Key on IP **and** the submitted email rather than IP alone.
 *
 * A plain per-IP limit is unusable here: the whole office shares one NAT
 * address, so one person fat-fingering their password would throttle everyone.
 * Combining it with the email means a user's own typos only ever affect their
 * own account, while an attacker grinding a single login still gets stopped
 * after `max` tries.
 *
 * ipKeyGenerator normalises IPv6 addresses to their /64 prefix — without it a
 * client with a large IPv6 allocation gets a fresh bucket per request.
 */
function ipAndEmailKey(req: { ip?: string; body?: unknown }): string {
  const body = (req.body ?? {}) as { email?: unknown };
  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
  return `${ipKeyGenerator(req.ip ?? '')}:${email}`;
}

// Login — 10 attempts per 15 minutes per (IP + email). Generous enough that a
// genuine user re-typing a password never notices, tight enough that the
// previous ceiling (the global 200/min/IP, i.e. ~288,000 tries a day) is gone.
// bcrypt(12) makes each guess expensive; this also caps the CPU an unauthorised
// caller can burn on this box.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: ipAndEmailKey,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed logins count toward the limit
  message: { error: 'Too Many Requests', message: 'Too many login attempts. Please try again in a few minutes.' },
});

// Forgot-password rate limit — 5 requests per hour per IP. Defends against
// password-reset email spam and timing-based email enumeration probes.
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests', message: 'Too many reset requests. Please try again later.' },
});

// OTP verification. The hard cap is the per-account counter in the controller
// (5 guesses per issued code, migration 054) — that one holds no matter how
// many IPs an attacker has. This limiter just stops a single source burning
// through codes quickly.
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: ipAndEmailKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests', message: 'Too many attempts. Please request a new code.' },
});

router.post('/login', loginLimiter, login);
router.post('/forgot-password', forgotLimiter, forgotPassword);
router.post('/reset-password', resetLimiter, resetPassword);
router.post('/change-password', authenticate, changePassword);

export default router;
