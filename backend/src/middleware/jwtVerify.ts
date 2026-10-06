/**
 * Local JWT verification for Supabase-issued access tokens.
 *
 * Why: supabaseAdmin.auth.getUser() is a network round trip to Supabase on
 * EVERY authenticated request (~440ms measured dev→Supabase). The access token
 * is already a self-contained signed JWT — verifying it locally (signature +
 * exp + aud) is cryptographically equivalent and drops auth cost to ~1ms.
 *
 * Approach: fetch the project's JWKS from Supabase's well-known endpoint once,
 * cache the keys in memory (refetch once on unknown `kid` for rotation
 * races), and verify tokens offline using Node's built-in crypto. Falls back
 * to getUser() when:
 *   - JWKS fetch fails (transient network / rotation race)
 *   - The token fails local verification (defense-in-depth / non-JWT token)
 *
 * This project signs ES256 (P-256) — the JWKS path below handles EC keys.
 * HS256 (project JWT secret) and RS256 are kept as fallbacks for other
 * configurations. If nothing verifies, we fall back to getUser().
 */

import * as crypto from 'crypto';
import { env } from '../config/env.js';

export interface VerifiedToken {
  sub: string;         // Supabase auth user id
  email?: string;
  aud: string;         // expected: 'authenticated'
  role?: string;       // 'authenticated' | 'anon' | ...
  aal?: number;        // authenticator assurance level (1 or 2)
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

// Cached JWKS (raw). EC keys (ES256, this project's signing alg) carry
// x/y; RSA keys (alternate configs) carry n/e; oct keys are unused here.
interface JwksKey {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  k?: string;          // oct
  n?: string;          // RSA modulus
  e?: string;          // RSA exponent
  x?: string;          // EC x coordinate
  y?: string;          // EC y coordinate
  crv?: string;        // EC curve (P-256)
}
interface Jwks { keys?: JwksKey[] }
let cachedJwks: Jwks | null = null;
let jwksFetchedAt = 0;
const JWKS_CACHE_MS = 60 * 60 * 1000; // refetch hourly at most (keys rotate rarely)

async function fetchJwks(force = false): Promise<Jwks | null> {
  if (!force && cachedJwks && (Date.now() - jwksFetchedAt) < JWKS_CACHE_MS) return cachedJwks;
  try {
    const url = `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return cachedJwks; // stale cache is better than nothing
    cachedJwks = (await res.json()) as Jwks;
    jwksFetchedAt = Date.now();
    return cachedJwks;
  } catch {
    return cachedJwks;
  }
}

// Test seam: pin the JWKS without network (unit tests generate their own
// ES256 keypair — the live endpoint is unreachable from vitest).
export function __setJwksForTest(jwks: Jwks | null): void {
  cachedJwks = jwks;
  jwksFetchedAt = Date.now();
}

// Verify `signingInput.signature` against one JWKS key. Handles EC (ES256 —
// this project's alg), RSA (RS256 alternates), and oct (symmetric) keys.
// Returns true on a good signature, false otherwise (never throws).
function verifyWithJwksKey(key: JwksKey, alg: string, signingInput: string, signature: string): boolean {
  try {
    if (key.kty === 'EC' && key.x && key.y) {
      const pub = crypto.createPublicKey({
        key: { kty: 'EC', crv: key.crv ?? 'P-256', x: key.x, y: key.y } as unknown as Record<string, string>,
        format: 'jwk',
      });
      // ES256 = ECDSA P-256 + SHA-256. Raw R||S signature (JOSE form).
      return crypto.verify('sha256', Buffer.from(signingInput), pub, base64urlDecode(signature));
    }
    if (key.kty === 'RSA' && key.n && key.e) {
      const pub = crypto.createPublicKey({
        key: { kty: key.kty, n: key.n, e: key.e } as unknown as Record<string, string>,
        format: 'jwk',
      });
      const hashAlg = alg === 'RS384' ? 'RSA-SHA384' : alg === 'RS512' ? 'RSA-SHA512' : 'RSA-SHA256';
      return crypto.verify(hashAlg, Buffer.from(signingInput), pub, base64urlDecode(signature));
    }
    if (key.kty === 'oct' && key.k && env.SUPABASE_JWT_SECRET) {
      const expected = crypto
        .createHmac('sha256', Buffer.from(key.k, 'base64url'))
        .update(signingInput)
        .digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (signature.length !== expected.length) return false;
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    }
  } catch {
    // malformed key — not a match
  }
  return false;
}

function base64urlDecode(input: string): Buffer {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4 !== 0) input += '=';
  return Buffer.from(input, 'base64');
}

function base64urlToString(input: string): string {
  return base64urlDecode(input).toString('utf8');
}

/**
 * Verify a JWT locally (ES256 via JWKS — this project's alg; HS256 secret
 * and RS256 kept as fallbacks). Returns the decoded payload if valid, null
 * if invalid/expired (caller falls back to getUser()).
 */
export async function verifyJwtLocally(token: string): Promise<VerifiedToken | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(base64urlToString(parts[0]));
    const payload = JSON.parse(base64urlToString(parts[1]));
    const signature = parts[2];
    const signingInput = `${parts[0]}.${parts[1]}`;
    const alg = typeof header.alg === 'string' ? header.alg : '';

    // Check expiry first (cheap).
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && Number(payload.exp) < now) return null;
    if (payload.aud && payload.aud !== 'authenticated') return null;

    // Try local JWT secret (HS256) — legacy default signing alg.
    if (env.SUPABASE_JWT_SECRET) {
      const expectedSig = crypto
        .createHmac('sha256', env.SUPABASE_JWT_SECRET)
        .update(signingInput)
        .digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (signature.length === expectedSig.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        return toVerifiedToken(payload);
      }
    }

    // JWKS (this project: ES256; alternates: RS256/oct). Prefer the kid
    // match, then try every key of the token's family so a rotation that
    // added a second key still verifies. One forced refetch on unknown kid
    // covers the rotation race; then give up (caller falls back to getUser).
    for (const attempt of [false, true]) {
      const jwks = await fetchJwks(attempt);
      const keys = jwks?.keys ?? [];
      if (!keys.length) return null;
      const ordered = header.kid
        ? [...keys.filter((k) => k.kid === header.kid), ...keys.filter((k) => k.kid !== header.kid)]
        : keys;
      for (const key of ordered) {
        if (verifyWithJwksKey(key, alg, signingInput, signature)) {
          return toVerifiedToken(payload);
        }
      }
      // No hit and the kid wasn't in the cached set → refetch once.
      if (!attempt && header.kid && !keys.some((k) => k.kid === header.kid)) continue;
      break;
    }
  } catch {
    // Any parse/verify error → treat as unverifiable; fall back.
  }
  return null;
}

function toVerifiedToken(payload: Record<string, unknown>): VerifiedToken | null {
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  const appMeta = payload.app_metadata as Record<string, unknown> | undefined;
  const userMeta = payload.user_metadata as Record<string, unknown> | undefined;
  let aal: number | undefined;
  const rawAal = payload.aal ?? appMeta?.aal ?? userMeta?.aal;
  if (typeof rawAal === 'number') aal = rawAal;
  else if (typeof rawAal === 'string') aal = parseInt(rawAal, 10);
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    aud: typeof payload.aud === 'string' ? payload.aud : '',
    role: typeof payload.role === 'string' ? payload.role : undefined,
    aal: Number.isFinite(aal) ? aal : undefined,
    app_metadata: appMeta,
    user_metadata: userMeta,
  };
}
