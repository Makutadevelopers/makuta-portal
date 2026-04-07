// export.routes.ts
// PDF export endpoints — ho + mgmt only

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { exportAging, exportInvoices, exportCashflow } from '../controllers/export.controller';

const router = Router();

router.use(authenticate);
router.use(requireRole(['ho', 'mgmt']));

router.get('/aging', exportAging);
router.get('/invoices', exportInvoices);
router.get('/cashflow', exportCashflow);

export default router;
