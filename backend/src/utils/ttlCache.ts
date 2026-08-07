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

// Background cache-warmer. `clearDataCache()` drops the whole store on every
// mutation, so the very next dashboard hit would pay the full query cost (~200
// ms per round trip against the remote pooler) if we only warmed lazily. A
// single registered warmer refills the hot keys (KPIs, today digest, insights,
// forecast, inventory analytics) right after a mutation, so by the time staff
// navigates back the numbers are already cached. The guard collapses a burst
// of rapid mutations into one recompute.
type Warmer = () => void | Promise<unknown>;
let warmFn: Warmer | null = null;
let warming = false;

export function clearDataCache() {
  store.clear();
  if (warmFn && !warming) {
    warming = true;
    Promise.resolve()
      .then(() => warmFn!())
      .catch(() => {})
      .finally(() => { warming = false; });
  }
}

// Registered once from the dashboard service (which transitively imports this
// module) to avoid a circular import. The warmer is fire-and-forget and only
// refills the hot, always-needed keys.
export function setDataCacheWarmer(fn: Warmer) {
  warmFn = fn;
}

export async function cacheOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at <= TTL_MS) return hit.data as T;
  const data = await compute();
  store.set(key, { data, at: Date.now() });
  return data;
}
