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
} from '../controllers/invoice.controller';

const router = Router();

router.use(authenticate);

router.get('/', getInvoices);
router.post('/', requireRole(['ho', 'site']), createInvoice);
router.patch('/:id', requireRole(['ho', 'site']), updateInvoice);
router.post('/:id/push', requireRole(['ho']), pushInvoice);

export default router;
