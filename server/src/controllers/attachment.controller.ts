// attachment.controller.ts
// POST /api/invoices/:id/attachments — upload file (S3 in prod, local disk in dev)
// GET  /api/invoices/:id/attachments — list metadata + download URLs
// GET  /api/invoices/:id/attachments/:attachmentId/download — serve local file (dev only)

import { Request, Response, NextFunction } from 'express';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { query, queryOne } from '../db/query';
import { s3, S3_BUCKET } from '../config/s3';
import { env } from '../config/env';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
const isLocalDev = !s3;

// Ensure uploads directory exists in dev
if (isLocalDev && !fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

interface AttachmentRow {
  id: string;
  invoice_id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  s3_key: string;
  s3_bucket: string;
  uploaded_by: string | null;
  uploaded_at: string;
}

export async function uploadAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoiceId = req.params.id as string;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'Bad Request', message: 'No file uploaded' });
      return;
    }

    const invoice = await queryOne<{ id: string }>(
      'SELECT id FROM invoices WHERE id = $1',
      [invoiceId]
    );

    if (!invoice) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }

    // Sanitize filename to prevent path traversal
    const sanitizedName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
    const s3Key = `invoices/${invoiceId}/${Date.now()}_${sanitizedName}`;

    if (isLocalDev) {
      // Save to local disk at the exact s3_key path (so download can find it)
      const fullPath = path.join(UPLOADS_DIR, s3Key);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, file.buffer);
    } else {
      // Upload to S3
      await s3!.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: file.buffer,
          ContentType: file.mimetype,
        })
      );
    }

    const attachment = await queryOne<AttachmentRow>(
      `INSERT INTO attachments (invoice_id, file_name, file_size, mime_type, s3_key, s3_bucket, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [invoiceId, file.originalname, file.size, file.mimetype, s3Key, isLocalDev ? 'local' : S3_BUCKET, req.user!.id]
    );

    res.status(201).json(attachment);
  } catch (err) {
    next(err);
  }
}

export async function getAttachments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoiceId = req.params.id as string;

    const attachments = await query<AttachmentRow>(
      'SELECT * FROM attachments WHERE invoice_id = $1 ORDER BY uploaded_at',
      [invoiceId]
    );

    const withUrls = await Promise.all(
      attachments.map(async (att) => {
        let url: string;
        if (att.s3_bucket === 'local') {
          url = `/api/invoices/${invoiceId}/attachments/${att.id}/download`;
        } else {
          url = await getSignedUrl(
            s3!,
            new GetObjectCommand({ Bucket: att.s3_bucket, Key: att.s3_key }),
            { expiresIn: 900 }
          );
        }
        return { ...att, url };
      })
    );

    res.json(withUrls);
  } catch (err) {
    next(err);
  }
}

/**
 * Delete all disk files for an invoice (local dev only).
 * Call this BEFORE removing the invoice / attachment rows from the DB.
 * Silently ignores missing files so it's safe to call repeatedly.
 */
export async function deleteInvoiceFilesFromDisk(invoiceId: string): Promise<void> {
  if (!isLocalDev) return;
  const dir = path.join(UPLOADS_DIR, 'invoices', invoiceId);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`[attachments] failed to clean files for invoice ${invoiceId}:`, err);
  }
}

export async function deleteAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoiceId = req.params.id as string;
    const attachmentId = req.params.attachmentId as string;

    const att = await queryOne<AttachmentRow>(
      'SELECT * FROM attachments WHERE id = $1 AND invoice_id = $2',
      [attachmentId, invoiceId]
    );

    if (!att) {
      res.status(404).json({ error: 'Not Found', message: 'Attachment not found' });
      return;
    }

    // Remove from disk (local dev) — ignore errors if file already missing
    if (isLocalDev) {
      const filePath = path.join(UPLOADS_DIR, att.s3_key);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
    }

    await query('DELETE FROM attachments WHERE id = $1', [attachmentId]);
    res.json({ message: 'Attachment deleted' });
  } catch (err) {
    next(err);
  }
}

export async function downloadAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoiceId = req.params.id as string;
    const attachmentId = req.params.attachmentId as string;

    const att = await queryOne<AttachmentRow>(
      'SELECT * FROM attachments WHERE id = $1 AND invoice_id = $2',
      [attachmentId, invoiceId]
    );

    if (!att) {
      res.status(404).json({ error: 'Not Found', message: 'Attachment not found' });
      return;
    }

    const filePath = path.join(UPLOADS_DIR, att.s3_key);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Not Found', message: 'File not found on disk' });
      return;
    }

    // ?download=1 forces download, otherwise serve inline so PDFs/images preview in-browser
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', att.mime_type ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(att.file_name)}`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
}
