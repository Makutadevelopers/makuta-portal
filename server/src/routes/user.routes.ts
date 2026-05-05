// user.routes.ts
// Employee management routes — MD (mgmt) + HO can manage users.

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { listUsers, createUser, updateUser, resetPassword, sendTempPassword } from '../controllers/user.controller';

const router = Router();

router.get('/', authenticate, requireRole(['mgmt', 'ho']), listUsers);
router.post('/', authenticate, requireRole(['mgmt']), createUser);
router.put('/:id', authenticate, requireRole(['mgmt']), updateUser);
router.post('/:id/reset-password', authenticate, requireRole(['mgmt']), resetPassword);
router.post('/:id/send-temp-password', authenticate, requireRole(['mgmt']), sendTempPassword);

export default router;
