// upload.ts
// Multer middleware for file uploads.
// Validates: PDF, JPG, PNG, WEBP, HEIC, CSV, XLS, XLSX — max 10 MB per file, 20 files per request.
// Stores files in memory buffer for S3 upload in controller.

import multer from 'multer';
import { Request } from 'express';

const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  // M5: iPhone photos
  'image/heic',
  'image/heif',
  // CSV / Excel (for bulk import)
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB per file
// M6: cap the number of files per request. Invoice attachment uploads rarely exceed 5-10.
const MAX_FILES = 20;

const storage = multer.memoryStorage();

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void {
  // Normalize to lower-case so case-variant mimes from different browsers are accepted
  const mime = (file.mimetype || '').toLowerCase();
  if (ALLOWED_MIMES.includes(mime)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: PDF, JPG, PNG, WEBP, HEIC, CSV, XLS, XLSX`));
  }
}

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_SIZE,
    files: MAX_FILES,
  },
});
