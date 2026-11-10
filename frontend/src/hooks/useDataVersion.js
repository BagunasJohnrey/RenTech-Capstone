import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../utils/api';
import { emitDataChanged } from '../utils/dataEvents';

// Cross-device freshness: polls the tiny GET /dashboard/version fingerprint
// (~100 bytes: max updatedAt + row counts) and reports when it MOVES, so the
// app refetches heavy lists only on real change — not on a timer.
//
// Design rules:
//   - Auto-refresh: when the version moves we call `onStale` (App re-pulls
//     the lists silently, in place — no skeleton, no Refresh button) and
//     broadcast `rentech:data-changed` so self-fetching widgets (today
//     digest, KPIs, proof queue) refetch too. Open modals keep their own
//     state, so nobody's in-progress form is reset.
//   - Own writes don't trip it: call `markFresh()` after every local
//     mutation (the refetch those handlers already do brings us current).
//   - Keeps checking in background tabs (see `check`), so a tab you return
//     to is already up to date.
//   - Staff/Admin only: customers poll nothing (their data barely changes
//     under them; History refetches on mount anyway).
// 20s: the fingerprint is ~100 bytes, and changes now show up on their own
// (no Refresh tap), so a shorter gap is worth it. Focus/visibility still
// checks instantly; background tabs keep polling (browser-throttled).
const POLL_MS = 20_000;

// Comparison key: max updatedAt alone misses deletes and logbook imports
// (no row's updatedAt moves), so the row counts are folded in.
const versionKey = (v) => [v?.version ?? 0, v?.txCount ?? '', v?.itemCount ?? '', v?.recordCount ?? ''].join(':');

export function useDataVersion({ role, isLoggedIn, onStale }) {
  const [stale, setStale] = useState(false);
  const [serverVersion, setServerVersion] = useState(null);
  const knownRef = useRef(null); // last version we consider "seen"
  const onStaleRef = useRef(onStale);
  onStaleRef.current = onStale;

  // Runs in background tabs too: a tab you're not looking at should already
  // be current when you switch back (staff often keep Tasks open in one tab
  // and release/return from another). Cheap — the server answers from its
  // in-memory cache, which every write clears. Browsers throttle hidden-tab
  // timers to about once a minute, so background checks are slower still.
  const check = useCallback(async () => {
    try {
      const v = await api.get('/dashboard/version');
      const ver = versionKey(v);
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
        emitDataChanged(v);
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
      knownRef.current = v ? versionKey(v) : knownRef.current;
      setServerVersion(knownRef.current);
    } catch { /* next poll covers it */ }
  }, []);

  const clearStale = useCallback(() => setStale(false), []);

  return { stale, serverVersion, markFresh, clearStale, recheck: check };
}
