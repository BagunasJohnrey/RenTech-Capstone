import { prisma } from '../config/database.js';
import { TransactionStatus } from '@prisma/client';
import { sma, smaCapped, mape, type SpikeFlag } from '../utils/sma.js';
import { cacheOrCompute, setDataCacheWarmer } from '../utils/ttlCache.js';
import { getInventoryAnalytics } from './inventoryAnalytics.service.js';
import { manilaDayStart, manilaNextDayStart } from '../utils/manilaDay.js';

// Refill the hot dashboard keys right after a mutation clears the cache, in the
// background. Without this, the first dashboard visit after any booking /
// return / payment pays the full query cost; with it, that visit is already
// a warm cache hit. Self-registered here (dashboard.service is loaded by the
// routes) so ttlCache doesn't have to import us (circular).
//
// The staff list queries (transactions + raw inventory full lists) ride the
// same warmer: they share the clearDataCache() invalidation, so without a
// refill the first Tasks/Dashboard visit after any mutation would pay the
// full cold cost again. Warmed through the public functions so the real
// cache keys (incl. the isHotPath/isFullList gates) are exercised, not
// bypassed. Guest-catalog (effective-status) lists are NOT warmed — they
// bypass the cache by design (see listItems).
// Disabled under vitest: the warmer is fire-and-forget, so it races test
// mocks (a warmer kicked off by clearDataCache consumes mockResolvedValueOnce
// values meant for the request under test). Production/dev unaffected.
const isTestEnv = (process.env.NODE_ENV ?? '') === 'test' || (process.env.VITEST ?? '') === 'true';
if (!isTestEnv) {
  setDataCacheWarmer(() => {
    return Promise.allSettled([
      getKpis(),
      getTodayTasks(),
      getInsights({}),
      getForecast(3),
      getInventoryAnalytics(),
      getDataVersion(),
      // Reports opens on the current month — warm that exact bundle (same
      // window as getPeriodFilter('monthly') + the page's fp=3) so the
      // default view is a cache hit instead of a cold ~1s fan-out.
      (() => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return getDashboardBundle({ start, end, past: false, weekly: true }, 3);
      })(),
      // Tasks needs the QR proof queue alongside the digest. Warming it here
      // keeps the priority card and the verification queue a single cache hit
      // after any mutation (proofs age fast, so the warmer must include it).
      import('./paymentProofs.service.js').then((m) => m.listProofQueue()),
      import('./transactions.service.js').then((m) => m.listTransactions({ role: 'Staff' })),
      import('./inventory.service.js').then((m) =>
        Promise.all([
          m.listItems(undefined, undefined, undefined, { rawStatus: true, exclude: ['Deleted'] }),
          m.listItems(undefined, undefined, undefined, { rawStatus: true }),
        ])
      ),
    ]).then(() => {});
  });
}


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
  const todayStart = manilaDayStart();
  const [
    activeRentals,
    overdueReturns,
    returnedCount,
    cancelledCount,
    damagedCount,
    periodRevenue,
    todayRevenue,
    totalItems,
    availableItems,
  ] = await Promise.all([
    prisma.transaction.count({ where: { status: 'Active' } }),
    prisma.transaction.count({ where: { status: 'Overdue' } }),
    prisma.transaction.count({ where: { status: 'Returned' } }),
    prisma.transaction.count({ where: { status: 'Cancelled' } }),
    prisma.inventoryItem.count({ where: { status: 'OutOfService' } }),
    filter?.start ? aggregateRevenueFrom(filter.start, filter.end) : aggregateMonthlyRevenue(),
    // "Collected today" pill (staff Today-at-a-Glance + admin Revenue
    // Trend header): collected payments since midnight, same ledger
    // definition as monthlyRevenue — not booked fees.
    aggregateRevenueFrom(todayStart),
    // Deleted excluded: archived items are not rentable stock, so dashboard
    // totals ("N of M items free") and utilizationRate read on live stock.
    prisma.inventoryItem.count({ where: { status: { not: 'Deleted' } } }),
    prisma.inventoryItem.count({ where: { status: 'Available' } }),
  ]);

  // Everything below is independent of the counts above and of each other.
  // They used to run one after another (5 extra pooler round trips on every
  // cache miss); now they all fly in one batch.
  const now = new Date();
  const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const trendEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Logbook companions (unverified paper history): same window as the ledger
  // revenue above, but reported SEPARATELY — never merged in. The UI renders
  // them as "+₱X · N logbook" footnotes so every peso total stays traceable
  // to collected payments. Unfiltered KPIs show the current month, so the
  // companion defaults to the same month.
  const histWhere: any = {};
  if (filter?.start || filter?.end) {
    histWhere.eventDate = {};
    if (filter?.start) histWhere.eventDate.gte = filter.start;
    if (filter?.end) histWhere.eventDate.lt = filter.end;
  } else {
    histWhere.eventDate = {
      gte: new Date(now.getFullYear(), now.getMonth(), 1),
      lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };
  }

  // Enrichment only — KPIs stay ledger-pure if the logbook query fails.
  const logbookPromise = (async () => {
    try {
      return await prisma.historicalRecord.aggregate({
        where: histWhere,
        _sum: { price: true },
        _count: { id: true },
      });
    } catch { return null; }
  })();

  const prevRevenuePromise = (() => {
    if (filter?.start) {
      const end = filter.end || new Date();
      const rangeMs = end.getTime() - filter.start.getTime();
      const prevStart = new Date(filter.start.getTime() - rangeMs);
      return aggregateRevenueFrom(prevStart, filter.start);
    }
    const prevStart = new Date();
    prevStart.setMonth(prevStart.getMonth() - 1);
    prevStart.setDate(1);
    return aggregateRevenueBetween(prevStart, new Date(prevStart.getFullYear(), prevStart.getMonth() + 1, 1));
  })();

  // Previous-window logbook (mirrors prevRevenue) so the Revenue card's
  // % change compares combined-vs-combined instead of combined-vs-ledger.
  const prevLogbookPromise = (async () => {
    if (!filter?.start) return null;
    const end = filter.end || new Date();
    const rangeMs = end.getTime() - filter.start.getTime();
    try {
      return await prisma.historicalRecord.aggregate({
        where: { eventDate: { gte: new Date(filter.start.getTime() - rangeMs), lt: filter.start } },
        _sum: { price: true },
        _count: { id: true },
      });
    } catch { return null; /* enrichment only */ }
  })();

  const [totalRevenue, prevRevenue, trendPayments, logbookAgg, prevLogbookAgg] = await Promise.all([
    // All-time collected across every period (drives the AI Insights Overall
    // tab). Kept separate from monthlyRevenue so the dashboards that consume
    // getKpis() unfiltered keep their current-month figure.
    aggregateRevenueFrom(new Date(0)),
    prevRevenuePromise,
    prisma.payment.findMany({
      where: {
        status: { in: COLLECTED_PAYMENT_STATUS },
        createdAt: { gte: trendStart, lt: trendEnd },
      },
      select: { amount: true, createdAt: true },
    }),
    logbookPromise,
    prevLogbookPromise,
  ]);

  const allTransactions = activeRentals + overdueReturns + returnedCount + cancelledCount;
  const inUseItems = totalItems - availableItems;
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  // Revenue trend: one collected-payments series over the same month
  // buckets the admin Revenue Trend chart renders (last 6 months including
  // the current one). Previously the chart summed booked rental fees from the
  // transaction list client-side, which disagreed with this payments-based
  // monthlyRevenue (e.g. card showed a Sept-heavy total while the chart
  // spiked Oct on unpaid bookings). Same definition everywhere now.
  const revenueTrend = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    const revenue = trendPayments
      .filter(
        (p) => p.createdAt.getFullYear() === d.getFullYear() && p.createdAt.getMonth() === d.getMonth()
      )
      .reduce((sum, p) => sum + p.amount, 0);
    revenueTrend.push({ label, revenue });
  }

  const logbookRevenue = logbookAgg?._sum?.price ?? 0;
  const logbookRentals = logbookAgg?._count?.id ?? 0;
  const prevLogbookRevenue = prevLogbookAgg?._sum?.price ?? 0;
  const prevLogbookRentals = prevLogbookAgg?._count?.id ?? 0;

  return {
    activeRentals,
    overdueReturns,
    returnedCount,
    cancelledCount,
    damagedItems: damagedCount,
    monthlyRevenue: periodRevenue,
    prevMonthRevenue: prevRevenue,
    todayRevenue,
    revenueTrend,
    totalRevenue,
    // Logbook companions — same window, separate figures (see above).
    logbookRevenue,
    logbookRentals,
    prevLogbookRevenue,
    prevLogbookRentals,
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
  // Store-calendar (Manila) day so the digest flips at local midnight, not
  // at 08:00 when the server runs in UTC.
  const today = manilaDayStart();
  const tomorrow = manilaNextDayStart();

  // One batch: the old code awaited these serially (4+ back-to-back pooler
  // round trips). All five are independent, so they fly together.
  // Row shape is deliberately FULL (all tx scalars + customer/item names):
  // the digest doubles as the Tasks first paint (~20 rows ≈ 20KB vs the
  // 500-row /transactions list at ~330KB), so every action the queue offers
  // (SMS, release with balance check, edit with phone/address, detail nav)
  // works directly off digest rows — no partial-row hazards.
  const taskRow = {
    customer: { select: { id: true, name: true, phone: true, address: true } },
    item: { select: { id: true, name: true, category: true } },
  };

  const [dueToday, overdue, pendingPickup, inCleaning, todayRevenue] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        status: { in: ['Active', 'Overdue'] },
        dueDate: { gte: today, lt: tomorrow },
      },
      include: taskRow,
      orderBy: { dueDate: 'asc' },
    }),
    prisma.transaction.findMany({
      where: {
        OR: [{ status: 'Overdue' }, { status: 'Active', dueDate: { lt: today } }],
      },
      include: taskRow,
      orderBy: { dueDate: 'asc' },
    }),
    // Ready-for-Pickup: booked but not yet handed over (no release/condition
    // photo). Mirrors client isReleased(), so digest rows match the Tasks
    // queue exactly.
    prisma.transaction.findMany({
      where: {
        status: { in: ['Active', 'Reserved'] },
        releasePhoto: null,
        conditionPhoto: null,
      },
      include: taskRow,
      orderBy: { rentalDate: 'asc' },
    }),
    prisma.inventoryItem.count({
      where: { status: 'Cleaning' },
    }),
    // Collected-today pill (staff Today-at-a-Glance + admin Revenue Trend
    // header): same ledger definition as monthlyRevenue. Staff never fetch
    // /kpis, so it rides the today-digest both roles already load.
    aggregateRevenueFrom(today),
  ]);

  return {
    dueToday,
    overdue,
    pendingPickup,
    inCleaning,
    todayRevenue,
  };
}

