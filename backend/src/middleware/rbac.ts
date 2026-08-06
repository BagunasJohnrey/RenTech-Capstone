import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, Role } from '../types/index.js';
import { AppError } from './errorHandler.js';
import { getAccessTokenFromCookie, isMfaVerifiedCookie } from './cookies.js';

export function requireRole(...allowedRoles: Role[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(401, 'Authentication required');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError(403, 'Insufficient permissions');
    }

    next();
  };
}

/**
 * Middleware to enforce MFA for Admin users.
 * - If user is not Admin, passes through (no-op).
 * - If Admin with MFA not enabled → 403 { code: 'mfa_enroll_required' }
 * - If Admin with MFA enabled but session AAL < 2 and no MFA-verified
 *   marker → 403 { code: 'mfa_challenge_required' }
 * - If Admin with MFA enabled and (AAL >= 2 OR valid rt_mfa_verified marker
 *   for the current access token) → passes through.
 *
 * The rt_mfa_verified marker is set server-side by auth.controller after a
 * successful TOTP/backup-code challenge. Our TOTP is homegrown
 * (Profile.totpSecret), so the Supabase JWT `aal` claim stays at 1 even after
 * a correct code — the marker is the server's own record that a second factor
 * was verified for this exact access token (HMAC-bound, httpOnly, refreshed
 * along with the session).
 *
 * Performance: this runs AFTER authMiddleware, so the profile (incl.
 * mfaEnabled) and the AAL claim are already resolved on req. No extra DB or
 * Supabase round-trips happen here.
 */
export async function requireMfaAdmin(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== Role.Admin) {
      return next();
    }

    // mfaEnabled was loaded by authMiddleware (from cache or DB).
    if (!req.user.mfaEnabled) {
      throw new AppError(403, 'MFA enrollment required', { code: 'mfa_enroll_required' } as never);
    }

    // AAL was resolved by authMiddleware from the JWT/Supabase and attached to req.
    const aal = (req as any).aal ?? 1;
    if (aal >= 2) {
      return next();
    }

    // Homegrown-MFA session: accept the signed rt_mfa_verified marker when it
    // matches the exact access token of this request.
    const token = getAccessTokenFromCookie(req) ?? (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.split(' ')[1]
      : undefined);
    if (token && isMfaVerifiedCookie(req, token)) {
      return next();
    }

    throw new AppError(403, 'MFA challenge required', { code: 'mfa_challenge_required' } as never);
  } catch (err) {
    next(err);
  }
}
