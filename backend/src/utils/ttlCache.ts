// Tiny in-memory TTL cache for the dashboard/AI endpoints. Each query on its
// own is cheap, but the AI Insights page fans out into many per request — and
// against a remote Supabase pooler the cost is latency (round trips), not
// throughput. We cache 60s so repeated loads / range toggles are instant; a
// miss or expired entry recomputes automatically (the "no data → refresh" case).
// Mutating services (new booking, return, status change, payment) call
// clearDataCache() so the dashboard never shows numbers older than the change.
// 5 minutes. Long TTL is safe because every mutation path (booking, return,
// cancel, edit, release, item status/price change, payment webhook, overdue
// scheduler) calls clearDataCache() — so the cache is only stale for data
// that changed outside the app, which can't happen here.
const TTL_MS = 5 * 60_000;
const store = new Map<string, { data: unknown; at: number }>();

export function clearDataCache() {
  store.clear();
}

export async function cacheOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at <= TTL_MS) return hit.data as T;
  const data = await compute();
  store.set(key, { data, at: Date.now() });
  return data;
}