import { useCallback, useEffect, useRef, useState } from 'react';
import { listProofs } from '../services/payments';

// Manual-QR review queue: same SWR discipline as useDashboard.js (instant paint
// from the last-known queue, silent background refresh) — but proofs age fast
// (customers upload between staff glances), so the poll runs every 45s and a
// stale-but-last-known queue is still shown while the refresh is in flight.
const POLL_MS = 45_000;
const KEY = 'payment-proofs:queue';
const cache = new Map();
// One in-flight request shared by every mounted hook: the Tasks page mounts
// this twice (priority card + verification queue), and two cold GETs used to
// queue behind each other against the database. Prefetching (App boot) also
// rides the same promise, so a navigation never starts a duplicate fetch.
let inflight = null;

function loadQueue() {
  if (!inflight) {
    inflight = listProofs()
      .then((fresh) => {
        cache.set(KEY, fresh);
        cache.set(`${KEY}:at`, Date.now());
        return fresh;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

// Warm the queue while the staff member is still on the dashboard, so Tasks
// opens with proofs already in hand (the same idea as the today-digest's
// module cache). Safe to call from anywhere; failures stay silent.
export function prefetchPaymentProofs() {
  const at = cache.get(`${KEY}:at`) ?? 0;
  if (cache.has(KEY) && Date.now() - at <= POLL_MS) return;
  loadQueue().catch(() => {});
}

export function usePaymentProofs(enabled) {
  const [data, setData] = useState(() => cache.get(KEY) ?? null);
  const [loading, setLoading] = useState(!cache.has(KEY));
  const [error, setError] = useState(null);
  const fetchedAt = useRef(cache.get(`${KEY}:at`) ?? 0);

  const refresh = useCallback(async () => {
    try {
      const fresh = await loadQueue();
      fetchedAt.current = Date.now();
      setData(fresh);
      setError(null);
      setLoading(false);
    } catch (err) {
      // Keep the last good queue for the poll to refresh silently. On a FIRST
      // load there is no last-good data — surface the error and hold the
      // loading state so a failure is never mistaken for an empty queue
      // ("All clear" / a 0 badge) on the money-verification surface.
      setError(err);
      if (cache.has(KEY)) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!cache.has(KEY) || Date.now() - fetchedAt.current > POLL_MS) refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  return { data, loading, error, refresh };
}

export default usePaymentProofs;
