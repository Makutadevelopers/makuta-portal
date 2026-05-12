// categories.controller.ts
// GET  /api/categories      — list (any authenticated role)
// POST /api/categories      — create (any authenticated role; case-insensitive dedupe)

import { Request, Response, NextFunction } from 'express';
import { query, queryOne } from '../db/query';

interface CategoryRow {
  id: string;
  name: string;
  created_at: string;
  created_by: string | null;
}

export async function listCategories(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await query<CategoryRow>(
      'SELECT id, name, created_at, created_by FROM categories ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function createCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = typeof req.body?.name === 'string' ? req.body.name : '';
    const name = raw.trim();
    if (!name) {
      res.status(400).json({ error: 'Bad Request', message: 'Category name is required' });
      return;
    }
    if (name.length > 64) {
      res.status(400).json({ error: 'Bad Request', message: 'Category name must be 64 characters or fewer' });
      return;
    }

    // Case-insensitive duplicate check — return the existing row instead of
    // failing so the UI gets a consistent payload either way.
    const existing = await queryOne<CategoryRow>(
      'SELECT id, name, created_at, created_by FROM categories WHERE LOWER(name) = LOWER($1)',
      [name]
    );
    if (existing) {
      res.status(200).json({ ...existing, alreadyExisted: true });
      return;
    }

    const row = await queryOne<CategoryRow>(
      `INSERT INTO categories (name, created_by)
       VALUES ($1, $2)
       RETURNING id, name, created_at, created_by`,
      [name, req.user?.id ?? null]
    );
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}
