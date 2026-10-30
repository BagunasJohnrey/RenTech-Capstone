import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../utils/api';

// SWR-style cache: the initial render always seeds from the last-known server
// data (up to 10 min old), so tab switches / remounts paint numbers instantly
// instead of flashing client-derived fallbacks or a skeleton. The mount effect
// then refreshes the snapshot in the background — the update is silent, never
// a visible swap.
const cache = new Map(); // role -> { data, at }
const MAX_STALE_MS = 10 * 60_000;

function readCache(role) {
  const hit = cache.get(role);
  if (!hit) return null;
  if (Date.now() - hit.at > MAX_STALE_MS) return null;
  return hit.data;
}

// Poll cadence for the live surfaces (due/overdue/cleaning change as staff
// work). The 10-min SWR cache above stays as the instant-paint fallback.
const POLL_MS = 45_000;

function poll(fn) {
  fn();
  return setInterval(fn, POLL_MS);
}

// Server-authoritative today-digest (due/overdue/cleaning) — see readCache for
// the SWR behavior. Falls back to null so callers can keep their local
// derivation when nothing has been fetched yet this session.
//
// `{ withStatus: true }` returns `{ data, error, retry }` instead of the bare
// data, so a screen can show "Couldn't load - Retry" rather than an endless
// skeleton. Existing callers keep getting the plain data.
export function useTodayTasks(role, { withStatus = false } = {}) {
  const [data, setData] = useState(() => readCache(role));
  const [error, setError] = useState(null);
  const fetchRef = useRef(null);

  useEffect(() => {
    if (role !== 'Admin' && role !== 'Staff') return;
    let active = true;
    const fetchDigest = () => {
      api.get('/dashboard/today')
        .then((d) => {
          cache.set(role, { data: d, at: Date.now() });
          if (active) { setData(d); setError(null); }
        })
        .catch((err) => { if (active) setError(err || new Error('Failed to load')); });
    };
    fetchRef.current = fetchDigest;
    const id = poll(fetchDigest);
    return () => { active = false; fetchRef.current = null; clearInterval(id); };
  }, [role]);

  const retry = useCallback(() => {
    setError(null);
    fetchRef.current?.();
  }, []);

  return withStatus ? { data, error, retry } : data;
}

// Server-authoritative business KPIs (monthly revenue, utilization, rates…)
// from GET /dashboard/kpis — cached the same way as the today-digest.
const kpisCache = new Map(); // role -> { data, at }

function readKpisCache(role) {
  const hit = kpisCache.get(role);
  if (!hit) return null;
  if (Date.now() - hit.at > MAX_STALE_MS) return null;
  return hit.data;
}

export function useKpis(role) {
  const [data, setData] = useState(() => (role === 'Admin' ? readKpisCache(role) : null));

  useEffect(() => {
    if (role !== 'Admin') return;
    let active = true;
    const fetchKpis = () => {
      api.get('/dashboard/kpis')
        .then((d) => {
          kpisCache.set(role, { data: d, at: Date.now() });
          if (active) setData(d);
        })
        .catch(() => {});
    };
    const id = poll(fetchKpis);
    return () => { active = false; clearInterval(id); };
  }, [role]);

  return data;
}
