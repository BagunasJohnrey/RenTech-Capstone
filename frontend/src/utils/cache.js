// Tiny stale-while-revalidate cache for admin Settings panels (System
// Integrations, Data Backups, Saved AI Reports). Each entry is persisted to
// localStorage as { data, at } so a remount / tab switch paints the last-known
// server data instantly, then refreshes silently in the background. The `at`
// timestamp powers the "Status 5 mins ago" / "Updated 5 mins ago" labels.

export function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed) || !('at' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, at: Date.now() }));
  } catch {
    // Storage full / private mode — caching is best-effort, never fatal.
  }
}

export function clearCache(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// "Just now" / "5 mins ago" / "2 hours ago" / "Yesterday" / "Mar 3".
// Takes either an epoch-ms timestamp or an ISO string.
export function formatCheckedAgo(at) {
  if (at == null) return '';
  const ms = typeof at === 'number' ? at : new Date(at).getTime();
  if (Number.isNaN(ms)) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return 'Just now';
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'Just now';
  if (s < 60) return `${s} secs ago`;
  const m = Math.floor(s / 60);
  if (m === 1) return '1 min ago';
  if (m < 60) return `${m} mins ago`;
  const h = Math.floor(m / 60);
  if (h === 1) return '1 hour ago';
  if (h < 24) return `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(ms).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const CACHE_KEYS = {
  INTEGRATIONS: 'rentech_cache_integrations',
  BACKUPS: 'rentech_cache_backups',
  AI_REPORTS: 'rentech_cache_ai_reports',
};
