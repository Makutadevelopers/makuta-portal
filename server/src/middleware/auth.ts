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
  role: 'ho' | 'site' | 'mgmt' | 'project_manager';
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
    // Verify with explicit audience/issuer so a token signed for a different
    // app with the same secret can't be replayed against the portal. Tokens
    // issued before this change won't carry these claims; treat them as
    // legitimate during the rollout window — the 8h expiry naturally retires
    // unclaimed tokens. After 2026-05-22 the loose verify branch can go.
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET, {
        audience: 'makuta-portal',
        issuer: 'makuta-auth',
      }) as JwtPayload;
    } catch (strictErr) {
      decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    }
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

/**
 * Returns true if this user's data views must be FILTERED to their assigned
 * sites[]. Site accountants and project managers are both site-scoped; HO and
 * MD see every site.
 *
 * This answers "which ROWS?" and is deliberately separate from "which COLUMNS?"
 * — a site accountant gets a restricted projection (badge + balance, no aging)
 * while a project manager gets the full HO projection, but BOTH are row-scoped
 * to their sites. Use `role === 'site'` (not this helper) when the question is
 * about hiding amounts/aging.
 */
export function isSiteScoped(user: JwtPayload | undefined): boolean {
  return user?.role === 'site' || user?.role === 'project_manager';
}

/**
 * Returns the list of sites a user's data must be constrained to, or
 * `undefined` if the user has cross-site visibility (HO / MD — no restriction).
 *
 * For site-scoped roles (site accountant, project manager) this is their
 * assigned sites[] (falling back to the legacy single `site`). An EMPTY array
 * means "assigned to nothing" — callers must treat that as a hard constraint
 * that returns no rows, never as "unrestricted".
 */
export function scopedSites(user: JwtPayload | undefined): string[] | undefined {
  if (!user) return [];
  if (!isSiteScoped(user)) return undefined;
  return user.sites && user.sites.length > 0 ? user.sites : (user.site ? [user.site] : []);
}
