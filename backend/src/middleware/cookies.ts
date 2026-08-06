import { Response, Request } from 'express';
import * as crypto from 'crypto';
import { env } from '../config/env.js';

export const ACCESS_COOKIE = 'rt_access';
export const REFRESH_COOKIE = 'rt_refresh';
export const OAUTH_PENDING_COOKIE = 'rt_oauth_pending';
export const OAUTH_PKCE_COOKIE = 'rt_oauth_pkce';
// Non-httpOnly epoch-ms cookie — the frontend reads it to schedule a
// proactive refresh before the access token expires.
export const EXPIRES_AT_COOKIE = 'rt_expires_at';
// W2.7: short-lived httpOnly cookie holding the MFA challenge tokens while the
// user completes the TOTP/backup-code step. httpOnly because these ARE real
// access/refresh tokens — we just don't consider the session "active" until
// MFA passes. 15 min lifetime: long enough to grab the phone + app, short
// enough that a leaked cookie is uselessly stale.
export const MFA_PENDING_COOKIE = 'rt_mfa_pending';
// MFA-verified marker: httpOnly cookie set ONLY after the server successfully
// verified a second factor (TOTP or backup code) for this access token. The
// value is an HMAC over the access token, so it can't be forged or replayed
// with a different token. requireMfaAdmin accepts this as equivalent to
// Supabase AAL=2 — our TOTP is homegrown (Profile.totpSecret), so the JWT
// `aal` claim never advances past 1 on its own.
export const MFA_VERIFIED_COOKIE = 'rt_mfa_verified';
// Trusted-device cookie: set ONCE after a successful TOTP/backup-code
// challenge (or MFA enable) when the admin opts to "trust this browser".
// Persists 30 days and SURVIVES logout — a trusted browser skips the TOTP
// prompt at login. HMAC-bound to the account identity (email) so it can't be
// forged or replayed for a different account. httpOnly (no JS access).
export const MFA_TRUSTED_COOKIE = 'rt_mfa_trusted';

// Access tokens live ~1h; refresh tokens can persist for ~60 days.
// The access cookie maxAge tracks the JWT expiry so the cookie disappears
// when the token does (forces a refresh before the cookie is sent).
const ACCESS_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour default
const REFRESH_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

// True in production — cookies must ride HTTPS only.
const isProd = env.NODE_ENV === 'production';

export interface RtSession {
  access_token: string | null;
  refresh_token: string | null;
  token_type?: string;
  expires_in?: number | null;
}

/**
 * Set both httpOnly session cookies. The access cookie mirrors the token
 * expiry (falls back to 1h); the refresh cookie persists ~60 days.
 * Also sets a non-httpOnly `rt_expires_at` cookie so the frontend can
 * schedule a proactive refresh ~5 min before the access token expires.
 */
export function setSessionCookies(res: Response, session: RtSession): void {
  if (!session.access_token) return;

  const accessMaxAge = session.expires_in
    ? session.expires_in * 1000
    : ACCESS_MAX_AGE_MS;

  res.cookie(ACCESS_COOKIE, session.access_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: accessMaxAge,
    path: '/api',
  });

  // Non-httpOnly so the frontend can read it and schedule a proactive
  // refresh before the access token expires. Not sensitive on its own.
  res.cookie(EXPIRES_AT_COOKIE, String(Date.now() + accessMaxAge), {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProd,
    maxAge: accessMaxAge,
    path: '/',
  });

  if (session.refresh_token) {
    res.cookie(REFRESH_COOKIE, session.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: REFRESH_MAX_AGE_MS,
      path: '/api',
    });
  }
}

/** Clear both session cookies (set expired/expired+empty). */
export function clearSessionCookies(res: Response): void {
  const opts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProd,
    path: '/api',
  };
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, opts);
  res.clearCookie(MFA_VERIFIED_COOKIE, opts);
  // Also clear the non-httpOnly expiry cookie (scoped to /).
  res.clearCookie(EXPIRES_AT_COOKIE, { sameSite: 'lax' as const, secure: isProd, path: '/' });
}/** Read the access-token cookie. Returns undefined when absent. */
export function getAccessTokenFromCookie(req: Request): string | undefined {
  const val = req.cookies?.[ACCESS_COOKIE];
  return typeof val === 'string' && val.length > 0 ? val : undefined;
}

/** Read the refresh-token cookie. Returns undefined when absent. */
export function getRefreshTokenFromCookie(req: Request): string | undefined {
  const val = req.cookies?.[REFRESH_COOKIE];
  return typeof val === 'string' && val.length > 0 ? val : undefined;
}

/** Read the access-token expiry timestamp (epoch ms) from the non-httpOnly
 *  rt_expires_at cookie. Returns epoch ms when valid, otherwise null. */
export function getExpiresAtFromCookie(req: Request): number | null {
  const val = req.cookies?.[EXPIRES_AT_COOKIE];
  if (typeof val !== 'string' || !val) return null;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Phase 3: PKCE code_verifier cookie — short-lived, scoped to the OAuth flow.
export function setPkceCookie(res: Response, codeVerifier: string): void {
  res.cookie(OAUTH_PKCE_COOKIE, codeVerifier, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 5 * 60 * 1000, // 5 minutes — enough for the OAuth round-trip
    path: '/api',
    // Prevent sending the PKCE verifier on every request; it's only needed
    // during the callback exchange.
  });
}

export function getPkceCookie(req: Request): string | undefined {
  const val = req.cookies?.[OAUTH_PKCE_COOKIE];
  return typeof val === 'string' && val.length > 0 ? val : undefined;
}

export function clearPkceCookie(res: Response): void {
  res.clearCookie(OAUTH_PKCE_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/api',
  });
}

