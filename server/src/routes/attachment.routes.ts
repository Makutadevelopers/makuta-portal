// attachment.routes.ts
// Mounted under /api/invoices/:id/attachments
// POST — ho + site (upload)
// GET  — all authenticated roles

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { upload } from '../middleware/upload';
import { uploadAttachment, getAttachments } from '../controllers/attachment.controller';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.post('/', requireRole(['ho', 'site']), upload.single('file'), uploadAttachment);
router.get('/', getAttachments);

export default router;
