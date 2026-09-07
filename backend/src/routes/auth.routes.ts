import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole, requireMfaAdmin } from '../middleware/rbac.js';
import { csrfGuard } from '../middleware/csrfGuard.js';
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

// CSRF guard applies to all state-changing routes. It allows Bearer-token
// requests (machine-to-machine / tests) and same-origin browser requests.
router.use(csrfGuard());

router.post('/signup', signupLimiter, validate(authController.signupSchema), authController.signup);
router.post('/login', loginIpLimiter, loginCredentialLimiter, validate(authController.loginSchema), authController.login);
router.post('/logout', authController.logout);
// Phase 1: silent refresh — reads the refresh-token cookie, no CSRF body needed
// (it's cookie-only, same-origin by design). Rate-limited to prevent abuse.
router.post('/refresh', createRateLimiter(30, 60_000), authController.refresh);

// Phase 2: password reset — always 200 (no enumeration), rate-limited per IP.
router.post('/forgot-password', createRateLimiter(5, 60_000), validate(authController.forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', createRateLimiter(10, 60_000), validate(authController.resetPasswordSchema), authController.resetPassword);
// Email verification: consume the signup confirmation token (from the email link).
router.post('/verify-email', createRateLimiter(10, 60_000), validate(authController.verifyEmailSchema), authController.verifyEmail);
// Resend the verification email — always 200 (no enumeration).
router.post('/resend-verification', createRateLimiter(5, 60_000), validate(authController.resendVerificationSchema), authController.resendVerification);

// OAuth (Google) handshake — Phase 3 server-side redirect.
// POST /oauth (legacy, token-in-body) kept for backward-compat but unused
// after the frontend migration to GET-based redirect/callback.
router.post('/oauth', oauthLimiter, validate(authController.oauthSchema), authController.oauth);
router.post('/oauth-cancel', oauthLimiter, validate(authController.oauthCancelSchema), authController.oauthCancel);

// Phase 3: server-side OAuth redirect flow.
router.get('/oauth/redirect', oauthLimiter, authController.oauthRedirect);
router.get('/oauth/callback', oauthLimiter, authController.oauthCallback);
router.post('/oauth/details', oauthLimiter, validate(authController.oauthDetailsSchema), authController.oauthDetails);
router.post('/oauth/cancel', oauthLimiter, authController.oauthCancelCookie);

// Phase 5: MFA endpoints — admin-only management + public challenge path.
router.post('/mfa/setup', authMiddleware, requireRole(Role.Admin), authController.mfaSetup);
router.post('/mfa/enable', authMiddleware, requireRole(Role.Admin), validate(authController.mfaEnableSchema), authController.mfaEnable);
router.post('/mfa/disable', authMiddleware, requireRole(Role.Admin), authController.mfaDisable);
router.post('/login/mfa', createRateLimiter(10, 60_000), validate(authController.mfaChallengeSchema), authController.mfaChallenge);

router.get('/me', authMiddleware, authController.getMe);
router.put('/me', authMiddleware, validate(authController.updateProfileSchema), authController.updateMe);
// First-login staff: replace the admin-issued one-time password. Only usable
// while Profile.mustChangePassword is set; rate-limited against guessing the
// one-time password from a hijacked session.
router.post('/change-password', authMiddleware, createRateLimiter(10, 60_000), validate(authController.changePasswordSchema), authController.changePassword);

// Admin-only routes with MFA enforcement. verify-admin additionally allows
// Staff callers (the discount flow runs inside the staff rental modal) — the
// presented 4-digit admin PIN is the authorization factor, and the route is
// rate-limited per-IP because a 4-digit space is brute-forceable.
router.post('/verify-admin', authMiddleware, requireRole(Role.Admin, Role.Staff), requireMfaAdmin, createRateLimiter(5, 600_000), validate(authController.verifyAdminSchema), authController.verifyAdmin);
router.put('/admin-pin', authMiddleware, requireRole(Role.Admin), requireMfaAdmin, createRateLimiter(5, 60_000), validate(authController.setAdminPinSchema), authController.setAdminPin);
router.get('/admin-pin', authMiddleware, requireRole(Role.Admin), requireMfaAdmin, authController.adminPinStatus);
router.get('/staff', authMiddleware, requireRole(Role.Admin), requireMfaAdmin, authController.listStaff);
router.post('/staff', authMiddleware, requireRole(Role.Admin), requireMfaAdmin, validate(authController.createStaffSchema), authController.createStaff);
router.delete('/staff/:id', authMiddleware, requireRole(Role.Admin), requireMfaAdmin, authController.removeStaff);

export default router;
