// auth.ts
// JWT verification middleware.
// Reads Bearer token from Authorization header, verifies it,
// and attaches the decoded payload to req.user.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtPayload {
  id: string;
  name: string;
  role: 'ho' | 'site' | 'mgmt';
  site: string | null;
  title: string | null;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  // Allow ?token=... query param as fallback so file download links work when opened in a new tab
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;

  let token: string | null = null;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (queryToken) {
    token = queryToken;
  }

  if (!token) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing or malformed Authorization header' });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }
}
