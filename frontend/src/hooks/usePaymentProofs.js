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
  const fetchedAt = useRef(cache.get(`${key}:at`) ?? 0);

  const refresh = useCallback(async () => {
    try {
      const fresh = await listProofs();
      cache.set(key, fresh);
      cache.set(`${key}:at`, Date.now());
      fetchedAt.current = Date.now();
      setData(fresh);
    } catch {
      // keep last good data; the poll retries
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!cache.has(key) || Date.now() - fetchedAt.current > POLL_MS) refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  return { data, loading, refresh };
}

export default usePaymentProofs;
