// Demo-mode API interceptor: when demo mode is on, every api.get/post/put/
// patch/delete call is answered here with in-memory mock data — the request
// never reaches fetch(), so no backend and no Supabase are needed. Mutations
// update the in-memory store so the UI behaves realistically (add/edit/status
// changes "stick" for the session).

import { getDemoRole } from './demoMode';

// ─── Mock data ────────────────────────────────────────────────────────────

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
};

const PROFILES = {
  Admin: {
    id: 'demo-admin-profile', userId: 'demo-admin', email: 'admin@rentech.demo',
    role: 'Admin', name: 'Mylene (Demo Admin)', phone: '09171234567',
    address: 'Balayan, Batangas', preferences: 'Gown,Suit', mfaEnabled: false,
  },
  Staff: {
    id: 'demo-staff-profile', userId: 'demo-staff', email: 'staff@rentech.demo',
    role: 'Staff', name: 'Kai (Demo Staff)', phone: '09181234567',
    address: 'Balayan, Batangas', preferences: '', mfaEnabled: false,
  },
  Customer: {
    id: 'demo-customer-profile', userId: 'demo-customer', email: 'juan@rentech.demo',
    role: 'Customer', name: 'Juan Dela Cruz (Demo)', phone: '09191234567',
    address: '123 Rizal St, Balayan, Batangas', preferences: 'Gown,Costume',
    styleNotes: 'Prefers deep colors', notifyPrefs: { reminder: true, lateReturn: true },
  },
};

// Use stable, CORS-friendly placeholder images so the catalog looks real.
const IMG = (seed) => `https://picsum.photos/seed/${seed}/800/1000`;

let items = [
  { id: 1, name: 'Ivory Lace Wedding Gown', category: 'Gown', price: 3500, status: 'Available', effectiveStatus: 'Available', image: IMG('gown1'), description: 'Elegant cathedral-train lace gown.', size: 'M', onSale: true, discountPct: 15, salePrice: null, saleEndsAt: null },
  { id: 2, name: 'Midnight Blue Barong Tagalog', category: 'Barong', price: 1500, status: 'Available', effectiveStatus: 'Available', image: IMG('barong1'), description: 'Classic piña barong with mother-of-pearl buttons.', size: 'L', onSale: false, discountPct: null, salePrice: null, saleEndsAt: null },
  { id: 3, name: 'Rose Gold Filipiniana', category: 'Filipiniana', price: 2200, status: 'Rented', effectiveStatus: 'Rented', image: IMG('fili1'), description: 'Modern terno with butterfly sleeves.', size: 'S', onSale: false, discountPct: null, salePrice: null, saleEndsAt: null },
  { id: 4, name: 'Charcoal Three-Piece Suit', category: 'Suit', price: 2000, status: 'Available', effectiveStatus: 'Available', image: IMG('suit1'), description: 'Slim-fit wool suit, includes tie.', size: 'XL', onSale: false, discountPct: null, salePrice: 1600, saleEndsAt: null },
  { id: 5, name: 'Maria Clara Gala Gown', category: 'Gown', price: 4000, status: 'Cleaning', effectiveStatus: 'Cleaning', image: IMG('gown2'), description: 'Heritage-inspired formal gown.', size: 'M', onSale: false, discountPct: null, salePrice: null, saleEndsAt: null },
  { id: 6, name: 'Debutante Ball Gown', category: 'Gown', price: 3800, status: 'Available', effectiveStatus: 'Available', image: IMG('gown3'), description: 'Tulle ballgown with beaded bodice.', size: 'S', onSale: false, discountPct: null, salePrice: null, saleEndsAt: null },
  { id: 7, name: 'Barong for Kids', category: 'Barong', price: 800, status: 'OutOfService', effectiveStatus: 'OutOfService', outOfServiceReason: 'Missing two buttons', image: IMG('barong2'), description: 'Boys barong for ages 8–10.', size: 'Kids', onSale: false, discountPct: null, salePrice: null, saleEndsAt: null },
  { id: 8, name: 'Spanish-Era Costume Set', category: 'Costume', price: 2600, status: 'Available', effectiveStatus: 'Available', image: IMG('costume1'), description: 'Complete outfit for plays & festivals.', size: 'M', onSale: false, discountPct: null, salePrice: null, saleEndsAt: null },
];

