// attachment.routes.ts
// Mounted under /api/invoices/:id/attachments
// POST                    — ho + site (upload)
// GET                     — all authenticated roles
// GET  /:attachmentId/download — serve local file (dev)

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { upload } from '../middleware/upload';
import { uploadAttachment, getAttachments, downloadAttachment, deleteAttachment } from '../controllers/attachment.controller';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.post('/', requireRole(['ho', 'site']), upload.single('file'), uploadAttachment);
router.get('/', getAttachments);
router.get('/:attachmentId/download', downloadAttachment);
router.delete('/:attachmentId', requireRole(['ho', 'site']), deleteAttachment);

export default router;
