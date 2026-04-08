// import.routes.ts
// Bulk CSV/XLSX import.
// - Vendors + invoices: HO + Site
// - Payments: HO only (site accountants must never bulk-write payment data — CLAUDE.md)
// - Clear / undo batch: HO only
// - Template download: public (no auth needed)

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { upload } from '../middleware/upload';
import { importInvoices, importVendors, importPayments, clearImportedData, undoBatchImport, downloadTemplate } from '../controllers/import.controller';

const router = Router();

// Template download — public (no auth needed)
router.get('/template/:type', downloadTemplate);

// Everything below this point requires authentication
router.use(authenticate);

const csvUpload = upload.single('file');

// HO + Site may import invoices and vendors (site-filtered at row level)
router.post('/invoices', requireRole(['ho', 'site']), csvUpload, importInvoices);
router.post('/vendors', requireRole(['ho', 'site']), csvUpload, importVendors);

// Payments import is HO-only (never exposed to site accountants)
router.post('/payments', requireRole(['ho']), csvUpload, importPayments);

router.delete('/clear/:type', requireRole(['ho']), clearImportedData);
router.delete('/batch/:batchId', requireRole(['ho']), undoBatchImport);

export default router;
