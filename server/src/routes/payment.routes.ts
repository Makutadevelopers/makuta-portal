// payment.routes.ts
// Mounted under /api/invoices/:id/payments in index.ts
// POST — ho + site (site limited to minor payments in controller)
// GET  — ho + mgmt only (site must never see payment data)

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { createPayment, getPayments } from '../controllers/payment.controller';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.post('/', requireRole(['ho', 'site']), createPayment);
router.get('/', requireRole(['ho', 'mgmt']), getPayments);

export default router;
