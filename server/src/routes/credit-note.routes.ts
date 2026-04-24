// credit-note.routes.ts
// Auth required on all routes. RBAC:
//   list / detail:              all roles (site-scoped for site)
//   create / update / allocate: ho + site
//   delete (soft):              ho
//   vendor balance / suggestions: ho + mgmt

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import {
  listCreditNotes,
  getCreditNote,
  createCreditNote,
  updateCreditNote,
  deleteCreditNote,
  addAllocation,
  removeAllocation,
  getVendorCreditBalance,
  getInvoiceCreditSuggestions,
} from '../controllers/credit-note.controller';

const router = Router();

router.use(authenticate);

router.get('/', listCreditNotes);
router.get('/vendor/:vendorId/balance', requireRole(['ho', 'mgmt']), getVendorCreditBalance);
router.get('/invoice/:invoiceId/suggestions', requireRole(['ho', 'site']), getInvoiceCreditSuggestions);
router.get('/:id', getCreditNote);

router.post('/', requireRole(['ho', 'site']), createCreditNote);
router.patch('/:id', requireRole(['ho', 'site']), updateCreditNote);
router.delete('/:id', requireRole(['ho']), deleteCreditNote);

router.post('/:id/allocations', requireRole(['ho', 'site']), addAllocation);
router.delete('/:id/allocations/:allocId', requireRole(['ho']), removeAllocation);

export default router;
