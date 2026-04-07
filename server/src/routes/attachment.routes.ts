// attachment.routes.ts
// Mounted under /api/invoices/:id/attachments
// POST                    — ho + site (upload)
// GET                     — all authenticated roles
// GET  /:attachmentId/download — serve local file (dev)

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { upload } from '../middleware/upload';
import { uploadAttachment, getAttachments, downloadAttachment } from '../controllers/attachment.controller';

const router = Router({ mergeParams: true });

// Download is before auth — uses UUID-based unguessable URLs
router.get('/:attachmentId/download', downloadAttachment);

router.use(authenticate);

router.post('/', requireRole(['ho', 'site']), upload.single('file'), uploadAttachment);
router.get('/', getAttachments);

export default router;
