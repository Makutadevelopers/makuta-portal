// analytics.routes.ts
// GET /api/analytics — ho + mgmt only

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getAnalytics } from '../controllers/analytics.controller';

const router = Router();

router.use(authenticate);
router.get('/', requireRole(['ho', 'mgmt']), getAnalytics);

export default router;
