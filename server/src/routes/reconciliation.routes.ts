// reconciliation.routes.ts
// Mounted at /api/reconciliation in index.ts.
// POST /bulk-pay — HO only (single cheque / transaction spanning many invoices)
// GET  /         — HO + MD (read-only reconciliation view)

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { bulkPay, listReconciliation } from '../controllers/reconciliation.controller';

const router = Router();

router.use(authenticate);

router.post('/bulk-pay', requireRole(['ho']), bulkPay);
router.get('/', requireRole(['ho', 'mgmt']), listReconciliation);

export default router;
