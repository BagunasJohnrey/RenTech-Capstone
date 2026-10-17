import { env } from '../config/env.js';

// Browser origins allowed to talk to the API, shared by the CORS config and the
// CSRF guard so the two can never disagree. (They did disagree in production:
// a shared link to the old Vercel host kept being opened by the Facebook
// in-app browser, CORS echoed the canonical origin, and the CSRF guard 403'd
// every login POST with "origin not allowed".)
//
// - env.FRONTEND_URL is the canonical app URL (also used for email links and
//   payment redirects, so it must stay a single URL).
// - env.ALLOWED_ORIGINS adds extra origins (comma-separated) — e.g. a legacy
//   deployment host that shared links and bookmarks still point at.
// - www/apex twins of every allowed origin are expanded automatically: cookies
//   are per-host, so a user who typed the other variant of the same domain
//   still gets a working session flow. Same registrable domain ⇒ same site ⇒
//   no CSRF weakening.
const LOCALHOST_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

// Reduce any URL (origin, referer with path, etc.) to scheme://host[:port].
// Returns '' for non-http(s) inputs (including the literal "null" origin some
// in-app browsers send) so they can never match an allowlisted origin.
export function normalizeOrigin(url: string): string {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

// `https://www.example.com` ↔ `https://example.com` (+ explicit ports).
// Conservative on purpose: only strips/adds a leading `www.` on two-label
// hosts, so `app.example.com` never gains a made-up `www.app.` twin.
function wwwTwin(origin: string): string | null {
  try {
    const u = new URL(origin);
    const host = u.hostname;
    const port = u.port ? `:${u.port}` : '';
    if (host.startsWith('www.')) {
      const bare = host.slice(4);
      return bare.includes('.') ? `${u.protocol}//${bare}${port}` : null;
    }
    return host.split('.').length === 2 ? `${u.protocol}//www.${host}${port}` : null;
  } catch {
    return null;
  }
}

export function buildAllowedOrigins(frontendUrl: string, extraOrigins: string[]): Set<string> {
  const set = new Set<string>();
  // Tolerate partial env objects (tests mock config/env.js and may predate
  // this field) — a missing extras list must not crash module loading.
  for (const raw of [frontendUrl, ...(extraOrigins ?? [])]) {
    const origin = normalizeOrigin(raw);
    if (!origin) continue;
    set.add(origin);
    const twin = wwwTwin(origin);
    if (twin) set.add(twin);
  }
  for (const localhost of LOCALHOST_ORIGINS) set.add(localhost);
  return set;
}

export const allowedOrigins: ReadonlySet<string> =
  buildAllowedOrigins(env.FRONTEND_URL, env.ALLOWED_ORIGINS);

export function isAllowedOrigin(candidate: string): boolean {
  return allowedOrigins.has(normalizeOrigin(candidate));
}
