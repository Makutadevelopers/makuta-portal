// invoice.routes.ts
// All routes require authentication.
// POST/PATCH: ho + site. Push: ho only. GET: all roles (filtered server-side).

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import {
  getInvoices,
  createInvoice,
  updateInvoice,
  pushInvoice,
  bulkPushInvoices,
  undoPushInvoice,
  deleteInvoice,
  getBinInvoices,
  restoreInvoice,
  permanentDeleteInvoice,
  purgeOldBinInvoices,
} from '../controllers/invoice.controller';

const router = Router();

router.use(authenticate);

router.get('/', getInvoices);
router.get('/bin', requireRole(['ho']), getBinInvoices);
router.post('/bin/purge', requireRole(['ho']), purgeOldBinInvoices);
router.post('/bin/:id/restore', requireRole(['ho']), restoreInvoice);
router.delete('/bin/:id', requireRole(['ho']), permanentDeleteInvoice);
router.post('/', requireRole(['ho', 'site']), createInvoice);
router.post('/bulk-finalize', requireRole(['ho']), bulkPushInvoices);
router.patch('/:id', requireRole(['ho', 'site']), updateInvoice);
router.post('/:id/push', requireRole(['ho']), pushInvoice);
router.post('/:id/undo-push', requireRole(['ho']), undoPushInvoice);
router.delete('/:id', requireRole(['ho']), deleteInvoice);

export default router;
