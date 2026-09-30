import { Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { prisma } from '../config/database.js';
import { AuthenticatedRequest, AuthUser, Role } from '../types/index.js';
import { AppError } from './errorHandler.js';
import { getAccessTokenFromCookie } from './cookies.js';
import { verifyJwtLocally } from './jwtVerify.js';
import { getCachedProfile, setCachedProfile, invalidateProfileCache } from '../utils/profileCache.js';

// Resolve the access token from an httpOnly cookie, falling back to the
// Authorization: Bearer header. Bearer is retained for backward-compatibility
// (existing API tests + any scripts that still pass a token directly).
function resolveToken(req: AuthenticatedRequest): string | undefined {
  const fromCookie = getAccessTokenFromCookie(req);
  if (fromCookie) return fromCookie;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  return undefined;
}

// Endpoints a mustChangePassword user may still reach. req.path here is the
// route path relative to the router mount, e.g. "/me" or "/change-password".
function isPasswordChangePath(path: string): boolean {
  return path === '/me' || path === '/change-password';
}

// Verify an access token with Supabase, retrying once when verification
// itself fails (network error, timeout, 5xx, 429). Supabase answers fall
// into two buckets:
//   - Definitive rejection (400/401/403/404: bad, expired, or revoked JWT).
//     Retrying can't help — the session is dead.
//   - Transient failure (anything else: no response, 5xx, rate-limit).
//     Worth one retry before giving up.
// Throws 401 'session expired' for the first case and 503 'auth server
// unreachable' for the second, so clients can tell "log in again" apart
// from "try again in a moment" instead of lumping both as 'invalid token'.
async function getUserWithRetry(token: string): Promise<{ id: string; app_metadata?: any; user_metadata?: any }> {
  // eslint-disable-next-line no-await-in-loop
  for (let attempt = 0; attempt < 2; attempt++) {
    let data: { user: unknown } | null = null;
    let error: { status?: unknown; message?: unknown } | null = null;
    try {
      const res = await supabaseAdmin.auth.getUser(token);
      data = res.data as { user: unknown };
      error = res.error as { status?: unknown; message?: unknown } | null;
    } catch (e) {
      error = { message: e instanceof Error ? e.message : 'verification failed' };
    }
    if (!error && data?.user) return data.user as { id: string };
    const status = typeof error?.status === 'number' ? error.status : undefined;
    // Definitive: the token itself was rejected. No point retrying.
    if (status === 400 || status === 401 || status === 403 || status === 404) break;
    if (attempt === 1) {
      throw new AppError(503, 'Could not reach the authentication server. Please try again in a moment.');
    }
    // Transient: loop once more for the single retry.
  }
  throw new AppError(401, 'Your session has expired. Please log in again.');
}

// Build req.user from a verified token (either locally-verified JWT, or the
// Supabase getUser fallback) — extracting sub, email, aal, plus the Prisma
// profile row. Returns null if anything is missing (auth failure).
async function loadUserContext(
  token: string,
  sub: string | undefined,
  aal: number | undefined,
): Promise<{ user: AuthUser; aal: number } | null> {
  // Fast path: profile is in the short-lived cache.
  if (sub) {
    const cached = getCachedProfile(sub);
    if (cached) {
      return {
        user: {
          id: cached.id,
          userId: cached.userId,
          email: cached.email,
          role: cached.role,
          name: cached.name,
          phone: cached.phone,
          mfaEnabled: cached.mfaEnabled,
          mustChangePassword: cached.mustChangePassword,
        },
        aal: aal ?? 1,
      };
    }
  }

  // Slow path: fetch the profile from the DB.
  const profile = await prisma.profile.findUnique({
    where: { userId: sub },
  });
  if (!profile) return null;

  const user: AuthUser = {
    id: profile.id,
    userId: profile.userId,
    email: profile.email,
    role: profile.role as Role,
    name: profile.name,
    phone: profile.phone ?? undefined,
    mfaEnabled: profile.mfaEnabled,
    mustChangePassword: profile.mustChangePassword,
  };
  setCachedProfile({
    id: profile.id,
    userId: profile.userId,
    email: profile.email,
    role: profile.role as Role,
    name: profile.name,
    phone: profile.phone ?? undefined,
    mfaEnabled: profile.mfaEnabled,
    mustChangePassword: profile.mustChangePassword,
  });
  return { user, aal: aal ?? 1 };
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = resolveToken(req);
    if (!token) {
      throw new AppError(401, 'Missing or invalid authorization header');
    }

    // Local JWT verification (offline, no network call to Supabase).
    let ctx: { user: AuthUser; aal: number } | null = null;
    const verified = await verifyJwtLocally(token);
    if (verified) {
      ctx = await loadUserContext(token, verified.sub, verified.aal);
    }

    // Fallback: local verification failed (e.g. missing JWT_SECRET, JWKS
    // unreachable, or a non-JWT token). Verify with Supabase as before —
    // with one retry on transient failures, and distinct expired (401) vs
    // unreachable (503) errors.
    if (!ctx) {
      const user = await getUserWithRetry(token);
      const aal = (user.app_metadata?.aal ?? user.user_metadata?.aal) as number | undefined;
      ctx = await loadUserContext(token, user.id, aal);
    }

    if (!ctx) throw new AppError(401, 'Profile not found');

    // First-login staff lockout: while mustChangePassword is set, the account
    // may only call /auth/me and /auth/change-password. Everything else 403s
    // so a one-time password that leaked can't be used to read data.
    const p = ctx.user as AuthUser & { mustChangePassword?: boolean };
    if (p.mustChangePassword && !isPasswordChangePath(req.path)) {
      throw new AppError(403, 'You must change your password before using this account');
    }

    req.user = ctx.user;
    (req as any).aal = ctx.aal; // attach AAL for downstream guards (requireMfaAdmin)
    next();
  } catch (err) {
    next(err);
  }
}

// Same as authMiddleware but NON-BLOCKING: it attaches req.user when a valid
// token is present, yet still calls next() (without setting req.user) when no
// token is provided or it's invalid. This lets public/guest endpoints (e.g. the
// inventory catalog) serve the full authenticated view to logged-in staff while
// still allowing anonymous browsing.
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = resolveToken(req);
    if (!token) {
      return next();
    }

    // Local JWT verification first (no network round trip).
    let ctx: { user: AuthUser; aal: number } | null = null;
    const verified = await verifyJwtLocally(token);
    if (verified) {
      ctx = await loadUserContext(token, verified.sub, verified.aal);
    }

    if (!ctx) {
      // Non-blocking: a dead session becomes anonymous; an unreachable auth
      // server does too (the request simply gets the signed-out view).
      try {
        const user = await getUserWithRetry(token);
        const aal = (user.app_metadata?.aal ?? user.user_metadata?.aal) as number | undefined;
        ctx = await loadUserContext(token, user.id, aal);
      } catch {
        return next();
      }
    }

    if (!ctx) return next();
    req.user = ctx.user;
    (req as any).aal = ctx.aal;
  } catch {
    // Ignore auth errors for optional auth — treat as anonymous.
  }
  next();
}

export { invalidateProfileCache };
