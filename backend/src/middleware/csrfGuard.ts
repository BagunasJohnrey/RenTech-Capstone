import { Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { AppError } from './errorHandler.js';
import type { AuthenticatedRequest } from '../types/index.js';

// Defense-in-depth CSRF protection for state-changing requests. HttpOnly +
// SameSite=Lax cookies already block the bulk of CSRF, but a same-site lax
// cookie can still ride along on top-level POST navigations in some browsers.
// This guard rejects any mutating request whose Origin/Referer does not match
// an allowlist (the app front-end). GET/HEAD/OPTIONS are skipped.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfGuard() {
  const frontendOrigin = normalizeOrigin(env.FRONTEND_URL);
  const localhostOrigins = new Set([
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
  ]);

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

    const normalized = normalizeOrigin(candidate);

    // Allow: front-end origin, localhost dev origins, or same-origin.
    if (
      normalized === frontendOrigin ||
      localhostOrigins.has(normalized) ||
      normalized === originOf(req)
    ) {
      return next();
    }

    throw new AppError(403, 'CSRF validation failed — origin not allowed');
  };
}

function normalizeOrigin(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

function originOf(req: AuthenticatedRequest): string {
  const host = req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim() || (req.secure ? 'https' : 'http');
  return `${proto}//${host}`;
}
