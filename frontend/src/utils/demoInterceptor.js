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
  { id: 'n11', type: 'customer_message', title: 'Message from Maria Santos', message: 'Hi! Can I move my fitting to Friday afternoon instead?', transactionId: '44444444-4444-4444-8444-444444444444', isRead: false, createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() },
  { id: 'n4', type: 'customer_message', title: 'Message from Pedro Santos', message: 'Please cancel my booking — our event was moved to next month.', transactionId: '22222222-2222-4222-8222-222222222222', isRead: false, createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString() },
  { id: 'n1', type: 'new_booking', title: 'New booking', message: 'Juan Dela Cruz booked Debutante Ball Gown for ' + day(4) + '.', transactionId: '55555555-5555-4555-8555-555555555555', isRead: false, createdAt: new Date(Date.now() - 28 * 60 * 1000).toISOString() },
  { id: 'n5', type: 'booking_confirmation', title: 'Booking confirmed', message: 'Pedro Reyes confirmed Charcoal Three-Piece Suit rental — downpayment received.', transactionId: '44444444-4444-4444-8444-444444444444', isRead: false, createdAt: new Date(Date.now() - 55 * 60 * 1000).toISOString() },
  { id: 'n6', type: 'booking_updated', title: 'Booking updated', message: 'Maria Santos moved her pickup to ' + day(1) + ' for Rose Gold Filipiniana.', transactionId: '11111111-1111-4111-8111-111111111111', isRead: false, createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
  { id: 'n10', type: 'reminder', title: 'Pickup reminder', message: 'Debutante Ball Gown pickup is scheduled for tomorrow at 10:00 AM.', transactionId: '44444444-4444-4444-8444-444444444444', isRead: false, createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() },
  { id: 'n7', type: 'due_today', title: 'Due today', message: 'Midnight Blue Barong Tagalog is due back today before 6:00 PM.', transactionId: '11111111-1111-4111-8111-111111111111', isRead: false, createdAt: day(0) + 'T07:30:00Z' },
  { id: 'n8', type: 'alteration_needed', title: 'Alteration needed', message: 'Ivory Lace Wedding Gown needs hem adjustment before Saturday release.', transactionId: '33333333-3333-4333-8333-333333333333', isRead: false, createdAt: day(0) + 'T06:45:00Z' },
  { id: 'n2', type: 'overdue', title: 'Overdue return', message: 'Maria Clara Gala Gown is 5 days overdue — follow up with Pedro Reyes.', transactionId: '22222222-2222-4222-8222-222222222222', isRead: false, createdAt: day(-1) + 'T10:30:00Z' },
  { id: 'n9', type: 'no_show', title: 'No-show alert', message: 'Juan Dela Cruz missed the Sep 12 pickup window for Spanish-Era Costume Set.', transactionId: '55555555-5555-4555-8555-555555555555', isRead: true, createdAt: day(-1) + 'T09:00:00Z' },
  { id: 'n12', type: 'booking_cancelled', title: 'Booking cancelled', message: 'Maria Santos cancelled the Barong for Kids reservation.', transactionId: '44444444-4444-4444-8444-444444444444', isRead: true, createdAt: day(-2) + 'T15:20:00Z' },
  { id: 'n3', type: 'late_return', title: 'Late return', message: 'Ivory Lace Wedding Gown returned late — inspected and sent to cleaning.', transactionId: '33333333-3333-4333-8333-333333333333', isRead: true, createdAt: day(-2) + 'T14:00:00Z' },
];

let staff = [
  { id: 'demo-staff-profile', email: 'staff@rentech.demo', name: 'Kai (Demo Staff)', phone: '09181234567', createdAt: day(-30) },
  { id: 's-2', email: 'ana@rentech.demo', name: 'Ana (Demo Staff 2)', phone: null, createdAt: day(-12) },
];

let demoBackups = [
  { id: 'backup-demo-2', createdAt: new Date(Date.now() - 86400000).toISOString(), createdBy: 'demo-admin-profile', totalRows: 42, tables: { profiles: 5, inventory_items: 8, transactions: 5 }, storageFiles: 16, storageBytes: 2457600, storageIncomplete: false, sizeBytes: 18432, filename: 'backup-demo-2.json', uploaded: true, source: 'both' },
  { id: 'backup-demo-1', createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), createdBy: 'demo-admin-profile', totalRows: 38, tables: { profiles: 4, inventory_items: 8, transactions: 4 }, storageFiles: 14, storageBytes: 2100000, storageIncomplete: false, sizeBytes: 16210, filename: 'backup-demo-1.json', uploaded: true, source: 'cloud' },
];

