import { prisma } from '../config/database.js';
import { TransactionStatus } from '@prisma/client';
import { sma, smaCapped, mape } from '../utils/sma.js';
import { cacheOrCompute, setDataCacheWarmer } from '../utils/ttlCache.js';
import { getInventoryAnalytics } from './inventoryAnalytics.service.js';

// Refill the hot dashboard keys right after a mutation clears the cache, in the
// background. Without this, the first dashboard visit after any booking /
// return / payment pays the full query cost; with it, that visit is already
// a warm cache hit. Self-registered here (dashboard.service is loaded by the
// routes) so ttlCache doesn't have to import us (circular).
setDataCacheWarmer(() => {
  return Promise.allSettled([
    getKpis(),
    getTodayTasks(),
    getInsights({}),
    getForecast(3),
    getInventoryAnalytics(),
  ]).then(() => {});
});


function applyPeriod(where: any, filter?: { start?: Date; end?: Date }) {
  if (filter?.start) where.createdAt = { gte: filter.start };
  if (filter?.end) where.createdAt = { ...where.createdAt, lt: filter.end };
  return where;
}

// Years that actually have bookings (drives the year picker so it never
// offers decades of empty years). The current year is always included — new
// bookings land there. One light indexed scan; cached like the rest.
export async function getAvailableYears() {
  return cacheOrCompute('years', async () => {
    const rows = await prisma.transaction.findMany({ select: { createdAt: true } });
    const years = new Set<number>();
    for (const r of rows) {
      const d = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
      if (!Number.isNaN(d.getTime())) years.add(d.getFullYear());
    }
    years.add(new Date().getFullYear());
    return { years: [...years].sort((a, b) => a - b) };
  });
}

export async function getKpis(filter?: { start?: Date; end?: Date }) {
  // Cached server-side so every consumer (customer Home, staff today-view,
  // admin dashboard, AI Insights) shares one computation instead of repeating
  // the same 8+ queries per request. Start AND end go into the key so a
  // pinned month (bounded) doesn't collide with the current-month window.
  const key = filter?.start
    ? `kpis:${filter.start.toISOString()}${filter.end ? `:${filter.end.toISOString()}` : ''}`
    : 'kpis:all';
  return cacheOrCompute(key, () => getKpisUncached(filter));
}

async function getKpisUncached(filter?: { start?: Date; end?: Date }) {
  const [
    activeRentals,
    overdueReturns,
    returnedCount,
    cancelledCount,
    damagedCount,
    periodRevenue,
    totalItems,
    availableItems,
  ] = await Promise.all([
    prisma.transaction.count({ where: { status: 'Active' } }),
    prisma.transaction.count({ where: { status: 'Overdue' } }),
    prisma.transaction.count({ where: { status: 'Returned' } }),
    prisma.transaction.count({ where: { status: 'Cancelled' } }),
    prisma.inventoryItem.count({ where: { status: 'OutOfService' } }),
    filter?.start ? aggregateRevenueFrom(filter.start, filter.end) : aggregateMonthlyRevenue(),
    prisma.inventoryItem.count(),
    prisma.inventoryItem.count({ where: { status: 'Available' } }),
  ]);

  // All-time collected across every period (drives the AI Insights Overall
  // tab). Kept separate from monthlyRevenue so the dashboards that consume
  // getKpis() unfiltered keep their current-month figure.
  const totalRevenue = await aggregateRevenueFrom(new Date(0));

  let prevRevenue = 0;
  if (filter?.start) {
    const end = filter.end || new Date();
    const rangeMs = end.getTime() - filter.start.getTime();
    const prevStart = new Date(filter.start.getTime() - rangeMs);
    prevRevenue = await aggregateRevenueFrom(prevStart, filter.start);
  } else {
    const prevStart = new Date();
    prevStart.setMonth(prevStart.getMonth() - 1);
    prevStart.setDate(1);
    prevRevenue = await aggregateRevenueBetween(prevStart, new Date(prevStart.getFullYear(), prevStart.getMonth() + 1, 1));
  }

  const allTransactions = activeRentals + overdueReturns + returnedCount + cancelledCount;
  const inUseItems = totalItems - availableItems;
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  return {
    activeRentals,
    overdueReturns,
    returnedCount,
    cancelledCount,
    damagedItems: damagedCount,
    monthlyRevenue: periodRevenue,
    prevMonthRevenue: prevRevenue,
    totalRevenue,
    totalItems,
    availableItems,
    inUseItems,
    utilizationRate: pct(inUseItems, totalItems),
    overdueRate: pct(overdueReturns, overdueReturns + returnedCount),
    returnedRate: pct(returnedCount, allTransactions),
    cancellationRate: pct(cancelledCount, allTransactions),
  };
}

