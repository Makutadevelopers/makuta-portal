// sites.routes.ts
// GET   /api/sites      — list. Open to every authenticated role because the
//                         invoice / credit-note / petty-cash forms all need
//                         the project dropdown.
// POST  /api/sites      — HO + MD. Opening a project is an executive call, so
//                         Management gets Project Master too; this is a
//                         deliberate exception to "mgmt is read-only", which
//                         still holds for invoices and payments.
// PATCH /api/sites/:id  — HO + MD (rename / archive).

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { list, create, update } from '../controllers/sites.controller';

const router = Router();

router.use(authenticate);
router.get('/', list);
router.post('/', requireRole(['ho', 'mgmt']), create);
router.patch('/:id', requireRole(['ho', 'mgmt']), update);

export default router;
