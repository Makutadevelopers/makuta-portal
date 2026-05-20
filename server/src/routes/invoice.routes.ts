// invoice.routes.ts
// All routes require authentication.
// POST/PATCH: ho + site. Push: ho only. GET: all roles (filtered server-side).

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import {
  getInvoices,
  getInvoiceById,
  createInvoice,
  createInvoiceBatch,
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
  recomputeAllStatuses,
} from '../controllers/invoice.controller';

const router = Router();

router.use(authenticate);

router.get('/', getInvoices);
router.get('/bin', requireRole(['ho', 'mgmt']), getBinInvoices);
// Must stay AFTER the literal GET routes above so '/bin' isn't captured by ':id'.
router.get('/:id', getInvoiceById);
router.post('/bin/purge', requireRole(['mgmt']), purgeOldBinInvoices);
router.post('/bin/:id/restore', requireRole(['ho']), restoreInvoice);
router.delete('/bin/:id', requireRole(['mgmt']), permanentDeleteInvoice);
router.post('/', requireRole(['ho', 'site']), createInvoice);
router.post('/batch', requireRole(['ho']), createInvoiceBatch);
router.post('/bulk-finalize', requireRole(['ho']), bulkPushInvoices);
router.post('/bulk-delete', requireRole(['ho']), bulkDeleteInvoices);
router.post('/recompute-statuses', requireRole(['ho']), recomputeAllStatuses);
router.patch('/:id', requireRole(['ho', 'site']), updateInvoice);
router.post('/:id/push', requireRole(['ho']), pushInvoice);
router.post('/:id/undo-push', requireRole(['ho']), undoPushInvoice);
router.post('/:id/dispute', requireRole(['ho', 'site']), markDisputed);
router.delete('/:id/dispute', requireRole(['ho', 'site']), clearDispute);
router.delete('/:id', requireRole(['ho']), deleteInvoice);

export default router;
