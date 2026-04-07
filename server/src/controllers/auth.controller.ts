// auth.controller.ts
// POST /api/auth/login — validate credentials, return signed JWT.

import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { queryOne } from '../db/query';
import { env } from '../config/env';

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
  title: string | null;
  is_active: boolean;
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await queryOne<UserRow>(
      'SELECT id, name, email, password_hash, role, site, title, is_active FROM users WHERE email = $1',
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

    const payload = {
      id: user.id,
      name: user.name,
      role: user.role as 'ho' | 'site' | 'mgmt',
      site: user.site,
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
