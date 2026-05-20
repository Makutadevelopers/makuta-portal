// reconciliation.routes.ts
// Mounted at /api/reconciliation in index.ts.
// POST  /bulk-pay      — HO only (single cheque / transaction spanning many invoices)
// GET   /              — HO + MD (read-only reconciliation view)
// PATCH /:id/verify    — HO + MD (tick a transaction as verified vs bank statement)

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { bulkPay, listReconciliation, verifyReconciliation } from '../controllers/reconciliation.controller';

const router = Router();

router.use(authenticate);

router.post('/bulk-pay', requireRole(['ho']), bulkPay);
router.get('/', requireRole(['ho', 'mgmt']), listReconciliation);
router.patch('/:id/verify', requireRole(['ho', 'mgmt']), verifyReconciliation);

export default router;
