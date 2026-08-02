import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

router.post('/signup', validate(authController.signupSchema), authController.signup);
router.post('/login', validate(authController.loginSchema), authController.login);
router.post('/logout', authController.logout);

// OAuth (Google) handshake: verifies the Supabase token and finds-or-creates
// the linked profile. No authMiddleware because the profile may not exist yet.
router.post('/oauth', validate(authController.oauthSchema), authController.oauth);
// Abandoned Google sign-up: delete the orphan auth user + profile.
router.post('/oauth-cancel', validate(authController.oauthCancelSchema), authController.oauthCancel);

router.get('/me', authMiddleware, authController.getMe);
router.put('/me', authMiddleware, validate(authController.updateProfileSchema), authController.updateMe);

router.post('/verify-admin', authMiddleware, validate(authController.verifyAdminSchema), authController.verifyAdmin);
router.get('/staff', authMiddleware, requireRole(Role.Admin), authController.listStaff);
router.post('/staff', authMiddleware, requireRole(Role.Admin), validate(authController.createStaffSchema), authController.createStaff);
router.delete('/staff/:id', authMiddleware, requireRole(Role.Admin), authController.removeStaff);

export default router;
