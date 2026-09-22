// Real URL routing for the tab model. The app switches views by tab id
// (Dashboard/Catalog/…); this maps every tab to a real path so each view is
// deep-linkable and the browser back/forward buttons work. Paths are
// role-scoped (/admin/..., /staff/..., customer /...). Single source of
// truth for routing — nav item lists keep using tab ids.
export const TAB_PATHS = {
  Admin: {
    Dashboard: '/admin',
    Catalog: '/admin/inventory',
    Promotions: '/admin/promotions',
    History: '/admin/transactions',
    'AI Insights': '/admin/ai-insights',
    Messages: '/admin/messages',
    Notifications: '/admin/notifications',
    Settings: '/admin/settings',
  },
  Staff: {
    Dashboard: '/staff',
    Tasks: '/staff/tasks',
    Catalog: '/staff/catalog',
    Promotions: '/staff/promotions',
    History: '/staff/logs',
    Notifications: '/staff/notifications',
    Settings: '/staff/settings',
  },
  Customer: {
    Home: '/',
    Catalog: '/collection',
    History: '/transactions',
    Notifications: '/notifications',
    Profile: '/profile',
    Help: '/help',
  },
};

export const HOME_PATH = {
  Admin: '/admin',
  Staff: '/staff',
  Customer: '/',
};

// Public signed-out routes (no role required). Sign-in and the guest
// collection are real URLs so they are deep-linkable, survive new tabs /
// refresh, and work with back/forward — not just in-memory view state.
export const SIGN_IN_PATH = '/sign-in';
export const GUEST_COLLECTION_PATH = '/collection';

const HOME_TAB = { Admin: 'Dashboard', Staff: 'Dashboard', Customer: 'Home' };

export function tabPath(role, tabId) {
  return TAB_PATHS[role]?.[tabId] ?? HOME_PATH[role] ?? '/';
}

// Reverse lookup: which tab id does this URL belong to for this role?
// Returns null when the path isn't one of the role's tabs (e.g. a staff user
// opening an admin URL) so the caller can redirect to the role's home.
export function tabFromPath(role, pathname) {
  const clean = String(pathname || '').replace(/\/+$/, '') || '/';
  const map = TAB_PATHS[role];
  if (!map) return null;
  for (const [tab, path] of Object.entries(map)) {
    if (path === clean) return tab;
  }
  return null;
}

export function homeTab(role) {
  return HOME_TAB[role] || 'Dashboard';
}

// ---- Detail routes (modal-on-URL) ----

export const ITEM_DETAIL_RE = /^\/(?:collection|admin\/inventory|staff\/catalog)\/(\d+)$/;
// Transactions use UUID primary keys (unlike inventory items, which are ints),
// so accept both digits and UUIDs here — previously the (\d+)-only matcher let
// staff/admin/customer deep-links to a transaction fall through to the 404 page.
export const TX_DETAIL_RE = /^\/(?:transactions|admin\/transactions|staff\/logs)\/([0-9a-fA-F-]{8,}|\d+)$/;

export function itemDetailPath(role, itemId) {
  if (role === 'Admin') return `/admin/inventory/${itemId}`;
  if (role === 'Staff') return `/staff/catalog/${itemId}`;
  return `/collection/${itemId}`;
}

export function txDetailPath(role, txId) {
  if (role === 'Admin') return `/admin/transactions/${txId}`;
  if (role === 'Staff') return `/staff/logs/${txId}`;
  return `/transactions/${txId}`;
}

// Which role owns this path? null = public/unknown. Used to show the
// Unauthorized page instead of silently redirecting when a user opens a URL
// that belongs to another role.
export function pathRequiresRole(pathname) {
  if (/^\/admin\b/.test(pathname)) return 'Admin';
  if (/^\/staff\b/.test(pathname)) return 'Staff';
  if (pathname === '/' || /^\/(collection|transactions|notifications|profile|help)(\/|$)/.test(pathname)) return 'Customer';
  return null;
}
