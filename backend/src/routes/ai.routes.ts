import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import { aiChatRateLimit } from '../middleware/aiRateLimit.js';
import * as aiController from '../controllers/ai.controller.js';

const router = Router();

router.post('/chat', authMiddleware, requireRole(Role.Customer), aiChatRateLimit, validate(aiController.chatSchema), aiController.chat);
router.post('/generate-report', authMiddleware, requireRole(Role.Admin), validate(aiController.reportSchema), aiController.generateReport);
// Saved-report history for the admin "last saved AI reports" lists
// (Settings → Data & Backups + Business Intelligence page).
router.get('/reports', authMiddleware, requireRole(Role.Admin), aiController.listReports);
router.post('/reports/:id/upload', authMiddleware, requireRole(Role.Admin), aiController.retryReportUpload);
router.delete('/reports/:id', authMiddleware, requireRole(Role.Admin), aiController.deleteReport);
router.get('/reports/:id', authMiddleware, requireRole(Role.Admin), aiController.getReport);

export default router;
