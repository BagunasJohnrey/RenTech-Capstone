import { isAuthed } from './authSession';
import { isDemoMode } from './demoMode';
import { demoRequest } from './demoInterceptor';

// Phase 1: auth is cookie-backed (httpOnly). All fetch calls include
// credentials so the browser sends the rt_access / rt_refresh cookies.
// No Authorization header is sent — the backend reads from cookies (with
// Bearer fallback for backward-compat / scripts).

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Full-page navigations (OAuth redirects) don't go through `request`, so expose
// the same resolved base for window.location.href calls.
export const API_ORIGIN = API_BASE.replace(/\/api\/?$/, '');

const FETCH_TIMEOUT_MS = 20000; // abort requests the server never answers

// A short, human-readable abort reason so timeouts surface as "the request took
// too long" instead of the cryptic "signal was aborted without any reason".
const TIMEOUT_REASON = () =>
  new DOMException('The request took too long. The server may be offline — please try again.', 'TimeoutError');

let isRefreshing = false;
let pendingQueue = [];

// Broadcast a silent refresh to all in-flight requests that hit 401.
// Returns true when a refresh is already underway (callers wait), false otherwise.
function lockRefresh() {
  if (isRefreshing) return true;
  isRefreshing = true;
  return false;
}

function unlockRefresh(success) {
  isRefreshing = false;
  const queue = pendingQueue;
  pendingQueue = [];
  queue.forEach((cb) => cb(success));
}

// Lightweight refresh: calls the backend /auth/refresh endpoint which reads
// the refresh-token cookie. Returns true on success.
async function doRefresh() {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function refreshOnce() {
  if (lockRefresh()) {
    // Another refresh is already in progress — wait for it.
    return new Promise((resolve) => {
      pendingQueue.push((success) => resolve(success));
    });
  }
  const success = await doRefresh();
  unlockRefresh(success);
  return success;
}

async function request(method, path, body = undefined, _retried = false, opts = {}) {
  // Demo mode: answer from the in-memory mock — the request never leaves
  // the browser (no backend / Supabase needed for frontend-only viewing).
  if (isDemoMode()) {
    return demoRequest(method, path, body);
  }

  const headers = { 'Content-Type': 'application/json' };

  const timeoutMs = opts.timeout || FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(TIMEOUT_REASON()), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include', // send httpOnly session cookies
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  // 401 → silent refresh via cookie, then retry once.
  if (res.status === 401 && !_retried && isAuthed()) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      return request(method, path, body, true, opts);
    }
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    // MFA-gated admin route hit without a verified second factor for this
    // session (e.g. the marker was lost on token rotation). Broadcast so the
    // app can offer in-session step-up verification instead of a dead-end
    // error. Callers still receive the thrown error as usual.
    if (typeof window !== 'undefined' && res.status === 403 && errorBody?.code === 'mfa_challenge_required') {
      window.dispatchEvent(new CustomEvent('rentech:mfa-challenge'));
    }
    const err = new Error(errorBody.error || `Request failed with status ${res.status}`);
    err.status = res.status;
    err.body = errorBody;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

async function downloadBlob(path, filename, _retried = false) {
  // Demo mode: synthesize the file in-browser — no backend to stream from.
  if (isDemoMode()) {
    const data = await demoRequest('GET', path, {});
    const blob = new Blob([JSON.stringify(data ?? { demo: true }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }
  const headers = {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers,
      credentials: 'include',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  // A 401 here (expired token mid-session) should silently refresh + retry once,
  // matching the JSON request path — otherwise CSV exports fail after long idle.
  if (res.status === 401 && !_retried && isAuthed()) {
    const refreshed = await refreshOnce();
    if (refreshed) return downloadBlob(path, filename, true);
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const err = new Error(errorBody.error || `Download failed with status ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, false, opts),
  post: (path, body, opts) => request('POST', path, body, false, opts),
  put: (path, body, opts) => request('PUT', path, body, false, opts),
  patch: (path, body, opts) => request('PATCH', path, body, false, opts),
  delete: (path, opts) => request('DELETE', path, undefined, false, opts),
  download: (path, filename) => downloadBlob(path, filename),
};
