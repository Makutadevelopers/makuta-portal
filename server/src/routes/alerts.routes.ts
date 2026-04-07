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
router.use(requireRole(['ho']));

router.get('/count', getAlertCount);
router.get('/', getAlerts);
router.post('/:id/resolve', resolveAlert);

export default router;
