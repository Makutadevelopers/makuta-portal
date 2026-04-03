// vendor.routes.ts
// GET  /api/vendors      — all authenticated roles
// POST /api/vendors      — ho only
// PATCH /api/vendors/:id — ho only

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getVendors, createVendor, updateVendor } from '../controllers/vendor.controller';

const router = Router();

router.use(authenticate);

router.get('/', getVendors);
router.post('/', requireRole(['ho']), createVendor);
router.patch('/:id', requireRole(['ho']), updateVendor);

export default router;
