import { Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import { isAllowedOrigin, normalizeOrigin } from '../utils/origins.js';
import type { AuthenticatedRequest } from '../types/index.js';

// Defense-in-depth CSRF protection for state-changing requests. HttpOnly +
// SameSite=Lax cookies already block the bulk of CSRF, but a same-site lax
// cookie can still ride along on top-level POST navigations in some browsers.
// This guard rejects any mutating request whose Origin/Referer is not on the
// allowlist (frontend origin + ALLOWED_ORIGINS + www/apex twins + same-origin,
// see utils/origins.ts). GET/HEAD/OPTIONS are skipped.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfGuard() {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!MUTATING.has(req.method)) {
      return next();
    }

    const origin = req.headers.origin;
    const referer = req.headers.referer;

    const candidate = origin || referer;
    if (!candidate) {
      // No Origin/Referer header (e.g. curl, some mobile clients). Allow
      // requests that carry a Bearer token (machine-to-machine), but block
      // cookie-authenticated mutations without an origin.
      const hasBearer = req.headers.authorization?.startsWith('Bearer ');
      if (!hasBearer) {
        throw new AppError(403, 'CSRF validation failed — missing origin');
      }
      return next();
    }

    // Allow: allowlisted front-end origins, or same-origin (checked against
    // the host this request actually arrived on, covering direct API use).
    if (isAllowedOrigin(candidate) || normalizeOrigin(candidate) === originOf(req)) {
      return next();
    }

    // Include the rejected origin in the message so production logs name the
    // host that was actually used (the old log line forced log archaeology).
    throw new AppError(403, `CSRF validation failed — origin not allowed: ${normalizeOrigin(candidate) || candidate}`);
  };
}

function originOf(req: AuthenticatedRequest): string {
  const host = req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim() || (req.secure ? 'https' : 'http');
  return `${proto}//${host}`;
}
