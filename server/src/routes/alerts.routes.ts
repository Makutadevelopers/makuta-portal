// alerts.routes.ts
// GET  /api/alerts        — ho only
// GET  /api/alerts/count  — ho only (badge count)
// POST /api/alerts/:id/resolve — ho only

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getAlerts, resolveAlert, getAlertCount } from '../controllers/alerts.controller';

const router = Router();

router.use(authenticate);
// HO sees its operational alerts (duplicate_invoice, vendor_dedup); MD sees
// password reset requests. Filtering happens in the controller based on role.
router.use(requireRole(['ho', 'mgmt']));

router.get('/count', getAlertCount);
router.get('/', getAlerts);
router.post('/:id/resolve', resolveAlert);

export default router;
