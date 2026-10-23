import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { Role } from '../types/index.js';
import * as smsController from '../controllers/sms.controller.js';

const router = Router();

// M5: SMS blast-through-a-staff-account guard — 20 sends / 10 min per IP.
// SMS costs money and can be abused for spam/harassment; manual sends are rare.
const smsLimiter = createRateLimiter(20, 10 * 60_000);

router.use(authMiddleware, requireRole(Role.Admin, Role.Staff));

router.post('/send', smsLimiter, validate(smsController.sendSmsSchema), smsController.sendManualSms);
router.get('/history', smsController.getSmsHistory);
// Retry a logged send (same recipient + message). Staff-initiated manual
// action: rate-limited and audited, and it bypasses the automatic-SMS switch.
router.post('/history/:id/resend', smsLimiter, smsController.resendSmsHistory);
// Admin-only log cleanup (staff keep read access �?" the log is the delivery
// audit trail, so only admins may erase rows).
router.delete('/history/:id', requireRole(Role.Admin), smsController.deleteSmsHistory);

export default router;
