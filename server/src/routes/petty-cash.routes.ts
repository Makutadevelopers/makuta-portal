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
  updateDisbursement,
  deleteDisbursement,
  createExpense,
  listExpenses,
  updateExpense,
  deleteExpense,
  getLedger,
} from '../controllers/petty-cash.controller';

const router = Router();

router.use(authenticate);

// Balances. Project managers get read-only, own-assigned-sites access (like
// site accountants) but never the write routes below.
router.get('/balances',       requireRole(['ho']),                            getBalances);
router.get('/balances/:site', requireRole(['ho','site','project_manager']),   getBalances);

// Disbursements (HO only creates/edits/deletes; ho/site/PM can list — all read-scoped)
router.get('/disbursements',      requireRole(['ho','site','project_manager']), listDisbursements);
router.post('/disbursements',     requireRole(['ho']),                         createDisbursement);
router.patch('/disbursements/:id', requireRole(['ho']),                        updateDisbursement);
router.delete('/disbursements/:id', requireRole(['ho']),                       deleteDisbursement);

// Expenses (HO any site, site own site only — edit/delete scoped to own site
// in the controller; PM read-only)
router.get('/expenses',       requireRole(['ho','site','project_manager']),   listExpenses);
router.post('/expenses',      requireRole(['ho','site']),                     createExpense);
router.patch('/expenses/:id', requireRole(['ho','site']),                     updateExpense);
router.delete('/expenses/:id', requireRole(['ho','site']),                    deleteExpense);

// Ledger (combined in + out, chronological)
router.get('/ledger',         requireRole(['ho','site','project_manager']),   getLedger);

export default router;
