// cashflow.routes.ts
// GET /api/cashflow — ho + mgmt only

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getCashflow } from '../controllers/cashflow.controller';

const router = Router();

router.use(authenticate);
router.get('/', requireRole(['ho', 'mgmt']), getCashflow);

export default router;
