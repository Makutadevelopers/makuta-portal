// export.routes.ts
// CSV / XLSX / PDF export endpoints — ho + mgmt only

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { exportAging, exportInvoices, exportCashflow } from '../controllers/export.controller';
import {
  exportCreditNotes, exportVendors, exportVendorInvoices,
  exportAuditLogs, exportPettyCash, exportBankTransactions, exportBin, exportTds,
} from '../controllers/tableExports.controller';

const router = Router();

router.use(authenticate);

// Project managers may export ONLY the three expenditure reports whose
// controllers site-scope their output (exportAging / exportInvoices /
// exportCashflow all honour scopedSites()). Everything else stays HO+MD,
// because those exports are NOT site-filtered and would leak other sites'
// data. Guards are therefore per-route, not a blanket router.use.
const FINANCE = requireRole(['ho', 'mgmt', 'project_manager']);
const HO_MGMT = requireRole(['ho', 'mgmt']);

router.get('/aging', FINANCE, exportAging);
router.get('/invoices', FINANCE, exportInvoices);
// Backward-compatible CSV alias — equivalent to /invoices?format=csv
router.get('/invoices.csv', FINANCE, (req, res, next) => {
  req.query.format = 'csv';
  return exportInvoices(req, res, next);
});
router.get('/cashflow', FINANCE, exportCashflow);
router.get('/credit-notes', HO_MGMT, exportCreditNotes);
router.get('/vendors', HO_MGMT, exportVendors);
router.get('/vendor-invoices', HO_MGMT, exportVendorInvoices);
router.get('/audit', HO_MGMT, exportAuditLogs);
router.get('/petty-cash', HO_MGMT, exportPettyCash);
router.get('/bank-transactions', HO_MGMT, exportBankTransactions);
router.get('/bin', HO_MGMT, exportBin);

export default router;
