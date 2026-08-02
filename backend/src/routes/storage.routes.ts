import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as storageController from '../controllers/storage.controller.js';

const router = Router();

router.post('/upload', authMiddleware, requireRole(Role.Admin, Role.Staff), validate(storageController.uploadSchema), storageController.upload);
// Public: generates a short-lived signed URL to the private bucket. Auth is not
// required so guest catalog browsers can resolve item photos. The signed URL
// itself is the access control (valid 1h, single-use intent).
router.get('/:path', storageController.getDownloadUrl);

export default router;
