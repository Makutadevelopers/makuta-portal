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

// Forgot-password rate limit — 5 requests per hour per IP. Defends against
// password-reset email spam and timing-based email enumeration probes.
// (We do NOT rate-limit /login itself: this is a small-team internal portal
// where everyone shares an office NAT, so per-IP login limits punish the
// whole org for one user's typo. bcrypt(12) already makes online brute
// force economically infeasible.)
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
