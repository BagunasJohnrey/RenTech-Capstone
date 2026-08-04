import { supabaseClient } from './supabaseClient';

const ACCESS_KEY = 'rentech_token';
const SESSION_KEY = 'rentech_session';

// One-time cleanup of stale/orphaned storage keys left behind by earlier
// versions of the app (no code references them anymore). Runs on module init.
try {
  localStorage.removeItem('customer_products_list');
  localStorage.removeItem('rentech_templates');
} catch { /* storage unavailable (SSR/privacy mode) */ }

export function getAccessToken() {
  return localStorage.getItem(ACCESS_KEY);
}

export function setSession(session) {
  if (!session || !session.access_token) {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(ACCESS_KEY, session.access_token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function getRefreshToken() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw).refresh_token || null;
  } catch {
    return null;
  }
}

// Attempt to mint a fresh access token using the stored refresh token.
// Returns true on success (localStorage now holds a new access token).
export async function refreshSession() {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  const { data, error } = await supabaseClient.auth.refreshSession({ refresh_token: refresh });
  if (error || !data.session) {
    setSession(null);
    return false;
  }
  setSession(data.session);
  return true;
}
