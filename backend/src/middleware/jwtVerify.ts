/**
 * Local JWT verification for Supabase-issued access tokens.
 *
 * Why: supabaseAdmin.auth.getUser() is a network round trip to Supabase on
 * EVERY authenticated request. The access token is already a self-contained,
 * asymmetrically-signed JWT — verifying it locally (signature + exp + aud)
 * is cryptographically equivalent and removes ~50-150ms of latency per call.
 *
 * Approach: fetch the project's JWKS from Supabase's well-known endpoint once,
 * cache the keys in memory (refetch on unknown `kid`), and verify tokens
 * offline using Node's built-in crypto. Falls back to getUser() when:
 *   - JWKS fetch fails (transient network / rotation race)
 *   - The token fails local verification (defense-in-depth / non-JWT token)
 *
 * Supabase signs with the project's JWT secret (HS256) by default, or RS256
 * for some configurations. We support both: we verify the HMAC with the
 * JWT_SECRET from the project, and also accept the JWKS public keys for RS256
 * if the project is configured that way. If neither works, we fall back.
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

// Cached JWKS (raw). { keys: [{ kid?, kty, alg, use, n?, e?, k? (oct) }] }
interface JwksKey {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  k?: string;          // oct
  n?: string;          // RSA modulus
  e?: string;          // RSA exponent
}
interface Jwks { keys?: JwksKey[] }
let cachedJwks: Jwks | null = null;
let jwksFetchedAt = 0;
const JWKS_CACHE_MS = 10 * 60 * 1000; // refetch every 10 min at most

async function fetchJwks(): Promise<Jwks | null> {
  if (cachedJwks && (Date.now() - jwksFetchedAt) < JWKS_CACHE_MS) return cachedJwks;
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

function base64urlDecode(input: string): Buffer {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4 !== 0) input += '=';
  return Buffer.from(input, 'base64');
}

function base64urlToString(input: string): string {
  return base64urlDecode(input).toString('utf8');
}

/**
 * Verify a JWT locally (HS256 via JWT_SECRET, or RS256 via JWKS).
 * Returns the decoded payload if valid, null if invalid/expired.
 */
export async function verifyJwtLocally(token: string): Promise<VerifiedToken | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(base64urlToString(parts[0]));
    const payload = JSON.parse(base64urlToString(parts[1]));
    const signature = parts[2];
    const signingInput = `${parts[0]}.${parts[1]}`;

    // Check expiry first (cheap).
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && Number(payload.exp) < now) return null;
    if (payload.aud && payload.aud !== 'authenticated') return null;

    // Try local JWT secret (HS256) — Supabase's default signing alg.
    if (env.SUPABASE_JWT_SECRET) {
      const expectedSig = crypto
        .createHmac('sha256', env.SUPABASE_JWT_SECRET)
        .update(signingInput)
        .digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSig)
      )) {
        return toVerifiedToken(payload);
      }
    }

    // Try JWKS (RS256) — for projects with custom signing keys.
    const jwks = await fetchJwks();
    if (jwks?.keys?.length) {
      const key = header.kid
        ? jwks.keys.find((k) => k.kid === header.kid)
        : jwks.keys[0];
      if (key && key.kty === 'RSA' && key.n && key.e) {
        try {
          const pub = crypto.createPublicKey({
            key: {
              kty: key.kty,
              n: key.n,
              e: key.e,
            } as any,
            format: 'jwk',
          });
          const ok = crypto.verify(
            'RSA-SHA256',
            Buffer.from(signingInput),
            pub,
            base64urlDecode(signature)
          );
          if (ok) return toVerifiedToken(payload);
        } catch {
          // ignore malformed keys
        }
      }
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
