// vendor.routes.ts
// GET    /api/vendors      — all authenticated roles
// POST   /api/vendors      — ho + site (site accountants may add vendors)
// PATCH  /api/vendors/:id  — ho + site (site may only edit vendors they created)
// DELETE /api/vendors/:id  — ho + site (site may only delete vendors they created)

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getVendors, getVendor, createVendor, updateVendor, deleteVendor, getSimilar, getDuplicates, mergeVendors, getVendorDetailHandler } from '../controllers/vendor.controller';

const router = Router();

router.use(authenticate);

router.get('/similar', getSimilar);
router.get('/duplicates', requireRole(['ho']), getDuplicates);
router.get('/', getVendors);
router.get('/:id/detail', requireRole(['ho', 'mgmt']), getVendorDetailHandler);
router.get('/:id', getVendor);
router.post('/merge', requireRole(['ho']), mergeVendors);
router.post('/', requireRole(['ho', 'site']), createVendor);
router.patch('/:id', requireRole(['ho', 'site']), updateVendor);
router.delete('/:id', requireRole(['ho', 'site']), deleteVendor);

export default router;
