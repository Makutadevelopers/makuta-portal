// petty-cash.routes.ts
// Mounted under /api/petty-cash in index.ts
//
// Visibility rules (per product decision):
//   ho   — all sites, full read + write
//   site — own site only, read + log expenses
//   mgmt — 403 everywhere
//
// Site-scope filtering is enforced inside the controllers using req.user.site.

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import {
  getBalances,
  createDisbursement,
  listDisbursements,
  createExpense,
  listExpenses,
  getLedger,
} from '../controllers/petty-cash.controller';

const router = Router();

router.use(authenticate);

// Balances
router.get('/balances',       requireRole(['ho']),         getBalances);
router.get('/balances/:site', requireRole(['ho','site']),  getBalances);

// Disbursements (HO only creates, both can list)
router.get('/disbursements',  requireRole(['ho','site']),  listDisbursements);
router.post('/disbursements', requireRole(['ho']),         createDisbursement);

// Expenses (HO any site, site own site only)
router.get('/expenses',       requireRole(['ho','site']),  listExpenses);
router.post('/expenses',      requireRole(['ho','site']),  createExpense);

// Ledger (combined in + out, chronological)
router.get('/ledger',         requireRole(['ho','site']),  getLedger);

export default router;
