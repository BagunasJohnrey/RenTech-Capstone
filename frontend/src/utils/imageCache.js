// Shared signed-URL cache for private-bucket item photos. A signed URL lives
// for 3600s on the backend, so cache it for 3600s minus a 60s safety margin
// and never serve one that has expired. Two layers:
//  - in-memory Map: stops refetch/flicker while navigating within the session
//  - sessionStorage write-through: survives an F5 refresh but clears when the
//    tab closes (correct for short-lived signed URLs). Never localStorage.
const TTL = (3600 - 60) * 1000; // 59 minutes
const STORE_KEY = 'rt_img_cache_v1';

const mem = new Map(); // path -> { url, expiresAt }
const pending = new Map(); // path -> Promise<string|null> (dedupe concurrent fetches)

let store = {};
try {
  store = JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}');
} catch {
  store = {};
}

function persist() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // storage full / unavailable — in-memory cache still works for this tab
  }
}

function getFresh(path) {
  const now = Date.now();
  const hit = mem.get(path) || store[path];
  if (hit && hit.url && hit.expiresAt > now) {
    mem.set(path, hit);
    return hit.url;
  }
  return null;
}

function put(path, url) {
  const entry = { url, expiresAt: Date.now() + TTL };
  mem.set(path, entry);
  store[path] = entry;
  persist();
  return url;
}

// fetcher: () => Promise<string|null> resolving to a fresh signed URL.
// Returns the cached URL when still fresh, else fetches, caches, and returns.
export async function resolve(path, fetcher) {
  if (!path) return null;
  const cached = getFresh(path);
  if (cached) return cached;

  if (pending.has(path)) return pending.get(path);

  const job = (async () => {
    try {
      const url = await fetcher();
      if (url) return put(path, url);
      return null;
    } catch {
      return null;
    } finally {
      pending.delete(path);
    }
  })();
  pending.set(path, job);
  return job;
}

export const imageCache = { resolve };
export default imageCache;
