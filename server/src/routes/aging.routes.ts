// aging.routes.ts
// GET /api/aging — ho + mgmt only

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getAging } from '../controllers/aging.controller';

const router = Router();

router.use(authenticate);
router.get('/', requireRole(['ho', 'mgmt']), getAging);

export default router;
