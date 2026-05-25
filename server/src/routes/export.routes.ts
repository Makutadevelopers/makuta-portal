// export.routes.ts
// CSV / XLSX / PDF export endpoints — ho + mgmt only

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { exportAging, exportInvoices, exportCashflow } from '../controllers/export.controller';
import {
  exportCreditNotes, exportVendors, exportVendorInvoices,
  exportAuditLogs, exportPettyCash, exportBankTransactions, exportBin,
} from '../controllers/tableExports.controller';

const router = Router();

router.use(authenticate);
router.use(requireRole(['ho', 'mgmt']));

router.get('/aging', exportAging);
router.get('/invoices', exportInvoices);
// Backward-compatible CSV alias — equivalent to /invoices?format=csv
router.get('/invoices.csv', (req, res, next) => {
  req.query.format = 'csv';
  return exportInvoices(req, res, next);
});
router.get('/cashflow', exportCashflow);
router.get('/credit-notes', exportCreditNotes);
router.get('/vendors', exportVendors);
router.get('/vendor-invoices', exportVendorInvoices);
router.get('/audit', exportAuditLogs);
router.get('/petty-cash', exportPettyCash);
router.get('/bank-transactions', exportBankTransactions);
router.get('/bin', exportBin);

export default router;
