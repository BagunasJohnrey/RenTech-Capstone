import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../utils/api';

// Cross-device freshness: polls the tiny GET /dashboard/version fingerprint
// (~100 bytes: max updatedAt + row counts) and reports when it MOVES, so the
// app refetches heavy lists only on real change — not on a timer.
//
// Design rules:
//   - NEVER silent-swap: when the version moves we set `stale=true` and the
//     caller shows a "New data available → Refresh" affordance. Mid-work
//     staff are never yanked.
//   - Own writes don't trip it: call `markFresh()` after every local
//     mutation (the refetch those handlers already do brings us current).
//   - Quiet while hidden: no polling when the tab isn't visible.
//   - Staff/Admin only: customers poll nothing (their data barely changes
//     under them; History refetches on mount anyway).
const POLL_MS = 15_000;

export function useDataVersion({ role, isLoggedIn, onStale }) {
  const [stale, setStale] = useState(false);
  const [serverVersion, setServerVersion] = useState(null);
  const knownRef = useRef(null); // last version we consider "seen"
  const onStaleRef = useRef(onStale);
  onStaleRef.current = onStale;

  const check = useCallback(async () => {
    if (document.hidden) return;
    try {
      const v = await api.get('/dashboard/version');
      const ver = v?.version ?? 0;
      setServerVersion(ver);
      if (knownRef.current == null) {
        // First successful poll seeds the baseline — nothing is "new" yet.
        knownRef.current = ver;
        return;
      }
      if (ver !== knownRef.current) {
        knownRef.current = ver;
        setStale(true);
        onStaleRef.current?.(v);
      }
    } catch {
      // Offline / transient — stay quiet, retry next tick.
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn || (role !== 'Staff' && role !== 'Admin')) return;
    knownRef.current = null;
    setStale(false);
    let id = null;
    // Seed on mount, then poll. Baseline seeds from the first success, so a
    // slow first fetch can't false-positive.
    check();
    id = setInterval(check, POLL_MS);
    // Refetch on focus/visibility return: the cheapest catch-up signal.
    const onVisible = () => {
      if (!document.hidden) check();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (id) clearInterval(id);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isLoggedIn, role, check]);

  // Call after every OWN mutation (create/return/release/payment/status):
  // our local state already reflects the write, so adopt the server version
  // instead of flagging ourselves stale. Best-effort — failure just means
  // the next poll may show Refresh once (harmless).
  const markFresh = useCallback(async () => {
    setStale(false);
    try {
      const v = await api.get('/dashboard/version');
      knownRef.current = v?.version ?? knownRef.current;
      setServerVersion(knownRef.current);
    } catch { /* next poll covers it */ }
  }, []);

  const clearStale = useCallback(() => setStale(false), []);

  return { stale, serverVersion, markFresh, clearStale, recheck: check };
}
