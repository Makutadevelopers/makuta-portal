// audit.routes.ts
// GET /api/audit — ho only

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getAuditLogs, getInvoiceHistory } from '../controllers/audit.controller';

const router = Router();

router.use(authenticate);
router.get('/', requireRole(['ho']), getAuditLogs);
router.get('/invoice/:invoiceId', getInvoiceHistory);

export default router;
