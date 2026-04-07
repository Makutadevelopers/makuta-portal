// tally.routes.ts
// Tally integration — one-way sync (export only)
// GET /api/tally/vouchers?from=YYYY-MM-DD&to=YYYY-MM-DD&format=xml|json

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getTallyVouchers } from '../controllers/tally.controller';

const router = Router();

router.use(authenticate);
router.use(requireRole(['ho']));

router.get('/vouchers', getTallyVouchers);

export default router;
