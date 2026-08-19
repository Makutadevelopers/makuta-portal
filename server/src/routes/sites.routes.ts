// sites.routes.ts
// GET   /api/sites      — list. Open to every authenticated role because the
//                         invoice / credit-note / petty-cash forms all need
//                         the project dropdown.
// POST  /api/sites      — HO only (Project Master lives in HO).
// PATCH /api/sites/:id  — HO only (rename / archive).

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { list, create, update } from '../controllers/sites.controller';

const router = Router();

router.use(authenticate);
router.get('/', list);
router.post('/', requireRole(['ho']), create);
router.patch('/:id', requireRole(['ho']), update);

export default router;
