import { refreshSession } from './authSession';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

let tokenGetter = null;

export function setTokenGetter(fn) {
  tokenGetter = fn;
}

async function request(method, path, body = undefined, _retried = false) {
  const headers = { 'Content-Type': 'application/json' };
  const token = tokenGetter ? tokenGetter() : null;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !_retried) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request(method, path, body, true);
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

async function downloadBlob(path, filename) {
  const headers = {};
  const token = tokenGetter ? tokenGetter() : null;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { headers });

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
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
  download: (path, filename) => downloadBlob(path, filename),
};
