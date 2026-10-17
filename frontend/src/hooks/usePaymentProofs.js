import { useCallback, useEffect, useRef, useState } from 'react';
import { listProofs } from '../services/payments';

// Manual-QR review queue: same SWR discipline as useDashboard.js (instant paint
// from the last-known queue, silent background refresh) — but proofs age fast
// (customers upload between staff glances), so the poll runs every 45s and a
// stale-but-last-known queue is still shown while the refresh is in flight.
const POLL_MS = 45_000;
const cache = new Map();

export function usePaymentProofs(enabled) {
  const key = 'payment-proofs:queue';
  const [data, setData] = useState(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(!cache.has(key));
  const [error, setError] = useState(null);
  const fetchedAt = useRef(cache.get(`${key}:at`) ?? 0);

  const refresh = useCallback(async () => {
    try {
      const fresh = await listProofs();
      cache.set(key, fresh);
      cache.set(`${key}:at`, Date.now());
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
      if (cache.has(key)) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!cache.has(key) || Date.now() - fetchedAt.current > POLL_MS) refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  return { data, loading, error, refresh };
}

export default usePaymentProofs;
