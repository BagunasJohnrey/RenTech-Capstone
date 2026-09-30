// Frontend-only demo mode: lets you run and view the full app with mock data
// and NO backend and NO Supabase. Enabled via Vite env or URL flag:
//   - .env.demo:            VITE_DEMO_MODE=true
//   - or run:               npm run demo   (script sets it automatically)
//   - or browse:            http://localhost:5173/?demo=1
//   - or switch role live:  ?demo=admin | ?demo=staff | ?demo=customer
//
// The demo interceptor (utils/demoInterceptor.js) short-circuits every api.*
// call before fetch — nothing leaves the browser. A banner is rendered in
// AppLayout so it's obvious the app is running on mock data. Production
// builds never include this path (import.meta.env.DEV gate + the flag is
// absent from production .env files).

const DEMO_KEY = 'rentech_demo_role';

export const DEMO_ROLES = ['Admin', 'Staff', 'Customer'];

function fromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('demo');
    if (!v) return null;
    if (v === '1' || v === 'true' || v === '') return 'Customer';
    const cap = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
    return DEMO_ROLES.includes(cap) ? cap : 'Customer';
  } catch {
    return null;
  }
}

// Demo mode is ON when: dev/demo build + (env flag, ?demo= URL flag, or a
// previously stored role). The stored-role check matters: getDemoRole()
// strips ?demo= from the URL after reading it, so without it plain-dev
// demo sessions would silently fall back to the real backend on the second
// request. When on, the effective role = URL flag → stored role → Admin.
export function storedDemoRole() {
  try {
    const s = localStorage.getItem(DEMO_KEY);
    return s && DEMO_ROLES.includes(s) ? s : null;
  } catch {
    return null;
  }
}

export function isDemoMode() {
  if (!(import.meta.env.VITE_DEMO_MODE === 'true' || fromUrl() || storedDemoRole())) return false;
  // Only ever active in a dev-like build — belt and suspenders so a stray
  // env flag can't ship mock data in production.
  return import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true';
}

export function getDemoRole() {
  const fromLink = fromUrl();
  if (fromLink) {
    try { localStorage.setItem(DEMO_KEY, fromLink); } catch { /* ignore */ }
    // Clean the ?demo= param so refreshing keeps the stored role without
    // the URL growing stale flags.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('demo');
      window.history.replaceState({}, document.title, url.pathname + (url.search || '') + url.hash);
    } catch { /* ignore */ }
    return fromLink;
  }
  const stored = storedDemoRole();
  if (stored) return stored;
  return 'Admin';
}

export function setDemoRole(role) {
  if (!DEMO_ROLES.includes(role)) return;
  try { localStorage.setItem(DEMO_KEY, role); } catch { /* ignore */ }
  // Full reload so every hook remounts with the new role's mock data.
  window.location.href = '/';
}
