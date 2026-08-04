import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { createRateLimiter, createKeyedRateLimiter } from '../middleware/rateLimiter.js';
import { Role } from '../types/index.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

// SECURITY: dedicated brute-force throttles on the credential paths. The login
// limiter keys on both IP and email so password guessing is bounded even when
// the attacker rotates IPs. (The global 100 req/min limiter also still applies.)
const loginIpLimiter = createRateLimiter(5, 60_000);                       // 5/min per IP
const loginCredentialLimiter = createKeyedRateLimiter(
  (req) => `login:${req.body?.email}:${req.ip}`, 10, 15 * 60_000           // 10/15min per email+IP
);
const signupLimiter = createRateLimiter(5, 60_000);                        // 5/min per IP
const oauthLimiter = createRateLimiter(10, 60_000);

router.post('/signup', signupLimiter, validate(authController.signupSchema), authController.signup);
router.post('/login', loginIpLimiter, loginCredentialLimiter, validate(authController.loginSchema), authController.login);
router.post('/logout', authController.logout);

// OAuth (Google) handshake: verifies the Supabase token and finds-or-creates
// the linked profile. No authMiddleware because the profile may not exist yet.
router.post('/oauth', oauthLimiter, validate(authController.oauthSchema), authController.oauth);
// Abandoned Google sign-up: delete the orphan auth user + profile.
router.post('/oauth-cancel', oauthLimiter, validate(authController.oauthCancelSchema), authController.oauthCancel);

router.get('/me', authMiddleware, authController.getMe);
router.put('/me', authMiddleware, validate(authController.updateProfileSchema), authController.updateMe);

router.post('/verify-admin', authMiddleware, validate(authController.verifyAdminSchema), authController.verifyAdmin);
router.get('/staff', authMiddleware, requireRole(Role.Admin), authController.listStaff);
router.post('/staff', authMiddleware, requireRole(Role.Admin), validate(authController.createStaffSchema), authController.createStaff);
router.delete('/staff/:id', authMiddleware, requireRole(Role.Admin), authController.removeStaff);

export default router;
