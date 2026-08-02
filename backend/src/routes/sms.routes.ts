import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as smsController from '../controllers/sms.controller.js';

const router = Router();

router.use(authMiddleware, requireRole(Role.Admin, Role.Staff));

router.post('/send', validate(smsController.sendSmsSchema), smsController.sendManualSms);
router.get('/history', smsController.getSmsHistory);

export default router;
