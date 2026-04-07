// errorHandler.ts
// Global error handler — must be registered last with app.use().
// Catches thrown errors and returns structured JSON.

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { env } from '../config/env';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  // Multer file upload errors
  if (err instanceof multer.MulterError) {
    const messages: Record<string, string> = {
      LIMIT_FILE_SIZE: 'File too large. Maximum size is 10 MB.',
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field.',
    };
    res.status(400).json({ error: 'Upload Error', message: messages[err.code] || err.message });
    return;
  }

  // Multer file filter rejection (thrown as plain Error)
  if (err.message?.startsWith('Invalid file type:')) {
    res.status(400).json({ error: 'Upload Error', message: err.message });
    return;
  }

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
  const status = (err as unknown as Record<string, unknown>).status;
  if (typeof status === 'number') {
    const message = env.NODE_ENV === 'production' && status >= 500
      ? 'An unexpected error occurred'
      : err.message;
    res.status(status).json({ error: err.name || 'Error', message });
    return;
  }

  // Unexpected errors
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: 'Something went wrong' });
}
