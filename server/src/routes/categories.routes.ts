// categories.routes.ts
// Open to every authenticated role — anyone can list and create
// categories. Case-insensitive dedupe lives in the controller.

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { listCategories, createCategory } from '../controllers/categories.controller';

const router = Router();

router.use(authenticate);
router.get('/', listCategories);
router.post('/', createCategory);

export default router;
