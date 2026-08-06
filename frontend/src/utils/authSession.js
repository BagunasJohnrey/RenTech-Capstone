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

export function clearImageCache() {
  try {
    sessionStorage.removeItem(IMG_CACHE_KEY);
  } catch { /* storage unavailable */ }
}

// Attempt a silent session refresh via the backend /auth/refresh endpoint,
// which reads the refresh-token cookie. Returns true on success.
export async function refreshSession() {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      setAuthed(false);
      return false;
    }
    const data = await res.json();
    if (data?.user) {
      setAuthed(true);
      return true;
    }
    setAuthed(false);
    return false;
  } catch {
    setAuthed(false);
    return false;
  }
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
