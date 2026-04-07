// upload.ts
// Multer middleware for file uploads.
// Validates: PDF, JPG, PNG, WEBP — max 10MB per file.
// Stores files in memory buffer for S3 upload in controller.

import multer from 'multer';
import { Request } from 'express';

const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
];

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const storage = multer.memoryStorage();

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void {
  if (ALLOWED_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: PDF, JPG, PNG, WEBP, CSV, XLS, XLSX`));
  }
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE },
});
