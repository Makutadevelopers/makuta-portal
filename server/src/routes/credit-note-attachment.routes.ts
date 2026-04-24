// credit-note-attachment.routes.ts
// Mounted under /api/credit-notes/:id/attachments

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { upload } from '../middleware/upload';
import {
  uploadCreditNoteAttachment,
  getCreditNoteAttachments,
  downloadCreditNoteAttachment,
  deleteCreditNoteAttachment,
} from '../controllers/credit-note-attachment.controller';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.post('/', requireRole(['ho', 'site']), upload.single('file'), uploadCreditNoteAttachment);
router.get('/', getCreditNoteAttachments);
router.get('/:attachmentId/download', downloadCreditNoteAttachment);
router.delete('/:attachmentId', requireRole(['ho', 'site']), deleteCreditNoteAttachment);

export default router;
