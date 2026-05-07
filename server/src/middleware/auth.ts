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
  site: string | null;       // primary/first site — kept for backwards compat
  sites: string[];           // all sites the user can access (source of truth)
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
    // Older tokens may have been issued before `sites` existed; coerce to a
    // safe shape so downstream code can rely on `sites` being an array.
    if (!Array.isArray(decoded.sites)) {
      decoded.sites = decoded.site ? [decoded.site] : [];
    }
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }
}

/**
 * Returns true if the user is allowed to operate on data belonging to `site`.
 * - HO and MD: any site (cross-site visibility)
 * - Site accountants: only sites in their assigned array
 *
 * Use this in controllers instead of `req.user.site === invoiceSite` so that
 * users assigned to multiple sites work correctly.
 */
export function userHasSite(user: JwtPayload | undefined, site: string | null | undefined): boolean {
  if (!user || !site) return false;
  if (user.role === 'ho' || user.role === 'mgmt') return true;
  return Array.isArray(user.sites) && user.sites.includes(site);
}