let demoReports = [
  { id: 'rpt-demo-2', createdAt: new Date(Date.now() - 86400000).toISOString(), createdBy: 'demo-admin-profile', source: 'demo', provider: 'demo', model: 'demo', excerpt: 'Demo report: Gowns lead bookings, weekend demand spikes.', length: 320, uploaded: true, origin: 'both' },
  { id: 'rpt-demo-1', createdAt: new Date(Date.now() - 4 * 86400000).toISOString(), createdBy: 'demo-admin-profile', source: 'demo', provider: 'demo', model: 'demo', excerpt: 'Demo report: revenue steady, 2 overdue rentals need attention.', length: 298, uploaded: true, origin: 'cloud' },
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

const monthLabel = (d) => d.toLocaleString('en-US', { month: 'short', year: 'numeric' });

function lastMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ label: monthLabel(d), year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return out;
}

function nextMonthLabelsFrom(year, month, n) {
  const out = [];
  let y = year, m = month;
  for (let i = 0; i < n; i++) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    out.push(monthLabel(new Date(y, m - 1, 1)));
  }
  return out;
}

const round1 = (n) => Math.round(n * 10) / 10;

// Per-item demo performance stats underpinning insights + inventory analytics
// so the two sections tell a consistent story (same leaders/laggards).
const DEMO_ITEM_STATS = {
  1: { totalRentals: 6, revenueGenerated: 21000, totalRentedDays: 18, utilizationPct: 72, daysIdle: 2 },
  2: { totalRentals: 0, revenueGenerated: 0, totalRentedDays: 0, utilizationPct: 0, daysIdle: null },
  3: { totalRentals: 4, revenueGenerated: 8800, totalRentedDays: 12, utilizationPct: 58, daysIdle: 5 },
  4: { totalRentals: 0, revenueGenerated: 0, totalRentedDays: 0, utilizationPct: 0, daysIdle: null },
  5: { totalRentals: 2, revenueGenerated: 8000, totalRentedDays: 7, utilizationPct: 41, daysIdle: 9 },
  6: { totalRentals: 3, revenueGenerated: 11400, totalRentedDays: 10, utilizationPct: 55, daysIdle: 4 },
  7: { totalRentals: 0, revenueGenerated: 0, totalRentedDays: 0, utilizationPct: 0, daysIdle: null },
  8: { totalRentals: 2, revenueGenerated: 5200, totalRentedDays: 6, utilizationPct: 33, daysIdle: 12 },
};

const demoInventoryAnalytics = () => {
  const rows = items.map((it) => {
    const s = DEMO_ITEM_STATS[it.id] ?? { totalRentals: 0, revenueGenerated: 0, totalRentedDays: 0, utilizationPct: 0, daysIdle: null };
    return {
      id: it.id,
      name: it.name,
      category: it.category,
      price: it.price,
      status: it.status,
      totalRentals: s.totalRentals,
      revenueGenerated: s.revenueGenerated,
      avgRevenuePerRental: s.totalRentals > 0 ? Math.round(s.revenueGenerated / s.totalRentals) : 0,
      totalRentedDays: s.totalRentedDays,
      utilizationPct: s.utilizationPct,
      daysIdle: s.daysIdle,
      image: it.image,
    };
  });
  const byRevenue = [...rows].sort((a, b) => b.revenueGenerated - a.revenueGenerated);
  const byUtil = [...rows].sort((a, b) => b.utilizationPct - a.utilizationPct);
  const byFreq = [...rows].sort((a, b) => b.totalRentals - a.totalRentals);
  return {
    items: rows,
    summary: {
      totalItems: rows.length,
      totalRevenue: rows.reduce((s, r) => s + r.revenueGenerated, 0),
      totalRentals: rows.reduce((s, r) => s + r.totalRentals, 0),
      avgUtilization: rows.length ? Math.round(rows.reduce((s, r) => s + r.utilizationPct, 0) / rows.length) : 0,
    },
    topByRevenue: byRevenue.slice(0, 5),
    topByUtilization: byUtil.slice(0, 5),
    topByFrequency: byFreq.slice(0, 5),
  };
};