// Phase 3: Flag cookie telling the frontend that the OAuth profile is
// incomplete and the details form should be shown. Non-httpOnly so the
// frontend can read it (it's just a boolean, no sensitive data).
export function setOauthPendingCookie(res: Response): void {
  res.cookie(OAUTH_PENDING_COOKIE, '1', {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 10 * 60 * 1000, // 10 minutes — matches the access token lifetime
    path: '/',
  });
}

export function clearOauthPendingCookie(res: Response): void {
  res.clearCookie(OAUTH_PENDING_COOKIE, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
  });
}

// W2.7: MFA pending cookie — holds the access+refresh tokens while the admin
// completes the TOTP/backup-code challenge. httpOnly so no JS reads the tokens
// (they're real session tokens), cleared on MFA pass or timeout.

const MFA_PENDING_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

export function setMfaPendingCookie(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(MFA_PENDING_COOKIE, `${accessToken}|||${refreshToken}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: MFA_PENDING_MAX_AGE_MS,
    path: '/api',
  });
}

export function getMfaPendingCookie(req: Request): { accessToken: string; refreshToken: string } | undefined {
  const val = req.cookies?.[MFA_PENDING_COOKIE];
  if (typeof val !== 'string' || !val) return undefined;
  const parts = val.split('|||');
  if (parts.length !== 2) return undefined;
  const [accessToken, refreshToken] = parts;
  if (!accessToken || !refreshToken) return undefined;
  return { accessToken, refreshToken };
}

export function clearMfaPendingCookie(res: Response): void {
  res.clearCookie(MFA_PENDING_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/api',
  });
}

// ---------------------------------------------------------------------------
// MFA-verified marker (rt_mfa_verified)
// ---------------------------------------------------------------------------

// Fail closed when no key is configured: a missing key means we can neither
// sign nor verify, so treat every request as unverified.
function mfaMarkerKey(): string | null {
  return env.MFA_SECRET_KEY || env.SUPABASE_JWT_SECRET || null;
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Build the signed marker value for an access token (exported for tests). */
export function buildMfaVerifiedValue(accessToken: string): string | null {
  const key = mfaMarkerKey();
  if (!key || !accessToken) return null;
  const mac = crypto.createHmac('sha256', key).update(accessToken).digest();
  return `v1.${toBase64Url(mac)}`;
}

/**
 * Set the MFA-verified marker for the given access token. Only called after
 * the server itself verified a second factor (TOTP/backup code) for this
 * session. The cookie is httpOnly, bound to the exact access token, and
 * re-minted on refresh (see auth.controller refresh).
 */
export function setMfaVerifiedCookie(res: Response, accessToken: string): void {
  const value = buildMfaVerifiedValue(accessToken);
  if (!value) {
    console.warn('[cookies] MFA_SECRET_KEY/SUPABASE_JWT_SECRET unset — rt_mfa_verified marker cannot be minted; MFA-gated admin routes will 403 mfa_challenge_required.');
    return;
  }
  res.cookie(MFA_VERIFIED_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    // Bound to the access token (max 1h); generous margin for pre-expiry
    // refreshes which re-mint the marker. A stale marker is rejected because
    // its token binding no longer matches.
    maxAge: 12 * 60 * 60 * 1000,
    path: '/api',
  });
}

/**
 * True when the request carries a valid MFA-verified marker for the given
 * access token. Constant-time comparison; fails closed on any mismatch.
 */
export function isMfaVerifiedCookie(req: Request, accessToken: string): boolean {
  if (!accessToken) return false;
  const expected = buildMfaVerifiedValue(accessToken);
  if (!expected) return false;
  const received = req.cookies?.[MFA_VERIFIED_COOKIE];
  if (typeof received !== 'string' || received.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Clear the MFA-verified marker (used on logout). */
export function clearMfaVerifiedCookie(res: Response): void {
  res.clearCookie(MFA_VERIFIED_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/api',
  });
}

// ---------------------------------------------------------------------------
// Trusted device (rt_mfa_trusted)
// ---------------------------------------------------------------------------

const MFA_TRUSTED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TRUST_PREFIX = 'trusted:'; // namespaces the HMAC domain vs the marker

/** Build the signed trusted-device value for an account identity (email). */
export function buildMfaTrustedValue(identity: string): string | null {
  const key = mfaMarkerKey();
  if (!key) {
    console.warn('[cookies] MFA_SECRET_KEY/SUPABASE_JWT_SECRET unset — rt_mfa_trusted cannot be minted; trust-this-device disabled.');
    return null;
  }
  if (!identity) return null;
  const mac = crypto.createHmac('sha256', key).update(`${TRUST_PREFIX}${identity}`).digest();
  return `v1.${toBase64Url(mac)}`;
}

/**
 * Set the trusted-device cookie for an account identity. Only called after the
 * server verified a second factor for this browser (TOTP/backup code at login
 * with the "trust" checkbox, or on successful MFA enable). Persists 30 days
 * and is NOT cleared on logout — that's what makes "trust this browser" work.
 */
export function setMfaTrustedCookie(res: Response, identity: string): void {
  const value = buildMfaTrustedValue(identity);
  if (!value) return;
  res.cookie(MFA_TRUSTED_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: MFA_TRUSTED_MAX_AGE_MS,
    path: '/api',
  });
}

/** True when the request carries a valid trusted-device cookie for the ID. Constant-time compare; fails closed. */
export function isMfaTrustedCookie(req: Request, identity: string): boolean {
  if (!identity) return false;
  const expected = buildMfaTrustedValue(identity);
  if (!expected) return false;
  const received = req.cookies?.[MFA_TRUSTED_COOKIE];
  if (typeof received !== 'string' || received.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  } catch {
    return false;
  }
}
