// reconciliation.routes.ts
// Mounted at /api/reconciliation in index.ts.
// POST  /bulk-pay      — HO only (single cheque / transaction spanning many invoices)
// GET   /              — HO + MD (read-only reconciliation view)
// PATCH /:id/verify    — HO + MD (tick a transaction as verified vs bank statement)

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import {
  bulkPay, listReconciliation, verifyReconciliation, updateReconciliationDate,
  updateBankTxnRef, revertBankTxn,
} from '../controllers/reconciliation.controller';

const router = Router();

router.use(authenticate);

router.post('/bulk-pay', requireRole(['ho']), bulkPay);
router.get('/', requireRole(['ho', 'mgmt']), listReconciliation);
router.patch('/:id/verify', requireRole(['ho', 'mgmt']), verifyReconciliation);
// HO only — changing a cheque date cascades to every linked payment's date.
router.patch('/:id/date', requireRole(['ho']), updateReconciliationDate);
// Correct a mistyped cheque / transaction reference (syncs linked payments).
router.patch('/:id/ref', requireRole(['ho']), updateBankTxnRef);
// Reverse an entire cheque: deletes every linked payment, recomputes each
// invoice's status, and removes the bank transaction row.
router.post('/:id/revert', requireRole(['ho']), revertBankTxn);

export default router;
