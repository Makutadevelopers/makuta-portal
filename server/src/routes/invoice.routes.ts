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
  bulkDeleteInvoices,
  undoPushInvoice,
  deleteInvoice,
  getBinInvoices,
  restoreInvoice,
  permanentDeleteInvoice,
  purgeOldBinInvoices,
  markDisputed,
  clearDispute,
} from '../controllers/invoice.controller';

const router = Router();

router.use(authenticate);

router.get('/', getInvoices);
router.get('/bin', requireRole(['ho', 'mgmt']), getBinInvoices);
router.post('/bin/purge', requireRole(['mgmt']), purgeOldBinInvoices);
router.post('/bin/:id/restore', requireRole(['ho']), restoreInvoice);
router.delete('/bin/:id', requireRole(['mgmt']), permanentDeleteInvoice);
router.post('/', requireRole(['ho', 'site']), createInvoice);
router.post('/bulk-finalize', requireRole(['ho']), bulkPushInvoices);
router.post('/bulk-delete', requireRole(['ho']), bulkDeleteInvoices);
router.patch('/:id', requireRole(['ho', 'site']), updateInvoice);
router.post('/:id/push', requireRole(['ho']), pushInvoice);
router.post('/:id/undo-push', requireRole(['ho']), undoPushInvoice);
router.post('/:id/dispute', requireRole(['ho', 'site']), markDisputed);
router.delete('/:id/dispute', requireRole(['ho', 'site']), clearDispute);
router.delete('/:id', requireRole(['ho']), deleteInvoice);

export default router;