// Revenue counts money actually collected, from EITHER ledger path: online
// gateway rows ('succeeded', written by payments.ledger.ts) AND counter cash
// rows ('completed', written by recordPayment). Booked-but-unpaid rental fees
// are never revenue — the ledger is the only proof money moved.
const COLLECTED_PAYMENT_STATUS = ['succeeded', 'completed'];

async function aggregateRevenueBetween(start: Date, end: Date) {
  const paymentSum = await prisma.payment.aggregate({
    _sum: { amount: true },
    where: { status: { in: COLLECTED_PAYMENT_STATUS }, createdAt: { gte: start, lt: end } },
  });
  return paymentSum._sum.amount || 0;
}

async function aggregateRevenueFrom(start: Date, end?: Date) {
  const where: any = { status: { in: COLLECTED_PAYMENT_STATUS }, createdAt: { gte: start } };
  if (end) where.createdAt.lt = end;
  const paymentSum = await prisma.payment.aggregate({ _sum: { amount: true }, where });
  return paymentSum._sum.amount || 0;
}

async function aggregateMonthlyRevenue() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const paymentSum = await prisma.payment.aggregate({
    _sum: { amount: true },
    where: {
      status: { in: COLLECTED_PAYMENT_STATUS },
      createdAt: { gte: startOfMonth },
    },
  });

  return paymentSum._sum.amount || 0;
}

export async function getTodayTasks() {
  // Cached like the rest of the dashboard endpoints: the staff/admin dashboard
  // reads this every mount, and repeat hits re-run 3 queries against the remote
  // pooler for no user-facing gain. Mutations (booking, return, item status)
  // clear the whole cache via clearDataCache(), so the digest is never older
  // than the latest change.
  return cacheOrCompute('today', () => getTodayTasksUncached());
}

async function getTodayTasksUncached() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dueToday = await prisma.transaction.findMany({
    where: {
      status: { in: ['Active', 'Overdue'] },
      dueDate: { gte: today, lt: tomorrow },
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      item: { select: { id: true, name: true } },
    },
    orderBy: { dueDate: 'asc' },
  });

  const overdue = await prisma.transaction.findMany({
    where: {
      OR: [{ status: 'Overdue' }, { status: 'Active', dueDate: { lt: today } }],
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      item: { select: { id: true, name: true } },
    },
    orderBy: { dueDate: 'asc' },
  });

  const inCleaning = await prisma.inventoryItem.count({
    where: { status: 'Cleaning' },
  });

  return {
    dueToday,
    overdue,
    inCleaning,
  };
}