// Shape matches backend getInsightsUncached so AIInsightsView renders fully.
const insights = () => {
  const months = lastMonths(6);
  const revenues = [26400, 31200, 29800, 34500, 35200, 38500];
  return {
    categoryBreakdown: {
      Gown: { total: 3, rented: 3 },
      Barong: { total: 2, rented: 0 },
      Filipiniana: { total: 1, rented: 1 },
      Suit: { total: 1, rented: 0 },
      Costume: { total: 1, rented: 1 },
    },
    topRented: [
      { id: 1, name: 'Ivory Lace Wedding Gown', category: 'Gown', rentals: 6 },
      { id: 3, name: 'Rose Gold Filipiniana', category: 'Filipiniana', rentals: 4 },
      { id: 6, name: 'Debutante Ball Gown', category: 'Gown', rentals: 3 },
      { id: 5, name: 'Maria Clara Gala Gown', category: 'Gown', rentals: 2 },
      { id: 8, name: 'Spanish-Era Costume Set', category: 'Costume', rentals: 2 },
    ],
    underperforming: [
      { id: 2, name: 'Midnight Blue Barong Tagalog', category: 'Barong', rentals: 0 },
      { id: 4, name: 'Charcoal Three-Piece Suit', category: 'Suit', rentals: 0 },
      { id: 7, name: 'Barong for Kids', category: 'Barong', rentals: 0 },
    ],
    revenueByMonth: months.map((m, i) => ({ label: m.label, revenue: revenues[i] ?? 0 })),
    revenueByWeek: [
      { label: 'Wk 1', revenue: 8200 },
      { label: 'Wk 2', revenue: 9100 },
      { label: 'Wk 3', revenue: 7600 },
      { label: 'Wk 4', revenue: 8800 },
      { label: 'Wk 5', revenue: 4800 },
    ],
    revenueByCategory: { Gown: 40400, Filipiniana: 8800, Costume: 5200, Barong: 0, Suit: 0 },
    totalItems: items.length,
    totalRented: 5,
  };
};

// Shape matches backend getForecast (monthly) so SMA chart + outlook render.
const forecast = () => {
  const months = lastMonths(6);
  const labels = months.map((m) => m.label);
  const counts = [5, 7, 6, 8, 9, 10];
  const smaVals = counts.map((_, i) => (i < 2 ? null : round1((counts[i - 2] + counts[i - 1] + counts[i]) / 3)));
  const last = months[months.length - 1];
  const nextLabels = nextMonthLabelsFrom(last.year, last.month, 3);
  const lastSma = smaVals[smaVals.length - 1] ?? 0;
  return {
    labels,
    counts,
    sma: smaVals,
    period: 3,
    granularity: 'monthly',
    projections: nextLabels.map((label) => ({ label, value: round1(lastSma) })),
    byCategory: [
      { category: 'Gown', latest: 4, average: 3.1, projection: 3.8, trend: 'up' },
      { category: 'Filipiniana', latest: 1, average: 0.9, projection: 1, trend: 'flat' },
      { category: 'Costume', latest: 1, average: 0.7, projection: 0.9, trend: 'up' },
      { category: 'Barong', latest: 1, average: 0.8, projection: 1, trend: 'flat' },
      { category: 'Suit', latest: 0, average: 0.3, projection: 0.2, trend: 'down' },
    ],
    historyMonths: 6,
    confidence: 'medium',
    confidenceNote: 'Based on 6 months of history · medium confidence',
  };
};

const weeklyForecast = () => {
  const labels = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7);
    labels.push(d.toLocaleString('en-US', { month: 'short', day: 'numeric' }));
  }
  const counts = [2, 1, 3, 2, 4, 3, 2, 3, 4, 2, 3, 4];
  const smaVals = counts.map((_, i) => (i < 2 ? null : round1((counts[i - 2] + counts[i - 1] + counts[i]) / 3)));
  const lastSma = smaVals[smaVals.length - 1] ?? 0;
  const nextLabels = [1, 2, 3].map((i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i * 7);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
  });
  return {
    labels,
    counts,
    sma: smaVals,
    period: 3,
    granularity: 'weekly',
    projections: nextLabels.map((label) => ({ label, value: round1(lastSma) })),
    byCategory: [],
    historyMonths: 6,
    confidence: 'medium',
    confidenceNote: 'Based on 6 months of history · medium confidence',
  };
};

