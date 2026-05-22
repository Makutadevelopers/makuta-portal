// payment.routes.ts
// Mounted under /api/invoices/:id/payments in index.ts
// POST    — ho + site (site limited to minor payments in controller)
// GET     — ho + mgmt only (site must never see payment data)
// PATCH /:pid — ho only (edit a saved payment's details + amount)
// POST /revert — ho + site (site: own, non-finalized invoices) — reverse all
//                payments on the invoice with a reason

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { createPayment, getPayments, updatePayment, revertInvoicePayments } from '../controllers/payment.controller';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.post('/', requireRole(['ho', 'site']), createPayment);
// Reverse all payments on the invoice → Not Paid, with a reason. Site scope and
// finalized-invoice guard are enforced inside the controller.
router.post('/revert', requireRole(['ho', 'site']), revertInvoicePayments);
router.get('/', requireRole(['ho', 'mgmt']), getPayments);
router.patch('/:pid', requireRole(['ho']), updatePayment);

export default router;
