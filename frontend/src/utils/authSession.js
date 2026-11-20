// Phase 1: auth state is now cookie-backed (httpOnly). The frontend keeps only
// a lightweight "authed" flag in localStorage for multi-tab logout sync and
// bootstrap detection. Access/refresh tokens live exclusively in httpOnly
// cookies — they are never read or persisted by JavaScript.

const AUTHED_KEY = 'rentech_authed';
const IMG_CACHE_KEY = 'rt_img_cache_v1';

// One-time cleanup of stale/orphaned storage keys left behind by earlier
// versions of the app (no code references them anymore). Runs on module init.
try {
  localStorage.removeItem('rentech_token');
  localStorage.removeItem('rentech_session');
  localStorage.removeItem('customer_products_list');
  localStorage.removeItem('rentech_templates');
} catch { /* storage unavailable (SSR/privacy mode) */ }

// Set the authed flag. Called after a successful login or when the app
// confirms a cookie session via /auth/me. Also schedules a proactive refresh
// so long-running sessions never hit a 401 mid-work.
export function setAuthed(value) {
  try {
    if (value) {
      localStorage.setItem(AUTHED_KEY, '1');
      scheduleProactiveRefresh();
    } else {
      localStorage.removeItem(AUTHED_KEY);
      stopProactiveRefresh();
    }
  } catch { /* storage unavailable */ }
}

// Read the authed flag. NOTE: this is only a hint — the source of truth is
// the cookie, validated server-side on each request (and re-checked on boot
// via /auth/me).
export function isAuthed() {
  try {
    return localStorage.getItem(AUTHED_KEY) === '1';
  } catch {
    return false;
  }
}

// Is a session cookie present at all? The access token cookie (rt_access) is
// httpOnly — JS can never see it in document.cookie. The reliable hint is the
// non-httpOnly rt_expires_at companion: the backend sets it on every login,
// OAuth completion, and refresh, so its presence means real session cookies
// were recently minted. Used at boot to avoid firing /auth/me (and its 401)
// when we're almost certainly a guest.
export function hasSessionCookie() {
  try {
    return document.cookie.split('; ').some((c) => c.startsWith('rt_expires_at='));
  } catch {
    return false;
  }
}

export function clearImageCache() {
  try {
    sessionStorage.removeItem(IMG_CACHE_KEY);
  } catch { /* storage unavailable */ }
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Fired (same tab) when the server says the session is gone for good. The
// app listens to sign the user out and land them on the sign-in screen with
// a "session expired" note. Other tabs follow via the rentech_authed
// storage event.
export const SESSION_EXPIRED_EVENT = 'rentech:session-expired';

// Sign out locally because the session can't be renewed. Only announces it
// once: later 401s in the same burst find the flag already cleared.
export function expireSession() {
  const wasAuthed = isAuthed();
  setAuthed(false);
  clearImageCache();
  if (wasAuthed) {
    try { window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT)); } catch { /* SSR/tests */ }
  }
}

// One renewal attempt via /auth/refresh (reads the refresh-token cookie).
//   'ok'      — new session cookies were set
//   'expired' — the server rejected the refresh token (401/400): truly signed out
//   'error'   — network failure, backend restarting, 429 or 5xx: NOT a sign-out,
//               the session may still be fine once the server answers again
export async function refreshSessionStatus() {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok) {
      setAuthed(true);
      return 'ok';
    }
    if (res.status === 401 || res.status === 400) return 'expired';
    return 'error';
  } catch {
    return 'error';
  }
}

// Boolean wrapper for callers that only care about success. A definite
// rejection signs the user out (expireSession); a transient failure keeps
// them signed in. Previously ANY failure — even the backend being down for a
// restart — silently cleared the flag, after which 401s were never retried
// and the tab stayed "logged in" while every request failed.
export async function refreshSession() {
  const status = await refreshSessionStatus();
  if (status === 'expired') expireSession();
  return status === 'ok';
}

// ─── Proactive refresh scheduler ──────────────────────────────────────────
// Reads the rt_expires_at cookie (set alongside the httpOnly session cookies
// on login/refresh) and schedules a setTimeout to refresh ~5 min before the
// access token expires. Reschedules on every successful login/refresh and on
// storage events so multiple tabs converge on the same schedule.

let refreshTimer = null;
let refreshScheduledAt = null;

function readExpiresAt() {
  const match = document.cookie.match(/(?:^|;\s*)rt_expires_at=([^;]+)/);
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clearRefreshTimer() {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    refreshScheduledAt = null;
  }
}

async function doRefreshAndReschedule() {
  clearRefreshTimer();
  const refreshed = await refreshSession();
  if (refreshed) {
    // The backend just set a fresh rt_expires_at cookie; pick it up and
    // reschedule so the chain continues.
    scheduleProactiveRefresh();
  } else if (isAuthed()) {
    // Transient failure (server unreachable / restarting): still signed in,
    // so try again in a minute instead of letting the chain die.
    refreshTimer = setTimeout(doRefreshAndReschedule, 60_000);
    refreshScheduledAt = Date.now();
  }
}

export function scheduleProactiveRefresh() {
  clearRefreshTimer();
  if (!isAuthed()) return;
  const expiresAt = readExpiresAt();
  if (!expiresAt) return;

  const now = Date.now();
  const remainingMs = expiresAt - now;
  // Refresh 5 minutes before expiry; if that's earlier than 30s from now,
  // refresh immediately (the tab may have been asleep past the deadline).
  const delayMs = Math.max(0, remainingMs - 5 * 60_000);
  const maxDelayMs = 25 * 24 * 60 * 60 * 1000; // 25-day cap (setTimeout max is ~24.8 days)

  if (delayMs > maxDelayMs) return; // can't schedule that far out; rely on 401 + retry
  refreshTimer = setTimeout(doRefreshAndReschedule, delayMs);
  refreshScheduledAt = now;
}

export function stopProactiveRefresh() {
  clearRefreshTimer();
}
