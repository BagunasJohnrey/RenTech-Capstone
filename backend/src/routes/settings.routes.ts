import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole, requireMfaAdmin } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as settingsController from '../controllers/settings.controller.js';

const router = Router();

// Public rental-suggestion defaults (rental period + min downpayment) — safe
// for logged-out customers mid-booking, so registered before authMiddleware.
router.get('/rental-defaults', settingsController.getRentalDefaults);

router.use(authMiddleware);

router.get('/rules', requireRole(Role.Admin, Role.Staff), settingsController.getRules);
// SECURITY: only Admin may change business rules (late penalties, damage
// fees) — a staff member tampering with these would alter every invoice.
router.put('/rules', requireRole(Role.Admin), requireMfaAdmin, validate(settingsController.updateRulesSchema), settingsController.updateRules);

// Non-sensitive feature flags (UI toggles) readable by any authenticated role.
// Currently just qr_booking_codes.
router.get('/flags', settingsController.getFeatureFlags);

router.get('/sms-templates', requireRole(Role.Admin, Role.Staff), settingsController.listTemplates);
router.post('/sms-templates', requireRole(Role.Admin), requireMfaAdmin, validate(settingsController.createTemplateSchema), settingsController.createTemplate);
router.put('/sms-templates/:id', requireRole(Role.Admin), requireMfaAdmin, validate(settingsController.updateTemplateSchema), settingsController.updateTemplate);
router.delete('/sms-templates/:id', requireRole(Role.Admin), requireMfaAdmin, settingsController.deleteTemplate);

// Admin-only one-click JSON backups (Data & Backups tab): full-table dump
// plus visible history. MFA-gated like the other sensitive admin routes —
// backups contain customer PII.
router.get('/backups', requireRole(Role.Admin), requireMfaAdmin, settingsController.listBackups);
router.post('/backups', requireRole(Role.Admin), requireMfaAdmin, settingsController.createBackup);
router.post('/backups/import', requireRole(Role.Admin), requireMfaAdmin, validate(settingsController.importBackupSchema), settingsController.importBackup);
router.post('/backups/:id/upload', requireRole(Role.Admin), requireMfaAdmin, settingsController.retryBackupUpload);
router.get('/backups/:id/download', requireRole(Role.Admin), requireMfaAdmin, settingsController.downloadBackup);

// Admin-only: live connectivity/health probe for external integrations
// (Gemini AI, Semaphore SMS, PayMongo payments).
router.get('/integrations-status', requireRole(Role.Admin), requireMfaAdmin, settingsController.getIntegrationsStatus);

export default router;
