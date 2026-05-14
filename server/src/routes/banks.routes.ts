// banks.routes.ts
// GET    /api/banks  — list. Open to every authenticated role because
//                      payment forms (HO + site) need the dropdown.
// POST   /api/banks  — HO only (Bank Master CRUD lives in HO).
// PATCH  /api/banks/:id — HO only (rename / toggle active).

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { listBanks, createBank, updateBank } from '../controllers/banks.controller';

const router = Router();

router.use(authenticate);
router.get('/', listBanks);
router.post('/', requireRole(['ho']), createBank);
router.patch('/:id', requireRole(['ho']), updateBank);

export default router;