// `includeHistory` (forecast only): start at the OLDEST of the first app
// transaction and the first imported logbook record — otherwise paper history
// older than the app was silently dropped from the forecast. Capped at 5
// years so a mistyped 1990 event date can't explode the series.
const MAX_HISTORY_MONTHS = 60;
async function getDataMonths(includeHistory = false) {
  // Cached (and coalesced) because insights + forecast both call this inside
  // the same dashboard bundle — one pair of lookups instead of two.
  const { firstTxAt, firstLogAt } = await cacheOrCompute(`dataMonths:${includeHistory}`, async () => {
    const [firstTx, firstLog] = await Promise.all([
      prisma.transaction.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      includeHistory
        ? prisma.historicalRecord.findFirst({
          orderBy: { eventDate: 'asc' },
          select: { eventDate: true },
        }).catch(() => null) // no logbook table/rows — app history only
        : Promise.resolve(null),
    ]);
    return { firstTxAt: firstTx?.createdAt ?? null, firstLogAt: firstLog?.eventDate ?? null };
  });
  const now = new Date();
  let earliest: Date | null = firstTxAt;
  if (firstLogAt && (!earliest || firstLogAt < earliest)) earliest = firstLogAt;
  const floor = new Date(now.getFullYear(), now.getMonth() - (MAX_HISTORY_MONTHS - 1), 1);
  let start = earliest
    ? new Date(earliest.getFullYear(), earliest.getMonth(), 1)
    : new Date(now.getFullYear(), now.getMonth() - 3, 1);
  if (start < floor) start = floor;
  if (start > now) start = new Date(now.getFullYear(), now.getMonth(), 1);
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

// A backtest error above 100% is not a usable confidence interval — it is a
// structural break (partial month, sparse weeks, sudden volume jump). Saying
// "error ±659%" in the UI reads like a bug, so label the variance instead.
function forecastErrorNote(errorPct: number | null): string {
  if (errorPct === null || errorPct === undefined) return '';
  return errorPct > 100 ? ' · high variance' : ` · error ±${errorPct}%`;
}

// Depth alone is not confidence: 25 months with a ±600% backtest error is not
// "high confidence". A wide backtest downgrades the badge to low.
function effectiveConfidence(
  base: 'low' | 'medium' | 'high',
  errorPct: number | null,
): 'low' | 'medium' | 'high' {
  return errorPct !== null && errorPct !== undefined && errorPct > 100 ? 'low' : base;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// One honest series builder shared by the monthly and weekly forecast paths:
// adaptive window (thin histories average over what exists), spike-capped
// values with user-facing flags, and a backtested error band. Bars elsewhere
// always show TRUE counts — only the average uses capped values.
export function buildForecastSeries(counts: number[], requestedPeriod: number) {
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
  // average itself is null; floored at zero — a rental count can never be
  // negative). Rendered as the shaded polygon behind the line.
  const e = errorPct === null ? 0 : errorPct / 100;
  const lo = values.map((v) => (v === null ? null : Math.max(0, round1(v * (1 - e)))));
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

// Seasonal blend for the MONTHLY outlook. A flat SMA can't see that rental
// demand swings with the calendar (wedding/debut season, Christmas parties,
// graduation), so each future month blends the recent average 50/50 with
// the SAME month last year, scaled by year-over-year growth (last 3 complete
// months vs the same 3 a year earlier, clamped ×0.5–×2).
//
// It is only USED when a one-step backtest over the trailing complete months
// beats the plain SMA (≥3 comparable points) — otherwise the flat projection
// stands. The partial current month never enters the growth base or the
// backtest, and a spike-flagged month is never copied forward (that month
// falls back to the flat average). Pure + exported for unit tests.
export const SEASONAL_WEIGHT = 0.5;
const GROWTH_MIN = 0.5;
const GROWTH_MAX = 2;

export function seasonalProjection(
  counts: number[],
  months: { year: number; month: number }[],
  smaValues: (number | null)[],
  spikeIdx: Set<number>,
  next: { label: string; year: number; month: number }[],
  now = new Date(),
) {
  const n = counts.length;
  const last = months[n - 1];
  const partial = !!last && last.year === now.getFullYear() && last.month === now.getMonth() + 1;
  const lastComplete = partial ? n - 2 : n - 1;
  const indexOf = (year: number, month: number) =>
    months.findIndex((m) => m.year === year && m.month === month);
  const sum = (from: number, to: number) => {
    let s = 0;
    for (let i = from; i <= to; i++) s += counts[i] || 0;
    return s;
  };
  // Growth as known at the END of month `end` (3 months ending there vs the
  // same 3 a year earlier). Null when the year-ago window is missing/empty.
  const growthAt = (end: number) => {
    if (end - 14 < 0) return null;
    const prior = sum(end - 14, end - 12);
    if (prior <= 0) return null;
    return Math.min(GROWTH_MAX, Math.max(GROWTH_MIN, sum(end - 2, end) / prior));
  };
  const usableYearAgo = (i: number) => i >= 0 && !spikeIdx.has(i) && counts[i] > 0;

  // Backtest: predict each of the last ≤8 complete months from what was
  // known the month before, both ways, on the SAME points.
  const actual: number[] = [];
  const smaPred: (number | null)[] = [];
  const blendPred: (number | null)[] = [];
  for (let t = Math.max(0, lastComplete - 7); t <= lastComplete; t++) {
    const base = smaValues[t - 1];
    const g = growthAt(t - 1);
    if (t < 1 || base === null || base === undefined || g === null || !usableYearAgo(t - 12) || !counts[t]) continue;
    actual.push(counts[t]);
    smaPred.push(base);
    blendPred.push((1 - SEASONAL_WEIGHT) * base + SEASONAL_WEIGHT * counts[t - 12] * g);
  }
  const smaErrorPct = mape(actual, smaPred);
  const seasonalErrorPct = mape(actual, blendPred);
  const growth = lastComplete >= 0 ? growthAt(lastComplete) : null;
  const used = actual.length >= 3
    && growth !== null
    && smaErrorPct !== null && seasonalErrorPct !== null
    && seasonalErrorPct < smaErrorPct;

  let base: number | null = null;
  for (const v of smaValues) if (v !== null && v !== undefined) base = v;

  const projections = next.map((t) => {
    const flat = base === null ? null : round1(base);
    const ya = indexOf(t.year - 1, t.month);
    if (!used || base === null || growth === null || !usableYearAgo(ya)) {
      return { label: t.label, value: flat, lastYear: ya >= 0 ? counts[ya] : null, seasonal: false };
    }
    const value = round1((1 - SEASONAL_WEIGHT) * base + SEASONAL_WEIGHT * counts[ya] * growth);
    return { label: t.label, value, lastYear: counts[ya], seasonal: true };
  });

  return {
    used,
    growth: growth === null ? null : Math.round(growth * 100) / 100,
    smaErrorPct,
    seasonalErrorPct,
    backtestPoints: actual.length,
    projections,
  };
}

// ---- Small pure forecast helpers (shared by the monthly + weekly paths) ----

// Expected range: ±backtest error around a projection. Above 100% it is not
// a range, so none is given (the UI says "varies a lot").
function rangeFor(value: number | null, errPct: number | null | undefined) {
  if (value === null || errPct === null || errPct === undefined || errPct > 100) return { low: null, high: null };
  return { low: Math.max(0, round1(value * (1 - errPct / 100))), high: round1(value * (1 + errPct / 100)) };
}

// The period in progress: count so far, straight-line pace for the whole
// period, and the projection it is tracking against.
function currentPeriod(
  label: string, count: number, daysElapsed: number, daysTotal: number,
  proj: { value: number | null; low: number | null; high: number | null } | null,
) {
  return {
    label,
    count,
    daysElapsed,
    daysInMonth: daysTotal,
    pace: round1((count * daysTotal) / Math.max(1, daysElapsed)),
    projected: proj?.value ?? null,
    low: proj?.low ?? null,
    high: proj?.high ?? null,
  };
}

// A busy month is a one-off spike only if that CALENDAR month isn't busy in
// any other year: a December rush every year is the seasonal pattern itself,
// and dropping it removed exactly the peaks the seasonal outlook needs.
function oneOffSpikes(flags: SpikeFlag[], counts: number[], months: { month: number }[]) {
  const sorted = [...counts].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const busy = (i: number) => counts[i] > Math.max(1, median) * 1.5;
  return flags.filter((f) => !months.some((m, j) => j !== f.index && m.month === months[f.index].month && busy(j)));
}

// Average rentals per calendar month across complete history, indexed to the
// typical month (1.4 = 40% busier). One-off spikes are left out. Needs a year.
function calendarProfile(counts: number[], months: { month: number }[], spikes: SpikeFlag[]) {
  if (counts.length < 12) return [];
  const buckets = Array.from({ length: 12 }, () => ({ sum: 0, n: 0 }));
  months.forEach((m, i) => {
    if (spikes.some((f) => f.index === i)) return;
    buckets[m.month - 1].sum += counts[i];
    buckets[m.month - 1].n += 1;
  });
  const avgs = buckets.map((b) => (b.n ? b.sum / b.n : null));
  const known = avgs.filter((a): a is number => a !== null);
  const overall = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  return avgs.map((a, i) => ({
    month: i + 1,
    avg: a === null ? 0 : round1(a),
    index: a === null || overall <= 0 ? 0 : Math.round((a / overall) * 100) / 100,
    samples: buckets[i].n,
  }));
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
    // The item→category map doesn't depend on the month window, so it loads
    // alongside getDataMonths; the window-bound queries then share one round
    // trip.
    const [{ months, firstMonth }, items] = await Promise.all([
      getDataMonths(true),
      // category split is enrichment — never fail the forecast
      prisma.inventoryItem.findMany({ select: { id: true, category: true } }).catch(() => []),
    ]);
    const catOf = new Map<number, string>();
    for (const it of items) catOf.set(it.id, it.category || 'Other');

    // ONE query instead of one count per month — bucket by period in JS so the
    // remote pooler only sees a single round trip regardless of history length.
    // Cancelled bookings count too: they still represent demand (the customer
    // tried to rent), so the SMA isn't artificially depressed on a
    // cancellation-heavy month.
    // Imported logbook history (HistoricalRecord) joins the same series:
    // each row is one past rental carrying its own category + event date.
    // These rows are analytical-only everywhere else — the forecast is the
    // one place they count, which is exactly what lengthens the history and
    // sharpens the category split.
    const [rows, historyRows] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          status: { in: FORECAST_STATUSES },
          createdAt: { gte: firstMonth },
          // Demand from archived items must not drive restock projections.
          item: { status: { not: 'Deleted' } },
        },
        select: { createdAt: true, itemId: true },
      }),
      prisma.historicalRecord.findMany({
        where: { eventDate: { gte: firstMonth } },
        select: { eventDate: true, category: true },
      }).catch(() => [] as { eventDate: Date; category: string }[]), // no history yet — transactions alone
    ]);
    const points: { date: Date; category: string }[] = [
      ...rows.map((t) => ({ date: t.createdAt, category: catOf.get(t.itemId) || 'Other' })),
      ...historyRows.map((h) => ({ date: h.eventDate, category: (h.category || '').trim() || 'Other' })),
    ];

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
        return points.filter(t => t.date >= w.start && t.date < end).length;
      });
      // The last bucket is the week in progress — shown, never averaged (same
      // rule as the unfinished month).
      const done = weeklyCounts.slice(0, -1);
      const series = buildForecastSeries(done, period);
      const nextLabels = [1, 2, 3].map(i => {
        const d = new Date(weeks[weeks.length - 1].start);
        d.setDate(d.getDate() + i * 7);
        return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
      });
      const historyMonths = (now.getFullYear() - firstMonday.getFullYear()) * 12 + (now.getMonth() - firstMonday.getMonth()) + 1;
      const confidence = effectiveConfidence(forecastConfidence(historyMonths), series.errorPct);
      const err = series.errorPct;
      const weekProj = projectForward(series.values, weeks.map(w => w.label), nextLabels)
        .map((p) => ({ ...p, ...rangeFor(p.value, err) }));
      const lastWeek = weeks[weeks.length - 1];
      const daysElapsed = Math.min(7, Math.floor((now.getTime() - lastWeek.start.getTime()) / 86400000) + 1);
      const flat = weekProj[0]?.value ?? null;
      return {
        labels: weeks.map(w => w.label),
        counts: weeklyCounts,
        sma: [...series.values, null],
        flags: series.flags,
        errorPct: series.errorPct,
        band: { lo: [...series.band.lo, null], hi: [...series.band.hi, null] },
        provisional: series.provisional,
        period: series.effectivePeriod,
        granularity,
        partialIndex: weeks.length - 1,
        current: currentPeriod(`Week of ${lastWeek.label}`, weeklyCounts[weeklyCounts.length - 1], daysElapsed, 7,
          { value: flat, ...rangeFor(flat, err) }),
        seasonalProfile: [],
        projectionMethod: 'average',
        projections: weekProj,
        byCategory: [],
        historyMonths,
        historyPoints: historyRows.length,
        confidence,
        confidenceNote: `Last ${FORECAST_WEEKS} weeks · ${confidence} confidence${forecastErrorNote(series.errorPct)}`,
      };
    }

    const monthlyCounts = months.map(m =>
      points.filter(t => t.date.getFullYear() === m.year && t.date.getMonth() === m.month - 1).length
    );

    // The unfinished current month is NOT a data point for the average: on
    // the 30th it holds a month's worth, on the 3rd almost nothing, and in
    // both cases it dragged the trend down and widened the backtest error.
    // The series is built on COMPLETE months; the current month is reported
    // separately (so far + full-month projection) and keeps its bar.
    const nowM = new Date();
    const last = months[months.length - 1];
    const partial = !!last && last.year === nowM.getFullYear() && last.month === nowM.getMonth() + 1;
    const completeN = partial ? months.length - 1 : months.length;
    const completeCounts = monthlyCounts.slice(0, completeN);
    const completeMonths = months.slice(0, completeN);
    const rawSeries = buildForecastSeries(completeCounts, period);
    // The moving average still caps every spike; only yearly-recurring peaks
    // are dropped from the one-off flags (see oneOffSpikes).
    const series = { ...rawSeries, flags: oneOffSpikes(rawSeries.flags, completeCounts, completeMonths) };
    const pad = <T,>(arr: T[]) => (partial ? [...arr, null] : arr);

    // Targets: the current month (when partial) + the next 3 full months.
    const lastComplete = completeMonths[completeMonths.length - 1];
    const targets = lastComplete
      ? nextMonthLabels(lastComplete.year, lastComplete.month, FORECAST_HORIZON + (partial ? 1 : 0))
      : [];
    // Seasonal blend when it backtests better than the flat average; the
    // flat projection otherwise (seasonalProjection falls back per month).
    const seasonal = seasonalProjection(
      completeCounts,
      completeMonths,
      series.values,
      new Set(series.flags.map((f) => f.index)),
      targets,
      nowM,
    );
    // Ranges come from the WINNING method's backtest error.
    const winErr = seasonal.used ? seasonal.seasonalErrorPct : series.errorPct;
    const allProj = seasonal.projections.map(({ label, value, lastYear, seasonal: s }) => (
      { label, value, lastYear, seasonal: s, ...rangeFor(value, winErr) }
    ));
    const projections = partial ? allProj.slice(1) : allProj;
    const current = partial && last
      ? (() => {
          const daysInMonth = new Date(last.year, last.month, 0).getDate();
          return currentPeriod(last.label, monthlyCounts[months.length - 1],
            Math.min(daysInMonth, nowM.getDate()), daysInMonth, allProj[0]);
        })()
      : null;
    const seasonalProfile = calendarProfile(completeCounts, completeMonths, series.flags);

    // Per-category series over the same month buckets (top categories by
    // volume) so the UI can show which lines are actually driving demand.
    // `points` already carries resolved categories (live items + imports).
    const totals = new Map<string, number>();
    for (const t of points) {
      totals.set(t.category, (totals.get(t.category) || 0) + 1);
    }
    const topCats = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, FORECAST_TOP_CATEGORIES).map(e => e[0]);
    // Trend must not compare a half-finished month against a full one (that
    // reads "down" all month and silenced the restock rule). Once a week of
    // the current month has passed, its count is pro-rated to a full-month
    // pace; before that the two latest COMPLETE months are compared.
    const daysElapsed = nowM.getDate();
    const daysInCur = new Date(nowM.getFullYear(), nowM.getMonth() + 1, 0).getDate();
    const trendOf = (counts: number[]): 'up' | 'down' | 'flat' => {
      let latest = counts.length ? counts[counts.length - 1] : 0;
      let prev = counts.length > 1 ? counts[counts.length - 2] : 0;
      if (partial) {
        if (daysElapsed >= 7) {
          latest = (latest * daysInCur) / daysElapsed;
        } else {
          latest = prev;
          prev = counts.length > 2 ? counts[counts.length - 3] : 0;
        }
      }
      return latest > prev ? 'up' : latest < prev ? 'down' : 'flat';
    };
    // Recent volume (last 3 complete months) for each category's demand share.
    const recentFrom = Math.max(0, completeN - 3);
    let recentTotal = 0;
    const byCategoryRaw = topCats.map(category => {
      const counts = months.map(m =>
        points.filter(t =>
          t.category === category &&
          t.date.getFullYear() === m.year && t.date.getMonth() === m.month - 1
        ).length
      );
      // Same rule as the total: the average runs on complete months only.
      const catSma = sma(counts.slice(0, completeN), period);
      let catLast: number | null = null;
      for (const v of catSma) if (v !== null && v !== undefined) catLast = v;
      const latest = counts.length ? counts[counts.length - 1] : 0;
      const average = counts.length ? round1(counts.reduce((a, b) => a + b, 0) / counts.length) : 0;
      const recent = counts.slice(recentFrom, completeN).reduce((a, b) => a + b, 0);
      recentTotal += recent;
      return {
        category,
        latest,
        average,
        recent,
        projection: catLast === null ? null : round1(catLast),
        trend: trendOf(counts),
      };
    });
    const byCategory = byCategoryRaw.map(({ recent, ...c }) => ({
      ...c,
      share: recentTotal > 0 ? Math.round((recent / recentTotal) * 100) : 0,
    }));

    return {
      labels: months.map(m => m.label),
      counts: monthlyCounts,
      sma: pad(series.values),
      flags: series.flags,
      errorPct: series.errorPct,
      band: { lo: pad(series.band.lo), hi: pad(series.band.hi) },
      provisional: series.provisional,
      period: series.effectivePeriod,
      granularity,
      partialIndex: partial ? months.length - 1 : null,
      current,
      seasonalProfile,
      projections,
      // How the outlook was made, so the UI can say it in plain words and
      // show the backtest that justified it.
      projectionMethod: seasonal.used ? 'seasonal' : 'average',
      seasonality: {
        growth: seasonal.growth,
        averageErrorPct: seasonal.smaErrorPct,
        seasonalErrorPct: seasonal.seasonalErrorPct,
        backtestPoints: seasonal.backtestPoints,
      },
      byCategory,
      historyMonths: completeN,
      historyPoints: historyRows.length,
      confidence: effectiveConfidence(forecastConfidence(completeN), winErr),
      confidenceNote: `Based on ${completeN} complete month${completeN === 1 ? '' : 's'} · ${effectiveConfidence(forecastConfidence(completeN), winErr)} confidence${forecastErrorNote(winErr)}`,
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
  // Deleted items are excluded everywhere here: archived pieces are not
  // rentable stock, so they must not inflate category totals, appear in
  // top/underperforming lists, or show up as dead "0% utilised" rows on the
  // Category Performance card. OutOfService stays IN (still boutique-owned
  // stock, e.g. damaged pieces awaiting repair — the restock rules need them
  // for accurate free-unit counts); only Deleted is terminal-archived.
  // Revenue is collected payments only (both ledger paths — see
  // COLLECTED_PAYMENT_STATUS), bucketed by payment date in JS. Category
  // revenue rides the same rows via the payment's transaction item, so every
  // revenue figure on this endpoint shares one definition.
  const paymentWhere: any = { status: { in: COLLECTED_PAYMENT_STATUS } };
  if (filter?.start) paymentWhere.createdAt = { gte: filter.start };
  if (filter?.end) paymentWhere.createdAt = { ...paymentWhere.createdAt, lt: filter.end };

  // Logbook window (same bounds) shared by the category counts and the
  // monthly/weekly logbook price series.
  const histCatWhere: any = {};
  if (filter?.start) histCatWhere.eventDate = { gte: filter.start };
  if (filter?.end) histCatWhere.eventDate = { ...histCatWhere.eventDate, lt: filter.end };

  // All of these are independent, so they share ONE round trip to the remote
  // pooler instead of running back to back (~400ms each — this endpoint used
  // to take ~3s cold).
  const [items, txs, dataMonths, payments, historyGroups, logRows] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { status: { not: 'Deleted' } },
      select: { id: true, name: true, category: true },
    }),
    // Per-item rental counts and category "rented" units come from this one
    // transaction query. Transactions on Deleted items are excluded too —
    // otherwise an archived item's PAST rentals would still credit its
    // category with "rented" units that no longer reflect rentable stock.
    prisma.transaction.findMany({
      where: { ...txWhere, item: { status: { not: 'Deleted' } } },
      select: {
        itemId: true,
        rentalFee: true,
        createdAt: true,
        item: { select: { category: true } },
      },
    }),
    // Months span logbook history too (the chart adds logbook revenue per bar).
    getDataMonths(true),
    prisma.payment.findMany({
      where: paymentWhere,
      select: {
        amount: true,
        createdAt: true,
        transaction: { select: { item: { select: { category: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    // Logbook demand per category (counts only — no pesos, no item linkage
    // needed). The Category Performance card renders these as "+N logbook"
    // companions next to the live utilisation bars.
    prisma.historicalRecord.groupBy({
      by: ['category'],
      where: histCatWhere,
      _count: { id: true },
    }).catch(() => [] as { category: string; _count: { id: number } }[]), // enrichment only
    // Imported logbook prices for the monthly + weekly chart companions.
    prisma.historicalRecord.findMany({
      where: histCatWhere,
      select: { eventDate: true, price: true },
    }).catch(() => [] as { eventDate: Date; price: number | null }[]), // enrichment only
  ]);

  const categoryBreakdown: Record<string, { total: number; rented: number }> = {};
  for (const item of items) {
    if (!categoryBreakdown[item.category]) {
      categoryBreakdown[item.category] = { total: 0, rented: 0 };
    }
    categoryBreakdown[item.category].total++;
  }
  const itemById = new Map(items.map(i => [i.id, i]));
  const rentedItemIds = new Set(txs.map(t => t.itemId));
  for (const itemId of rentedItemIds) {
    const item = itemById.get(itemId);
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
  const topRented = itemRentalCounts.filter(i => i.rentals > 0).slice(0, 10);
  // "Underperforming → promote" only makes sense when SOME items are being
  // rented; with zero activity the whole catalog isn't underperforming, there's
  // simply no data yet.
  const underperforming = hasRentalActivity
    ? itemRentalCounts.filter(i => i.rentals === 0).slice(0, 10)
    : [];

  // The month window is cut at BOTH ends: a past year used to run on past its
  // December into the present, drawing a row of empty ₱0 months.
  const filteredMonths = dataMonths.months.filter((m) => {
    const d = new Date(m.year, m.month - 1, 1);
    return (!filter?.start || d >= filter.start) && (!filter?.end || d < filter.end);
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
  let logbookByWeek: number[] | undefined;
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
    // Imported logbook prices for the same month, bucketed by the recorded
    // event day. These are full paper-log rentals, not collected payments, so
    // they ride alongside revenueByWeek (same indices) instead of being merged
    // into the ledger figure; the chart combines them and labels the split.
    const logbookBuckets = [0, 0, 0, 0, 0];
    const monthEnd = filter.end || new Date(y, mo + 1, 1);
    for (const r of logRows ?? []) {
      if (r.eventDate < filter.start || r.eventDate >= monthEnd) continue;
      logbookBuckets[weekOf(r.eventDate.getDate())] += r.price || 0;
    }
    logbookByWeek = logbookBuckets;
  }

  const revenueByCategory: Record<string, number> = {};
  for (const p of payments) {
    const cat = p.transaction?.item?.category;
    if (!cat) continue;
    revenueByCategory[cat] = (revenueByCategory[cat] || 0) + p.amount;
  }

  const historyByCategory: Record<string, number> = {};
  for (const g of historyGroups ?? []) historyByCategory[g.category] = g._count.id;

  // Imported logbook prices per month, aligned with revenueByMonth. Kept
  // separate so the ledger figure stays pure; the chart adds them per bar and
  // the tooltip labels "Collected" vs "Logbook".
  const logbookByMonth = filteredMonths.map(m =>
    (logRows ?? [])
      .filter(r => inMonth(r.eventDate, m))
      .reduce((sum, r) => sum + (r.price || 0), 0)
  );

  return {
    categoryBreakdown,
    historyByCategory,
    topRented,
    underperforming,
    revenueByMonth,
    logbookByMonth,
    // Only present when a month was pinned (current or past). Other views keep
    // the monthly series (undefined fields are dropped by JSON).
    ...(revenueByWeek ? { revenueByWeek } : {}),
    ...(logbookByWeek ? { logbookByWeek } : {}),
    // Echo the queried window so the frontend can label the weekly chart for
    // a past month (e.g. "Jun 2025 · Wk 2") instead of assuming "this month".
    ...(filter?.start ? { insightsPeriod: { start: filter.start.toISOString() } } : {}),
    revenueByCategory,
    totalItems: items.length,
    totalRented: rentedItemIds.size,
  };
}

// Tiny version fingerprint for cross-device freshness: the frontend polls
// this every ~15s (~100 bytes) and only refetches the heavy lists when the
// fingerprint moves — instead of re-pulling ~400KB on a timer. Two cheap
// aggregates (indexed MAX + COUNTs) instead of full row scans.
// Cached alongside everything else: ANY mutation clears it via
// clearDataCache(), including the 1-min scheduler flag flips (overdue
// status changes move maxTx). Counts ride along so the UI can decide
// whether a change even affects the visible tab (e.g. inventory-only
// change while on Tasks still refetches — cheap correctness over cleverness).
export async function getDataVersion() {
  return cacheOrCompute('dataVersion', async () => {
    const [maxTx, txCount, maxItem, itemCount, recordCount] = await Promise.all([
      prisma.transaction.aggregate({ _max: { updatedAt: true } }),
      prisma.transaction.count(),
      prisma.inventoryItem.aggregate({ _max: { updatedAt: true } }),
      prisma.inventoryItem.count(),
      // Logbook imports/deletes move the BI numbers too (forecast, KPIs,
      // category companions) — count them so the 15s freshness poll refetches
      // after an import instead of sitting on stale cards.
      prisma.historicalRecord.count().catch(() => 0),
    ]);
    const version = Math.max(
      maxTx._max.updatedAt?.getTime() ?? 0,
      maxItem._max.updatedAt?.getTime() ?? 0,
    );
    return {
      version,
      txCount,
      itemCount,
      recordCount,
      // ISO for debugging (which write moved the needle); numeric `version`
      // is what the client compares.
      at: new Date(version || Date.now()).toISOString(),
    };
  });
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