const CUSTOMERS = {
  'demo-customer-profile': { id: 'demo-customer-profile', userId: 'demo-customer', name: 'Juan Dela Cruz (Demo)', email: 'juan@rentech.demo', phone: '09191234567', address: '123 Rizal St, Balayan, Batangas' },
  'c-maria': { id: 'c-maria', name: 'Maria Santos', email: 'maria@example.com', phone: '09170001111', address: 'Taal, Batangas' },
  'c-pedro': { id: 'c-pedro', name: 'Pedro Reyes', email: 'pedro@example.com', phone: '09170002222', address: 'Calatagan, Batangas' },
};

const tx = (id, itemId, customerId, status, startOff, dueOff, fee, paid) => {
  const item = items.find((i) => i.id === itemId);
  const customer = CUSTOMERS[customerId];
  return {
    id, txNumber: id, itemId, status,
    customerId, processedById: 'demo-staff-profile',
    rentalDate: day(startOff), dueDate: day(dueOff),
    date: day(startOff),
    rentalFee: fee, downpayment: Math.round(fee * 0.5), totalPaid: paid,
    latePenalty: 0, damageFee: 0,
    notes: '', size: item?.size ?? null,
    item: item ? { id: item.id, name: item.name, category: item.category, image: item.image, price: item.price } : null,
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone, address: customer.address } : null,
    createdAt: day(startOff),
  };
};

let transactions = [
  tx('11111111-1111-4111-8111-111111111111', 3, 'c-maria', 'Active', -2, 2, 2200, 1100),
  tx('22222222-2222-4222-8222-222222222222', 5, 'c-pedro', 'Overdue', -6, -1, 4000, 2000),
  tx('33333333-3333-4333-8333-333333333333', 1, 'demo-customer-profile', 'Returned', -10, -6, 3500, 3500),
  tx('44444444-4444-4444-8444-444444444444', 6, 'c-maria', 'Reserved', 1, 4, 3800, 0),
  tx('55555555-5555-4555-8555-555555555555', 8, 'demo-customer-profile', 'Active', -1, 3, 2600, 1300),
];

let notifications = [
  { id: 'n1', type: 'new_booking', title: 'New booking', message: 'Juan Dela Cruz booked Debutante Ball Gown.', isRead: false, createdAt: day(-1) + 'T09:00:00Z' },
  { id: 'n2', type: 'overdue', title: 'Overdue return', message: 'Maria Clara Gala Gown is 5 days overdue.', isRead: false, createdAt: day(-1) + 'T10:30:00Z' },
  { id: 'n3', type: 'late_return', title: 'Late return', message: 'Ivory Lace Wedding Gown returned late.', isRead: true, createdAt: day(-2) + 'T14:00:00Z' },
];

