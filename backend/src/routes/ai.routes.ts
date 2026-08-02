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

export default router;
