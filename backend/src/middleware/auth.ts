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
  };
  setCachedProfile({
    id: profile.id,
    userId: profile.userId,
    email: profile.email,
    role: profile.role as Role,
    name: profile.name,
    phone: profile.phone ?? undefined,
    mfaEnabled: profile.mfaEnabled,
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
    // unreachable, or a non-JWT token). Verify with Supabase as before.
    if (!ctx) {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !user) {
        throw new AppError(401, 'Invalid or expired token');
      }
      const aal = (user.app_metadata?.aal ?? user.user_metadata?.aal) as number | undefined;
      ctx = await loadUserContext(token, user.id, aal);
    }

    if (!ctx) throw new AppError(401, 'Profile not found');

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
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !user) {
        return next();
      }
      const aal = (user.app_metadata?.aal ?? user.user_metadata?.aal) as number | undefined;
      ctx = await loadUserContext(token, user.id, aal);
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
