// audit.routes.ts
// GET /api/audit — ho + mgmt (both read-only — controller is GET-only)

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getAuditLogs, getInvoiceHistory } from '../controllers/audit.controller';

const router = Router();

router.use(authenticate);
router.get('/', requireRole(['ho', 'mgmt']), getAuditLogs);
router.get('/invoice/:invoiceId', requireRole(['ho', 'mgmt']), getInvoiceHistory);

export default router;
