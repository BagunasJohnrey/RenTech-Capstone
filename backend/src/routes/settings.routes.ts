import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as settingsController from '../controllers/settings.controller.js';

const router = Router();

router.use(authMiddleware);

router.get('/rules', requireRole(Role.Admin, Role.Staff), settingsController.getRules);
router.put('/rules', requireRole(Role.Admin, Role.Staff), validate(settingsController.updateRulesSchema), settingsController.updateRules);

router.get('/sms-templates', requireRole(Role.Admin, Role.Staff), settingsController.listTemplates);
router.post('/sms-templates', requireRole(Role.Admin), validate(settingsController.createTemplateSchema), settingsController.createTemplate);
router.put('/sms-templates/:id', requireRole(Role.Admin), validate(settingsController.updateTemplateSchema), settingsController.updateTemplate);
router.delete('/sms-templates/:id', requireRole(Role.Admin), settingsController.deleteTemplate);

export default router;
