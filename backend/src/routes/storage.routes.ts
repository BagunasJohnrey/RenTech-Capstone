import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as storageController from '../controllers/storage.controller.js';

const router = Router();

router.post('/upload', authMiddleware, requireRole(Role.Admin, Role.Staff), validate(storageController.uploadSchema), storageController.upload);
// Catalog photos stay public (guests browse the catalog). Private condition
// photos and payment screenshots (`rental/…`, `thumbs/rental/…`) require a
// signed-in user, and the controller checks they may see that booking.
// Express 5 / path-to-regexp v8: named wildcard `/*splat` captures the full
// multi-segment path (e.g. "rental/{uuid}/release-123.jpg" → 'rental/...').
router.get('/*path', storageController.requireAuthForPrivate, storageController.getDownloadUrl);

export default router;