let staff = [
  { id: 'demo-staff-profile', email: 'staff@rentech.demo', name: 'Kai (Demo Staff)', phone: '09181234567', createdAt: day(-30) },
  { id: 's-2', email: 'ana@rentech.demo', name: 'Ana (Demo Staff 2)', phone: null, createdAt: day(-12) },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

const clone = (v) => JSON.parse(JSON.stringify(v));

function kpis() {
  return {
    monthlyRevenue: 38500, prevMonthRevenue: 31200,
    totalItems: items.length, activeRentals: transactions.filter((t) => t.status === 'Active').length,
    overdueReturns: transactions.filter((t) => t.status === 'Overdue').length,
    returnedCount: transactions.filter((t) => t.status === 'Returned').length,
    cancelledCount: transactions.filter((t) => t.status === 'Cancelled').length,
    utilizationRate: 42, availableCount: items.filter((i) => i.status === 'Available').length,
  };
}

function todayDigest() {
  const dueTodayTxs = transactions.filter((t) => t.status === 'Active' && t.dueDate && t.dueDate.split('T')[0] <= day(0));
  const overdueTxs = transactions.filter((t) => t.status === 'Overdue');
  return {
    dueToday: clone(dueTodayTxs),
    overdue: clone(overdueTxs),
    inCleaning: items.filter((i) => i.status === 'Cleaning').length,
    pickups: clone(transactions.filter((t) => (t.rentalDate ?? '').split('T')[0] === day(0) && (t.status === 'Active' || t.status === 'Reserved'))),
  };
}

const analytics = () => ({
  totalItems: items.length,
  byStatus: ['Available', 'Rented', 'Reserved', 'Cleaning', 'OutOfService'].map((s) => ({
    status: s, count: items.filter((i) => i.status === s).length,
  })),
  byCategory: [...new Set(items.map((i) => i.category))].map((c) => ({
    category: c, count: items.filter((i) => i.category === c).length,
    avgPrice: Math.round(items.filter((i) => i.category === c).reduce((a, i) => a + i.price, 0) / items.filter((i) => i.category === c).length),
  })),
  monthlyRevenue: [
    { month: 'Jan', revenue: 18000 }, { month: 'Feb', revenue: 22000 },
    { month: 'Mar', revenue: 26000 }, { month: 'Apr', revenue: 31200 },
    { month: 'May', revenue: 34500 }, { month: 'Jun', revenue: 38500 },
  ],
});

const insights = () => [
  { title: 'Gowns are your top category', detail: 'Gowns account for the largest share of bookings this quarter.' },
  { title: 'Weekend demand spikes', detail: 'Friday–Saturday pickups are 3× weekday volume.' },
];

const forecast = () => ({ expectedRevenue: 41000, trend: 'up', months: analytics().monthlyRevenue });

function bundle() {
  return {
    kpis: kpis(),
    today: todayDigest(),
    insights: insights(),
    forecast: forecast(),
    analytics: analytics(),
    generatedAt: new Date().toISOString(),
  };
}

// ─── Router ────────────────────────────────────────────────────────────────
// Returns { match, handle } where handle(body) produces the response.

function route(method, path, body) {
  const role = getDemoRole();
  const P = (re) => {
    const m = path.match(re);
    return m;
  };

  // ---- Auth ----
  if (path === '/auth/me') return { value: PROFILES[role] };
  if (path === '/auth/login') return { value: { user: PROFILES[role], requiresMfa: false, mustChangePassword: false } };
  if (path === '/auth/logout') return { value: { message: 'Logged out (demo)' } };
  if (path === '/auth/refresh') return { value: { user: PROFILES[role] } };
  if (path === '/auth/staff' && method === 'GET') return { value: clone(staff) };
  if (path === '/auth/staff' && method === 'POST') {
    const created = { id: 's-' + Date.now(), email: body.email, name: body.name, phone: body.phone ?? null, createdAt: new Date().toISOString() };
    staff.unshift(created);
    return { value: { ...created, oneTimePassword: 'Demo-OTP-123!x' } };
  }
  if (P(/^\/auth\/staff\/(.+)$/) && method === 'DELETE') {
    staff = staff.filter((s) => s.id !== P(/^\/auth\/staff\/(.+)$/)[1]);
    return { value: { message: 'Staff removed (demo)' } };
  }
  if (P(/^\/auth\/staff\/(.+)$/) && method === 'PUT') {
    const id = P(/^\/auth\/staff\/(.+)$/)[1];
    const it = staff.find((s) => s.id === id);
    if (!it) return { status: 404, error: 'Staff account not found' };
    Object.assign(it, body);
    if (role === 'Staff') PROFILES.Staff = { ...PROFILES.Staff, ...body };
    return { value: clone(it) };
  }
  if (path === '/auth/change-password') return { value: { message: 'Password updated (demo)' } };
  if (path === '/auth/verify-admin') return { value: { verified: true, admin: { name: 'Mylene (Demo Admin)' } } };
  if (path === '/auth/admin-pin' && method === 'GET') return { value: { configured: false } };

  // ---- Inventory ----
  if (P(/^\/inventory\/blocked-dates\/(\d+)$/)) return { value: [{ start: day(1), end: day(4) }, { start: day(10), end: day(12) }] };
  if (P(/^\/inventory\/analytics/)) return { value: analytics() };
  if (path === '/inventory/availability') {
    return { value: { available: true, conflicts: [] } };
  }
  if (path === '/inventory/bulk-status' && method === 'PATCH') {
    (body.ids ?? []).forEach((id) => {
      const it = items.find((i) => i.id === id);
      if (it) { it.status = body.status; it.effectiveStatus = body.status; }
    });
    return { value: { updated: body.ids?.length ?? 0 } };
  }
  if (P(/^\/inventory\/(\d+)$/) && method !== 'POST') {
    const id = Number(P(/^\/inventory\/(\d+)$/)[1]);
    const it = items.find((i) => i.id === id);
    if (!it) return { status: 404, error: 'Item not found' };
    if (method === 'PUT') {
      Object.assign(it, body);
      it.effectiveStatus = it.status;
      return { value: clone(it) };
    }
    return { value: clone(it) };
  }
  if (path === '/inventory' && method === 'GET') {
    const qs = path.split('?')[1];
    void qs;
    return { value: clone(items).map((i) => ({ ...i })) };
  }
  if (path === '/inventory' && method === 'POST') {
    const created = { id: Math.max(...items.map((i) => i.id)) + 1, effectiveStatus: body.status ?? 'Available', ...body };
    items.unshift(created);
    return { value: clone(created) };
  }
  if (P(/^\/inventory\/(\d+)$/) && method === 'DELETE') {
    items = items.filter((i) => i.id !== Number(P(/^\/inventory\/(\d+)$/)[1]));
    return { value: { id: Number(P(/^\/inventory\/(\d+)$/)[1]) } };
  }

  // ---- Catalog / bookings (customer views) ----
  if (P(/^\/catalog\/(\d+)$/)) {
    const it = items.find((i) => i.id === Number(P(/^\/catalog\/(\d+)$/)[1]));
    return it ? { value: clone(it) } : { status: 404, error: 'Not found' };
  }
  if (P(/^\/catalog/)) return { value: clone(items.filter((i) => i.status !== 'Deleted')) };
  if (P(/^\/bookings\/(.+)$/) && method === 'GET') {
    const t = transactions.find((x) => x.id === P(/^\/bookings\/(.+)$/)[1]);
    return t ? { value: clone(t) } : { status: 404, error: 'Not found' };
  }
  if (P(/^\/bookings/) && method === 'GET') return { value: clone(transactions.filter((t) => t.customerId === 'demo-customer-profile')) };
  if (path === '/bookings' && method === 'POST') {
    const it = items.find((i) => i.id === body.itemId);
    const created = tx(
      String(Date.now()), body.itemId, 'demo-customer-profile',
      'Active', 0, 3, it?.price ?? 1000, body.downpayment ?? 0,
    );
    created.rentalDate = body.rentalDate ?? day(0);
    created.dueDate = body.dueDate ?? day(3);
    transactions.unshift(created);
    if (it) { it.status = 'Rented'; it.effectiveStatus = 'Rented'; }
    return { value: clone(created) };
  }

  // ---- Transactions ----
  if (path === '/transactions/upcoming') return { value: clone(transactions.filter((t) => t.status === 'Active' || t.status === 'Reserved')) };
  if (P(/^\/transactions\/[0-9a-f-]+\/return$/) && method === 'PUT') {
    const t = transactions.find((x) => x.id === body.id || path.includes(x.id));
    if (t) {
      t.status = body.isDamaged ? 'Returned' : 'Returned';
      const it = items.find((i) => i.id === t.itemId);
      if (it) { it.status = body.isDamaged ? 'OutOfService' : 'Cleaning'; it.effectiveStatus = it.status; }
    }
    return { value: clone(t ?? {}) };
  }
  if (P(/^\/transactions\/[0-9a-f-]+\/release$/) && method === 'PUT') {
    const t = transactions.find((x) => path.includes(x.id));
    if (t) t.releasePhoto = body.releasePhoto ?? 'demo/release.jpg';
    return { value: clone(t ?? {}) };
  }
  if (P(/^\/transactions\/[0-9a-f-]+\/cancel$/) && method === 'PUT') {
    const t = transactions.find((x) => path.includes(x.id));
    if (t) t.status = 'Cancelled';
    return { value: clone(t ?? {}) };
  }
  if (P(/^\/transactions\/[0-9a-f-]+$/) && method === 'PATCH') {
    const t = transactions.find((x) => path.includes(x.id));
    if (t) Object.assign(t, body);
    return { value: clone(t ?? {}) };
  }
  if (P(/^\/transactions\/[0-9a-f-]+$/) && method === 'DELETE') {
    transactions = transactions.filter((x) => !path.includes(x.id));
    return { value: { message: 'Deleted (demo)' } };
  }
  if (P(/^\/transactions\/[0-9a-f-]+$/) && method === 'GET') {
    const t = transactions.find((x) => x.id === P(/^\/transactions\/([0-9a-f-]+)$/)[1]);
    return t ? { value: clone(t) } : { status: 404, error: 'Not found' };
  }
  if (path === '/transactions' && method === 'GET') {
    return { value: { transactions: clone(transactions) } };
  }
  if (path === '/transactions' && method === 'POST') {
    const it = items.find((i) => i.id === body.itemId);
    const customer = CUSTOMERS[body.customerId] ?? { id: 'walkin-' + Date.now(), name: body.customerName ?? 'Walk-in', phone: body.customerPhone ?? null };
    const created = {
      ...tx(String(Date.now()), body.itemId, customer.id, 'Active', 0, 3, body.rentalFee ?? it?.price ?? 0, body.downpayment ?? 0),
      customer: { id: customer.id, name: customer.name, phone: customer.phone },
    };
    created.rentalDate = body.rentalDate ?? day(0);
    created.dueDate = body.dueDate ?? day(3);
    transactions.unshift(created);
    if (it) { it.status = 'Rented'; it.effectiveStatus = 'Rented'; }
    return { value: clone(created) };
  }

  // ---- Customers ----
  if (P(/^\/customers\/(.+)$/) && method === 'PUT') {
    const c = Object.values(CUSTOMERS).find((x) => x.id === P(/^\/customers\/(.+)$/)[1]);
    if (c) Object.assign(c, body);
    return { value: clone(c ?? body) };
  }

  // ---- Dashboard ----
  if (P(/^\/dashboard\/kpis/)) return { value: kpis() };
  if (path === '/dashboard/today') return { value: todayDigest() };
  if (P(/^\/dashboard\/forecast/)) return { value: forecast() };
  if (P(/^\/dashboard\/insights/)) return { value: insights() };
  if (P(/^\/dashboard\/bundle/)) return { value: bundle() };

  // ---- Notifications ----
  if (path === '/notifications/unread-count') return { value: { count: notifications.filter((n) => !n.isRead).length } };
  if (path === '/notifications/read-all') {
    notifications.forEach((n) => { n.isRead = true; });
    return { value: { message: 'All read (demo)' } };
  }
  if (P(/^\/notifications\/(.+)\/read$/)) {
    const n = notifications.find((x) => x.id === P(/^\/notifications\/(.+)\/read$/)[1]);
    if (n) n.isRead = true;
    return { value: clone(n ?? {}) };
  }
  if (P(/^\/notifications\/(.+)$/) && method === 'DELETE') {
    notifications = notifications.filter((x) => x.id !== P(/^\/notifications\/(.+)$/)[1]);
    return { value: { message: 'Removed (demo)' } };
  }
  if (path === '/notifications' && method === 'DELETE') {
    notifications = [];
    return { value: { message: 'Cleared (demo)' } };
  }
  if (path === '/notifications') {
    return { value: { notifications: clone(notifications), unreadCount: notifications.filter((n) => !n.isRead).length } };
  }

  // ---- Settings ----
  if (path === '/settings/flags') return { value: { features: {} } };
  if (path === '/settings/rules') return { value: { minDownpaymentPct: 50, latePenaltyPerDay: 100, overdueEscalationDays: 3, dataRetentionMonths: 12 } };
  if (P(/^\/settings\/rental-defaults/)) return { value: { defaultDays: 3, weekendSurge: false } };
  if (path === '/settings/sms-templates') return { value: [] };
  if (path === '/settings/integrations-status') return { value: { gemini: { configured: false }, groq: { configured: false }, openrouter: { configured: false }, paymongo: { configured: false }, semaphore: { configured: false } } };

  // ---- SMS / promo / payments / AI / storage ----
  if (P(/^\/sms\/history/)) return { value: { messages: [] } };
  if (path === '/sms/send') return { value: { message: 'SMS sent (demo — not really)', id: 'demo-sms' } };
  if (P(/^\/promo-codes\/public/)) return { value: [] };
  if (P(/^\/promo-codes\/validate/)) return { status: 404, error: 'Promo code not found (demo)' };
  if (P(/^\/promo-codes/)) return { value: [] };
  if (P(/^\/payments\/create-intent/)) return { value: { simulated: true, id: 'demo-intent' } };
  if (P(/^\/payments\/(.+)$/)) return { value: { id: P(/^\/payments\/(.+)$/)[1], status: 'succeeded', simulated: true } };
  if (path === '/ai/chat') {
    return {
      value: {
        reply: 'This is the AI stylist in demo mode — no AI provider is called. Try the real app for styling advice!',
        source: 'demo',
      },
    };
  }
  if (path === '/ai/generate-report') {
    return { value: { report: '## Demo Report\n\nAI reports are disabled in demo mode. All figures below come from the mock dashboard.\n\n- Monthly revenue: ₱38,500\n- Active rentals: see Dashboard\n', source: 'demo' } };
  }
  if (P(/^\/storage\/upload/)) return { value: { path: 'demo/demo-' + Date.now() + '.jpg' } };
  if (P(/^\/storage\/(.+)$/)) {
    // Signed-URL resolution for bucket paths. Demo images are absolute URLs
    // already, so this only fires for uploaded demo paths — echo a placeholder.
    return { value: { url: IMG('demo-' + Math.abs(hash(path)) % 50) } };
  }

  // Fallback: unknown endpoints shouldn't crash the app — return empty-ish.
  return { value: null };
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

// ─── Public handle ────────────────────────────────────────────────────────

export async function demoRequest(method, path, body) {
  const result = route(method.toUpperCase(), path.split('?')[0], body ?? {});
  await new Promise((r) => setTimeout(r, 120)); // small latency so loaders show
  if (result && result.status && result.status >= 400) {
    const err = new Error(result.error || `Demo request failed (${result.status})`);
    err.status = result.status;
    throw err;
  }
  return result ? result.value : null;
}
