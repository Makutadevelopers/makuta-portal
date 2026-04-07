// vendor.routes.ts
// GET  /api/vendors      — all authenticated roles
// POST /api/vendors      — ho only
// PATCH /api/vendors/:id — ho only

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getVendors, getVendor, createVendor, updateVendor, deleteVendor, getSimilar, getDuplicates, mergeVendors } from '../controllers/vendor.controller';

const router = Router();

router.use(authenticate);

router.get('/similar', getSimilar);
router.get('/duplicates', requireRole(['ho']), getDuplicates);
router.get('/', getVendors);
router.get('/:id', getVendor);
router.post('/merge', requireRole(['ho']), mergeVendors);
router.post('/', requireRole(['ho']), createVendor);
router.patch('/:id', requireRole(['ho']), updateVendor);
router.delete('/:id', requireRole(['ho']), deleteVendor);

export default router;
