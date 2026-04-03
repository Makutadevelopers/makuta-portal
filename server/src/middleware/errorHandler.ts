// errorHandler.ts
// Global error handler — must be registered last with app.use().
// Catches thrown errors and returns structured JSON.

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  // Zod validation errors
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    res.status(400).json({ error: 'Validation Error', issues });
    return;
  }

  // Known operational errors with a status code
  const status = (err as Record<string, unknown>).status;
  if (typeof status === 'number') {
    res.status(status).json({ error: err.name || 'Error', message: err.message });
    return;
  }

  // Unexpected errors
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: 'Something went wrong' });
}
