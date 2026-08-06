import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole, requireMfaAdmin } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as settingsController from '../controllers/settings.controller.js';

const router = Router();

router.use(authMiddleware);

router.get('/rules', requireRole(Role.Admin, Role.Staff), settingsController.getRules);
// SECURITY: only Admin may change business rules (late penalties, damage
// fees) — a staff member tampering with these would alter every invoice.
router.put('/rules', requireRole(Role.Admin), requireMfaAdmin, validate(settingsController.updateRulesSchema), settingsController.updateRules);

router.get('/sms-templates', requireRole(Role.Admin, Role.Staff), settingsController.listTemplates);
router.post('/sms-templates', requireRole(Role.Admin), requireMfaAdmin, validate(settingsController.createTemplateSchema), settingsController.createTemplate);
router.put('/sms-templates/:id', requireRole(Role.Admin), requireMfaAdmin, validate(settingsController.updateTemplateSchema), settingsController.updateTemplate);
router.delete('/sms-templates/:id', requireRole(Role.Admin), requireMfaAdmin, settingsController.deleteTemplate);

// Admin-only: live connectivity/health probe for external integrations
// (Gemini AI, Semaphore SMS, PayMongo payments).
router.get('/integrations-status', requireRole(Role.Admin), requireMfaAdmin, settingsController.getIntegrationsStatus);

export default router;