async function getDataMonths() {
  const firstTx = await prisma.transaction.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  const now = new Date();
  const start = firstTx
    ? new Date(firstTx.createdAt.getFullYear(), firstTx.createdAt.getMonth(), 1)
    : new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const months: { label: string; year: number; month: number }[] = [];
  const cursor = new Date(start);
  while (cursor <= now) {
    months.push({
      label: cursor.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
      year: cursor.getFullYear(),
      month: cursor.getMonth() + 1,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return { months, firstMonth: start };
}

const FORECAST_STATUSES: TransactionStatus[] = ['Returned', 'Active', 'Overdue', 'Cancelled'];
const FORECAST_WEEKS = 12;
const FORECAST_HORIZON = 3; // next-N periods projected
const FORECAST_TOP_CATEGORIES = 6;

// Confidence grows with history depth: thin histories project with the same
// math but must be labeled as such so nobody reads a 2-month guess with
// 2-year certainty.
function forecastConfidence(historyMonths: number): 'low' | 'medium' | 'high' {
  if (historyMonths < 4) return 'low';
  if (historyMonths < 8) return 'medium';
  return 'high';
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// One honest series builder shared by the monthly and weekly forecast paths:
// adaptive window (thin histories average over what exists), spike-capped
// values with user-facing flags, and a backtested error band. Bars elsewhere
// always show TRUE counts — only the average uses capped values.
function buildForecastSeries(counts: number[], requestedPeriod: number) {
  const nNonZero = counts.filter((c) => c > 0).length;
  const effectivePeriod = Math.max(1, Math.min(requestedPeriod, Math.max(1, nNonZero)));
  const provisional = nNonZero < 3;
  const { values, flags } = smaCapped(counts, effectivePeriod);

  // Backtest: one-step-ahead residuals over the trailing min(8, n) points —
  // each point predicted by the average known *before* it. Zero-actual
  // periods are skipped (no division by zero).
  const k = Math.min(8, counts.length);
  const actual: number[] = [];
  const predicted: (number | null)[] = [];
  for (let i = Math.max(1, counts.length - k); i < counts.length; i++) {
    actual.push(counts[i]);
    predicted.push(values[i - 1] ?? null);
  }
  const errorPct = mape(actual, predicted);

  // Expected-range band: ±error around each average point (null where the
  // average itself is null). Rendered as the shaded polygon behind the line.
  const e = errorPct === null ? 0 : errorPct / 100;
  const lo = values.map((v) => (v === null ? null : round1(v * (1 - e))));
  const hi = values.map((v) => (v === null ? null : round1(v * (1 + e))));

  return { values, flags, errorPct, band: { lo, hi }, provisional, effectivePeriod };
}

// Flat-SMA projection: the last complete moving average carried forward.
// Honest for an SMA model (it predicts "about the recent average") and the
// UI labels it as projected, never as observed data.
function projectForward(smaValues: (number | null)[], labels: string[], nextLabels: string[]) {
  let last: number | null = null;
  for (const v of smaValues) if (v !== null && v !== undefined) last = v;
  if (last === null) return nextLabels.map((label) => ({ label, value: null as number | null }));
  return nextLabels.map((label) => ({ label, value: round1(last as number) }));
}

function nextMonthLabels(lastYear: number, lastMonth: number, n: number): { label: string; year: number; month: number }[] {
  const out: { label: string; year: number; month: number }[] = [];
  let y = lastYear, m = lastMonth;
  for (let i = 0; i < n; i++) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    out.push({
      label: new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' }),
      year: y,
      month: m,
    });
  }
  return out;
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Mon=0..Sun=6
  x.setDate(x.getDate() - dow);
  return x;
}

export async function getForecast(period: number = 3, granularity: 'monthly' | 'weekly' = 'monthly') {
  const key = `forecast:${period}:${granularity}`;
  return cacheOrCompute(key, async () => {
    const { months, firstMonth } = await getDataMonths();

    // ONE query instead of one count per month — bucket by period in JS so the
    // remote pooler only sees a single round trip regardless of history length.
    // Cancelled bookings count too: they still represent demand (the customer
    // tried to rent), so the SMA isn't artificially depressed on a
    // cancellation-heavy month.
    const rows = await prisma.transaction.findMany({
      where: {
        status: { in: FORECAST_STATUSES },
        createdAt: { gte: firstMonth },
      },
      select: { createdAt: true, itemId: true },
    });

    if (granularity === 'weekly') {
      const now = new Date();
      const firstMonday = startOfWeekMonday(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (FORECAST_WEEKS - 1) * 7));
      const weeks: { label: string; start: Date }[] = [];
      for (let i = 0; i < FORECAST_WEEKS; i++) {
        const start = new Date(firstMonday);
        start.setDate(start.getDate() + i * 7);
        weeks.push({
          label: start.toLocaleString('en-US', { month: 'short', day: 'numeric' }),
          start,
        });
      }
      const weeklyCounts = weeks.map((w, i) => {
        const end = i + 1 < weeks.length ? weeks[i + 1].start : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        return rows.filter(t => t.createdAt >= w.start && t.createdAt < end).length;
      });
      const series = buildForecastSeries(weeklyCounts, period);
      const nextLabels = [1, 2, 3].map(i => {
        const d = new Date(weeks[weeks.length - 1].start);
        d.setDate(d.getDate() + i * 7);
        return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
      });
      const historyMonths = (now.getFullYear() - firstMonday.getFullYear()) * 12 + (now.getMonth() - firstMonday.getMonth()) + 1;
      const confidence = forecastConfidence(historyMonths);
      return {
        labels: weeks.map(w => w.label),
        counts: weeklyCounts,
        sma: series.values,
        flags: series.flags,
        errorPct: series.errorPct,
        band: series.band,
        provisional: series.provisional,
        period: series.effectivePeriod,
        granularity,
        projections: projectForward(series.values, weeks.map(w => w.label), nextLabels),
        byCategory: [],
        historyMonths,
        confidence,
        confidenceNote: `Based on ${historyMonths} month${historyMonths === 1 ? '' : 's'} of history · ${confidence} confidence${series.errorPct === null ? '' : ` · error ±${series.errorPct}%`}`,
      };
    }

    const monthlyCounts = months.map(m =>
      rows.filter(t => t.createdAt.getFullYear() === m.year && t.createdAt.getMonth() === m.month - 1).length
    );

    const series = buildForecastSeries(monthlyCounts, period);
    const last = months[months.length - 1];
    const projections = projectForward(
      series.values,
      months.map(m => m.label),
      last ? nextMonthLabels(last.year, last.month, FORECAST_HORIZON).map(x => x.label) : []
    );

    // Per-category series over the same month buckets (top categories by
    // volume) so the UI can show which lines are actually driving demand.
    const catOf = new Map<number, string>();
    try {
      const items = await prisma.inventoryItem.findMany({ select: { id: true, category: true } });
      for (const it of items) catOf.set(it.id, it.category || 'Other');
    } catch { /* category split is enrichment — never fail the forecast */ }
    const totals = new Map<string, number>();
    for (const t of rows) {
      const c = catOf.get(t.itemId) || 'Other';
      totals.set(c, (totals.get(c) || 0) + 1);
    }
    const topCats = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, FORECAST_TOP_CATEGORIES).map(e => e[0]);
    const byCategory = topCats.map(category => {
      const counts = months.map(m =>
        rows.filter(t =>
          (catOf.get(t.itemId) || 'Other') === category &&
          t.createdAt.getFullYear() === m.year && t.createdAt.getMonth() === m.month - 1
        ).length
      );
      const catSma = sma(counts, period);
      let catLast: number | null = null;
      for (const v of catSma) if (v !== null && v !== undefined) catLast = v;
      const latest = counts.length ? counts[counts.length - 1] : 0;
      const prev = counts.length > 1 ? counts[counts.length - 2] : 0;
      const average = counts.length ? round1(counts.reduce((a, b) => a + b, 0) / counts.length) : 0;
      return {
        category,
        latest,
        average,
        projection: catLast === null ? null : round1(catLast),
        trend: latest > prev ? 'up' : latest < prev ? 'down' : 'flat',
      };
    });

    return {
      labels: months.map(m => m.label),
      counts: monthlyCounts,
      sma: series.values,
      flags: series.flags,
      errorPct: series.errorPct,
      band: series.band,
      provisional: series.provisional,
      period: series.effectivePeriod,
      granularity,
      projections,
      byCategory,
      historyMonths: months.length,
      confidence: forecastConfidence(months.length),
      confidenceNote: `Based on ${months.length} month${months.length === 1 ? '' : 's'} of history · ${forecastConfidence(months.length)} confidence${series.errorPct === null ? '' : ` · error ±${series.errorPct}%`}`,
    };
  });
}

// Cache key includes both start AND end so "current month" and "a pinned
// month from a past year" never collide.
export async function getInsights(filter?: { start?: Date; end?: Date; past?: boolean; weekly?: boolean }) {
  const startKey = filter?.start ? filter.start.toISOString() : 'all';
  const endKey = filter?.end ? `:${filter.end.toISOString()}` : '';
  const key = `insights:${startKey}${endKey}`;
  return cacheOrCompute(key, () => getInsightsUncached(filter));
}

async function getInsightsUncached(filter?: { start?: Date; end?: Date; past?: boolean; weekly?: boolean }) {
  // Window by RENTAL date (when the item is out), not creation date — a booking
  // made in September for October belongs to October. Reserved counts too: a
  // locked upcoming rental is real demand for the period (Cancelled stays out).
  // Revenue below is payments-based and unaffected by this query's shape.
  const txWhere: any = { status: { in: ['Active', 'Returned', 'Overdue', 'Reserved'] } };
  if (filter?.start) txWhere.rentalDate = { gte: filter.start };
  if (filter?.end) txWhere.rentalDate = { ...txWhere.rentalDate, lt: filter.end };

  // Light select — the previous `include: { transactions }` pulled every item
  // plus its FULL transaction history into memory just to count them.
  const items = await prisma.inventoryItem.findMany({
    select: { id: true, name: true, category: true },
  });

  // Everything below is derived from this one transaction query:
  // per-item rental counts, revenue by month, and revenue by category.
  const txs = await prisma.transaction.findMany({
    where: txWhere,
    select: {
      itemId: true,
      rentalFee: true,
      createdAt: true,
      item: { select: { category: true } },
    },
  });

  const categoryBreakdown: Record<string, { total: number; rented: number }> = {};
  for (const item of items) {
    if (!categoryBreakdown[item.category]) {
      categoryBreakdown[item.category] = { total: 0, rented: 0 };
    }
    categoryBreakdown[item.category].total++;
  }
  const rentedItemIds = new Set(txs.map(t => t.itemId));
  for (const itemId of rentedItemIds) {
    const item = items.find(i => i.id === itemId);
    if (item && categoryBreakdown[item.category]) {
      categoryBreakdown[item.category].rented++;
    }
  }

  const rentalCounts = new Map<number, number>();
  for (const t of txs) {
    rentalCounts.set(t.itemId, (rentalCounts.get(t.itemId) || 0) + 1);
  }

  const itemRentalCounts = items
    .map(item => ({ id: item.id, name: item.name, category: item.category, rentals: rentalCounts.get(item.id) || 0 }))
    .sort((a, b) => b.rentals - a.rentals);

  // "Most rented" only means something when an item was actually rented — with
  // no transactions in the window, every count is 0 and a "leader" is a lie.
  const hasRentalActivity = itemRentalCounts.some(i => i.rentals > 0);
  const topRented = itemRentalCounts.filter(i => i.rentals > 0).slice(0, 5);
  // "Underperforming → promote" only makes sense when SOME items are being
  // rented; with zero activity the whole catalog isn't underperforming, there's
  // simply no data yet.
  const underperforming = hasRentalActivity
    ? itemRentalCounts.filter(i => i.rentals === 0).slice(0, 10)
    : [];

  const { months } = await getDataMonths();
  const filteredMonths = filter?.start
    ? months.filter(m => new Date(m.year, m.month - 1, 1) >= filter.start!)
    : months;

  // Revenue is collected payments only (both ledger paths — see
  // COLLECTED_PAYMENT_STATUS), bucketed by payment date in JS. Category
  // revenue rides the same rows via the payment's transaction item, so every
  // revenue figure on this endpoint shares one definition.
  const paymentWhere: any = { status: { in: COLLECTED_PAYMENT_STATUS } };
  if (filter?.start) paymentWhere.createdAt = { gte: filter.start };
  if (filter?.end) paymentWhere.createdAt = { ...paymentWhere.createdAt, lt: filter.end };
  const payments = await prisma.payment.findMany({
    where: paymentWhere,
    select: {
      amount: true,
      createdAt: true,
      transaction: { select: { item: { select: { category: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const inMonth = (d: Date, m: { year: number; month: number }) =>
    d.getFullYear() === m.year && d.getMonth() === m.month - 1;

  const revenueByMonth = filteredMonths.map(m => {
    const revenue = payments.filter(p => inMonth(p.createdAt, m)).reduce((sum, p) => sum + p.amount, 0);
    return { label: m.label, revenue };
  });

  // Weekly zoom for whichever month `filter.start` sits in. Works for the
  // current month (open-ended window, no `filter.end`) AND a pinned past month
  // (bounded window, `filter.end` set by the controller). Built from the same
  // payment/tx source already in memory — the month label lets the frontend
  // tell apart "This month · Wk 2" from "Jun 2025 · Wk 2".
  let revenueByWeek: { label: string; revenue: number }[] | undefined;
  if (filter?.weekly && filter?.start) {
    const y = filter.start.getFullYear();
    const mo = filter.start.getMonth();
    const inThisMonth = (d: Date) => d.getFullYear() === y && d.getMonth() === mo;
    const inRange = payments.filter(p => inThisMonth(p.createdAt));
    const weekOf = (day: number) => Math.min(4, Math.floor((day - 1) / 7)); // 0..4
    const buckets = [0, 0, 0, 0, 0];
    for (const r of inRange) {
      const d = r.createdAt as Date;
      buckets[weekOf(d.getDate())] += r.amount;
    }
    revenueByWeek = buckets.map((revenue, i) => ({ label: `Wk ${i + 1}`, revenue }));
  }

  const revenueByCategory: Record<string, number> = {};
  for (const p of payments) {
    const cat = p.transaction?.item?.category;
    if (!cat) continue;
    revenueByCategory[cat] = (revenueByCategory[cat] || 0) + p.amount;
  }

  return {
    categoryBreakdown,
    topRented,
    underperforming,
    revenueByMonth,
    // Only present when a month was pinned (current or past). Other views keep
    // the monthly series (undefined fields are dropped by JSON).
    ...(revenueByWeek ? { revenueByWeek } : {}),
    // Echo the queried window so the frontend can label the weekly chart for
    // a past month (e.g. "Jun 2025 · Wk 2") instead of assuming "this month".
    ...(filter?.start ? { insightsPeriod: { start: filter.start.toISOString() } } : {}),
    revenueByCategory,
    totalItems: items.length,
    totalRented: rentedItemIds.size,
  };
}

// One cached round trip for the entire AI Insights page. The frontend used to
// fire 4 separate requests (kpis, insights, forecast, inventory-analytics) —
// each hit paid its own ~200 ms pooler round trip, and the independent keys
// meant a single mutation could warm one endpoint while leaving another cold
// until its own first load. Bundling them under one key gets all four with a
// single fetch and a single invalidate/warm cycle.
export async function getDashboardBundle(filter?: { start?: Date; end?: Date; past?: boolean; weekly?: boolean }, forecastPeriod: number = 3) {
  const startKey = filter?.start ? filter.start.toISOString() : 'all';
  const endKey = filter?.end ? `:${filter.end.toISOString()}` : '';
  const weeklyKey = filter?.weekly ? ':weekly' : '';
  const key = `dashboardBundle:${startKey}${endKey}${weeklyKey}:fp${forecastPeriod}`;
  return cacheOrCompute(key, async () => {
    const [kpis, insights, forecast, analytics] = await Promise.all([
      getKpis(filter ? { start: filter.start, end: filter.end } : undefined),
      getInsightsUncached(filter),
      // Single forecast implementation (monthly SMA + projections +
      // per-category) shared with GET /forecast — no duplicated bucketing.
      getForecast(forecastPeriod),
      getInventoryAnalytics(filter?.start, filter?.end),
    ]);
    return { kpis, insights, forecast, analytics };
  });
}
