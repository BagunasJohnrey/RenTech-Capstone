import { refreshSession } from './authSession';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

let tokenGetter = null;

export function setTokenGetter(fn) {
  tokenGetter = fn;
}

const FETCH_TIMEOUT_MS = 20000; // abort requests the server never answers

// A short, human-readable abort reason so timeouts surface as "the request took
// too long" instead of the cryptic "signal was aborted without any reason".
const TIMEOUT_REASON = () =>
  new DOMException('The request took too long. The server may be offline — please try again.', 'TimeoutError');

async function request(method, path, body = undefined, _retried = false, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = tokenGetter ? tokenGetter() : null;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const timeoutMs = opts.timeout || FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(TIMEOUT_REASON()), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 && !_retried) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request(method, path, body, true, opts);
    }
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const err = new Error(errorBody.error || `Request failed with status ${res.status}`);
    err.status = res.status;
    err.body = errorBody;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

async function downloadBlob(path, filename, _retried = false) {
  const headers = {};
  const token = tokenGetter ? tokenGetter() : null;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  // A 401 here (expired token mid-session) should silently refresh + retry once,
  // matching the JSON request path — otherwise CSV exports fail after long idle.
  if (res.status === 401 && !_retried) {
    const refreshed = await refreshSession();
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
