// auth.routes.ts
// Login + self-service password flows.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth';
import {
  login,
  forgotPassword,
  resetPassword,
  changePassword,
} from '../controllers/auth.controller';

const router = Router();

// Strict rate limit on login — 5 attempts per 15 minutes per IP.
// Disabled during development; re-enable for production hardening.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests', message: 'Too many login attempts. Please try again in 15 minutes.' },
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

router.post('/login', login);
router.post('/forgot-password', forgotLimiter, forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/change-password', authenticate, changePassword);

export default router;
