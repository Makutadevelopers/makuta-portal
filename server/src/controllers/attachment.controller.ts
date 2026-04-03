// attachment.controller.ts
// POST /api/invoices/:id/attachments — upload file to S3, save metadata
// GET  /api/invoices/:id/attachments — list metadata + presigned URLs (15 min)

import { Request, Response, NextFunction } from 'express';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { query, queryOne } from '../db/query';
import { s3, S3_BUCKET } from '../config/s3';

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

    // Verify invoice exists
    const invoice = await queryOne<{ id: string }>(
      'SELECT id FROM invoices WHERE id = $1',
      [invoiceId]
    );

    if (!invoice) {
      res.status(404).json({ error: 'Not Found', message: 'Invoice not found' });
      return;
    }

    const s3Key = `invoices/${invoiceId}/${file.originalname}`;

    // Upload to S3
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );

    // Save metadata
    const attachment = await queryOne<AttachmentRow>(
      `INSERT INTO attachments (invoice_id, file_name, file_size, mime_type, s3_key, s3_bucket, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [invoiceId, file.originalname, file.size, file.mimetype, s3Key, S3_BUCKET, req.user!.id]
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

    // Generate presigned URLs (15 min expiry)
    const withUrls = await Promise.all(
      attachments.map(async (att) => {
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: att.s3_bucket, Key: att.s3_key }),
          { expiresIn: 900 }
        );
        return { ...att, url };
      })
    );

    res.json(withUrls);
  } catch (err) {
    next(err);
  }
}
