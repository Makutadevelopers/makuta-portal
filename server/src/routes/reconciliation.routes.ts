// reconciliation.routes.ts
// Mounted at /api/reconciliation in index.ts.
// POST  /bulk-pay      — HO only (single cheque / transaction spanning many invoices)
// GET   /              — HO + MD (read-only reconciliation view)
// PATCH /:id/verify    — HO + MD (tick a transaction as verified vs bank statement)

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { bulkPay, listReconciliation, verifyReconciliation, updateReconciliationDate } from '../controllers/reconciliation.controller';

const router = Router();

router.use(authenticate);

router.post('/bulk-pay', requireRole(['ho']), bulkPay);
router.get('/', requireRole(['ho', 'mgmt']), listReconciliation);
router.patch('/:id/verify', requireRole(['ho', 'mgmt']), verifyReconciliation);
// HO only — changing a cheque date cascades to every linked payment's date.
router.patch('/:id/date', requireRole(['ho']), updateReconciliationDate);

export default router;