function bundle() {
  return {
    kpis: kpis(),
    today: todayDigest(),
    insights: insights(),
    forecast: forecast(),
    analytics: demoInventoryAnalytics(),
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
  if (P(/^\/inventory\/analytics/)) return { value: demoInventoryAnalytics() };
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
  if (path === '/customers/contact' && method === 'POST') {
    notifications.unshift({
      id: 'n-demo-' + Date.now(), type: 'customer_message',
      title: 'Message from Demo Customer', message: body.message ?? '',
      transactionId: body.transactionId ?? null,
      isRead: false, createdAt: new Date().toISOString(),
    });
    return { value: { message: 'Message sent to the boutique team (demo)', emailed: false } };
  }
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
  if (path === '/settings/backups' && method === 'GET') return { value: clone(demoBackups) };
  if (path === '/settings/backups' && method === 'POST') {
    const meta = { id: 'backup-demo-' + Date.now(), createdAt: new Date().toISOString(), createdBy: 'demo-admin-profile', totalRows: 48, tables: { profiles: 5, inventory_items: items.length, transactions: transactions.length }, storageFiles: items.length * 2, storageBytes: 3200000, storageIncomplete: false, sizeBytes: 20480, filename: 'backup-demo-' + Date.now() + '.json', uploaded: true, source: 'both' };
    demoBackups.unshift(meta);
    return { value: clone(meta) };
  }
  if (P(/^\/settings\/backups\/(.+)\/download$/)) {
    const id = P(/^\/settings\/backups\/(.+)\/download$/)[1];
    const meta = demoBackups.find((b) => b.id === id) ?? demoBackups[0];
    return { value: { version: 2, id: meta?.id ?? id, createdAt: meta?.createdAt ?? new Date().toISOString(), demo: true, tables: { inventory_items: clone(items), transactions: clone(transactions) }, storage: { files: [], fileCount: 0, totalBytes: 0, incomplete: false } } };
  }
  if (path === '/settings/backups/import' && method === 'POST') {
    const tables = body?.payload?.tables ?? {};
    const restored = {};
    for (const [k, v] of Object.entries(tables)) {
      if (Array.isArray(v)) restored[k] = v.length;
    }
    return { value: { restored, skipped: {}, truncatedTables: [], demo: true } };
  }
  if (P(/^\/settings\/backups\/(.+)\/upload$/) && method === 'POST') {
    const id = P(/^\/settings\/backups\/(.+)\/upload$/)[1];
    const b = demoBackups.find((x) => x.id === id);
    if (!b) return { status: 404, error: 'Backup not found (demo)' };
    b.uploaded = true;
    b.source = 'both';
    return { value: clone(b) };
  }

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
    const created = { id: 'rpt-demo-' + Date.now(), createdAt: new Date().toISOString(), createdBy: 'demo-admin-profile', source: 'demo', provider: 'demo', model: 'demo', excerpt: 'Demo report: Gowns drive revenue, Barong needs promotion, demand trending up.', length: 420, uploaded: true, origin: 'both' };
    demoReports.unshift(created);
    return { value: { report: '## Demo Report\n\nMonthly revenue is ₱38,500 (up from ₱35,200). Gowns drive most bookings; 1 overdue rental needs attention.\n\n## Recommendations\n\n1. Feature the Ivory Lace Wedding Gown on the home page — it is the most rented item (6x).\n2. Run a weekend promotion for the Midnight Blue Barong Tagalog — it has 0 rentals this period.\n3. Send pickup reminders a day early — Friday–Saturday demand runs 3x weekday volume.\n', source: 'demo', reportId: created.id } };
  }
  if (path === '/ai/reports' && method === 'GET') return { value: clone(demoReports) };
  if (P(/^\/ai\/reports\/(.+)$/) && method === 'GET') {
    const r = demoReports.find((x) => x.id === P(/^\/ai\/reports\/(.+)$/)[1]);
    if (!r) return { status: 404, error: 'Report not found (demo)' };
    return { value: { ...clone(r), report: `# Demo report (${r.id})\n\n${r.excerpt}\n\n- Monthly revenue: ₱38,500\n- Active rentals: see Dashboard\n` } };
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
  // /dashboard/forecast?granularity=weekly needs its own bucket shape, but the
  // router matches on the stripped path — branch here before stripping.
  if (method.toUpperCase() === 'GET' && path.includes('/dashboard/forecast') && path.includes('granularity=weekly')) {
    await new Promise((r) => setTimeout(r, 120));
    return clone(weeklyForecast());
  }
  const result = route(method.toUpperCase(), path.split('?')[0], body ?? {});
  await new Promise((r) => setTimeout(r, 120)); // small latency so loaders show
  if (result && result.status && result.status >= 400) {
    const err = new Error(result.error || `Demo request failed (${result.status})`);
    err.status = result.status;
    throw err;
  }
  return result ? result.value : null;
}
