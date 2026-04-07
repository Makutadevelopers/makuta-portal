// auth.routes.ts
// POST /api/auth/login — no authentication required

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login } from '../controllers/auth.controller';

const router = Router();

// Strict rate limit on login — 5 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests', message: 'Too many login attempts. Please try again in 15 minutes.' },
});

// loginLimiter disabled during development — re-enable for production
router.post('/login', login);

export default router;
