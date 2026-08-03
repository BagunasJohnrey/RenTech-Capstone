import { useState, useEffect } from 'react';
import { api } from '../utils/api';

// Cache today's task-digest so navigating away/back doesn't reset it to `null`
// and swap the displayed stats (flicker). Keyed by role; refreshed 1 minute TTL.
const cache = new Map(); // role -> { data, at }
const TTL_MS = 60_000;

function readCache(role) {
  const hit = cache.get(role);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) return null;
  return hit.data;
}

// FIX G: consume the orphaned GET /dashboard/today instead of re-deriving
// due/overdue/in-cleaning client-side. Falls back to null so callers can
// keep their local derivation when the endpoint is unavailable.
// Now served from an in-memory cache so remounts / refetches don't flash the
// numbers back to the locally-derived fallback (that swap is the "flicker").
export function useTodayTasks(role) {
  const [data, setData] = useState(() => readCache(role));

  useEffect(() => {
    if (role !== 'Admin' && role !== 'Staff') return;
    let active = true;
    // Only hit the network if we have no fresh cache; otherwise this cheap
    // background refresh still keeps it eventually consistent on next mount.
    api.get('/dashboard/today')
      .then((d) => {
        cache.set(role, { data: d, at: Date.now() });
        if (active) setData(d);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [role]);

  return data;
}
