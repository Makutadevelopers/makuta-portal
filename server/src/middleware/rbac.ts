// rbac.ts
// Role-Based Access Control middleware factory.
// Usage: router.get('/vendors', authenticate, requireRole(['ho']), handler)
//
// IMPORTANT: This only checks the role. For site-scoped data,
// controllers MUST also filter by req.user.sites in their queries
// (a user may own multiple sites — use site = ANY($1::text[])).

import { Request, Response, NextFunction } from 'express';

type Role = 'ho' | 'site' | 'mgmt';

export function requireRole(allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    if (!allowed.includes(user.role as Role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Role '${user.role}' does not have access to this resource`,
      });
      return;
    }

    next();
  };
}
