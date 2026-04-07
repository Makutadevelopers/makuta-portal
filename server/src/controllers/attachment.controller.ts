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
const isLocalDev = env.AWS_ACCESS_KEY_ID === 'local_dev_key';

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
    const { id: invoiceId } = req.params;
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

    const s3Key = `invoices/${invoiceId}/${file.originalname}`;

    if (isLocalDev) {
      // Save to local disk
      const dir = path.join(UPLOADS_DIR, 'invoices', invoiceId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file.originalname), file.buffer);
    } else {
      // Upload to S3
      await s3.send(
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
    const { id: invoiceId } = req.params;

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
            s3,
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

export async function downloadAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: invoiceId, attachmentId } = req.params;

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

    res.setHeader('Content-Type', att.mime_type ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${att.file_name}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
}
