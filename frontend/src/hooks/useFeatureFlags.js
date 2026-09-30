import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

const DEFAULTS = { qr_codes: true };

// Feature flags (currently just `qr_booking_codes` from the backend). Fetched
// once per session and cached on window so every component shares one value.
// Returns the flags object plus `refreshFlags()` (re-fetch). When the flag is
// changed in Settings the page dispatches `rentech:flags-changed` and every
// mounted consumer re-fetches, so toggles apply app-wide without a reload.
export function useFeatureFlags() {
  const [flags, setFlags] = useState(() => window.__featureFlags || DEFAULTS);
  // True once the server value (or its failure) has resolved this session.
  // Consumers with show/hide sections (e.g. Booking QR) should gate on this
  // instead of the optimistic default — otherwise the section flashes on
  // first open whenever the server value differs from DEFAULTS.
  const [loaded, setLoaded] = useState(() => !!window.__featureFlags);

  const refreshFlags = useCallback(async () => {
    try {
      const data = await api.get('/settings/flags');
      const next = { ...DEFAULTS, qr_codes: data?.qr_booking_codes !== false };
      window.__featureFlags = next;
      setFlags(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    const apply = (data) => {
      const next = { ...DEFAULTS, qr_codes: data?.qr_booking_codes !== false };
      window.__featureFlags = next;
      if (active) {
        setFlags(next);
        setLoaded(true);
      }
    };
    const onFlagsChanged = () => {
      api.get('/settings/flags').then(apply).catch(() => {});
    };
    window.addEventListener('rentech:flags-changed', onFlagsChanged);
    // Already resolved earlier this session — nothing to wait for.
    if (window.__featureFlags) {
      setLoaded(true);
    } else {
      api.get('/settings/flags').then(apply).catch(() => { if (active) setLoaded(true); });
    }
    return () => {
      active = false;
      window.removeEventListener('rentech:flags-changed', onFlagsChanged);
    };
  }, []);

  return { ...flags, flagsLoaded: loaded, refreshFlags };
}
