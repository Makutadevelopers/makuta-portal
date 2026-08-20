// tds.routes.ts
// Mounted under /api/tds in index.ts
// GET — ho + mgmt only. TDS is statutory tax data for the whole business;
//       site accountants must never see it (same rule as payment data).

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getTds } from '../controllers/tds.controller';

const router = Router();

router.use(authenticate);

router.get('/', requireRole(['ho', 'mgmt']), getTds);

export default router;
