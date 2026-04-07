// import.routes.ts
// Bulk CSV/XLSX import — HO + Site accountants
// Template download — no auth required

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { upload } from '../middleware/upload';
import { importInvoices, importVendors, importPayments, downloadTemplate } from '../controllers/import.controller';

const router = Router();

// Template download — public (no auth needed)
router.get('/template/:type', downloadTemplate);

// All accounts team can bulk upload (HO + Site)
router.use(authenticate);
router.use(requireRole(['ho', 'site']));

const csvUpload = upload.single('file');

router.post('/invoices', csvUpload, importInvoices);
router.post('/vendors', csvUpload, importVendors);
router.post('/payments', csvUpload, importPayments);

export default router;
