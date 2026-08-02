import { useState, useEffect } from 'react';
import { api } from '../utils/api';

// FIX G: consume the orphaned GET /dashboard/today instead of re-deriving
// due/overdue/in-cleaning client-side. Falls back to null so callers can
// keep their local derivation when the endpoint is unavailable.
export function useTodayTasks(role) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (role !== 'Admin' && role !== 'Staff') return;
    let active = true;
    api.get('/dashboard/today')
      .then((d) => { if (active) setData(d); })
      .catch(() => {});
    return () => { active = false; };
  }, [role]);
  return data;
}
