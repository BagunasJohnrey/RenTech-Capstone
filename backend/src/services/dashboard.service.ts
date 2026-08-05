import { prisma } from '../config/database.js';
import { sma } from '../utils/sma.js';
import { cacheOrCompute } from '../utils/ttlCache.js';

function applyPeriod(where: any, filter?: { start?: Date; end?: Date }) {
  if (filter?.start) where.createdAt = { gte: filter.start };
  if (filter?.end) where.createdAt = { ...where.createdAt, lt: filter.end };
  return where;
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
    totalItems,
    availableItems,
    inUseItems,
    utilizationRate: pct(inUseItems, totalItems),
    overdueRate: pct(overdueReturns, overdueReturns + returnedCount),
    returnedRate: pct(returnedCount, allTransactions),
    cancellationRate: pct(cancelledCount, allTransactions),
  };
}

async function aggregateRevenueBetween(start: Date, end: Date) {
  const paymentSum = await prisma.payment.aggregate({
    _sum: { amount: true },
    where: { status: 'succeeded', createdAt: { gte: start, lt: end } },
  });
  if (paymentSum._sum.amount) return paymentSum._sum.amount;
  const txSum = await prisma.transaction.aggregate({
    _sum: { rentalFee: true },
    where: { status: { in: ['Active', 'Overdue', 'Returned'] }, createdAt: { gte: start, lt: end } },
  });
  return txSum._sum.rentalFee || 0;
}

async function aggregateRevenueFrom(start: Date, end?: Date) {
  const where: any = { status: 'succeeded', createdAt: { gte: start } };
  if (end) where.createdAt.lt = end;
  const paymentSum = await prisma.payment.aggregate({ _sum: { amount: true }, where });
  if (paymentSum._sum.amount) return paymentSum._sum.amount;
  const txWhere: any = { status: { in: ['Active', 'Overdue', 'Returned'] }, createdAt: { gte: start } };
  if (end) txWhere.createdAt.lt = end;
  const txSum = await prisma.transaction.aggregate({ _sum: { rentalFee: true }, where: txWhere });
  return txSum._sum.rentalFee || 0;
}

async function aggregateMonthlyRevenue() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const paymentSum = await prisma.payment.aggregate({
    _sum: { amount: true },
    where: {
      status: 'succeeded',
      createdAt: { gte: startOfMonth },
    },
  });

  if (paymentSum._sum.amount) return paymentSum._sum.amount;

  const transactions = await prisma.transaction.aggregate({
    _sum: { rentalFee: true },
    where: {
      status: { in: ['Active', 'Overdue', 'Returned'] },
      createdAt: { gte: startOfMonth },
    },
  });

  return transactions._sum.rentalFee || 0;
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

export async function getForecast(period: number = 3) {
  const key = `forecast:${period}`;
  return cacheOrCompute(key, async () => {
    const { months, firstMonth } = await getDataMonths();

    // ONE query instead of one count per month — bucket by month in JS so the
    // remote pooler only sees a single round trip regardless of history length.
    // Cancelled bookings count too: they still represent demand (the customer
    // tried to rent), so the SMA isn't artificially depressed on a
    // cancellation-heavy month.
    const rows = await prisma.transaction.findMany({
      where: {
        status: { in: ['Returned', 'Active', 'Overdue', 'Cancelled'] },
        createdAt: { gte: firstMonth },
      },
      select: { createdAt: true },
    });

    const monthlyCounts = months.map(m =>
      rows.filter(t => t.createdAt.getFullYear() === m.year && t.createdAt.getMonth() === m.month - 1).length
    );

    const smaValues = sma(monthlyCounts, period);

    return {
      labels: months.map(m => m.label),
      counts: monthlyCounts,
      sma: smaValues,
      period,
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
  const txWhere: any = { status: { in: ['Active', 'Returned', 'Overdue'] } };
  if (filter?.start) txWhere.createdAt = { gte: filter.start };
  if (filter?.end) txWhere.createdAt = { ...txWhere.createdAt, lt: filter.end };

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

  const topRented = itemRentalCounts.slice(0, 5);
  const underperforming = itemRentalCounts.filter(i => i.rentals === 0).slice(0, 10);

  const { months } = await getDataMonths();
  const filteredMonths = filter?.start
    ? months.filter(m => new Date(m.year, m.month - 1, 1) >= filter.start!)
    : months;

  // Revenue prefers succeeded payments when any exist (accurate cash-in), else
  // falls back to rental fees. Payments are fetched once and bucketed in JS —
  // the old per-month aggregate loop is gone (6+ sequential round trips).
  const paymentWhere: any = { status: 'succeeded' };
  if (filter?.start) paymentWhere.createdAt = { gte: filter.start };
  if (filter?.end) paymentWhere.createdAt = { ...paymentWhere.createdAt, lt: filter.end };
  const payments = await prisma.payment.findMany({
    where: paymentWhere,
    select: { amount: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const hasPayments = payments.length > 0;

  const inMonth = (d: Date, m: { year: number; month: number }) =>
    d.getFullYear() === m.year && d.getMonth() === m.month - 1;

  const revenueByMonth = filteredMonths.map(m => {
    const revenue = hasPayments
      ? payments.filter(p => inMonth(p.createdAt, m)).reduce((sum, p) => sum + p.amount, 0)
      : txs.filter(t => inMonth(t.createdAt, m)).reduce((sum, t) => sum + (t.rentalFee || 0), 0);
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
    const inRange = hasPayments
      ? payments.filter(p => inThisMonth(p.createdAt))
      : txs.filter(t => inThisMonth(t.createdAt));
    const weekOf = (day: number) => Math.min(4, Math.floor((day - 1) / 7)); // 0..4
    const buckets = [0, 0, 0, 0, 0];
    for (const r of inRange) {
      const d = (r as any).createdAt as Date;
      buckets[weekOf(d.getDate())] += hasPayments ? (r as any).amount : ((r as any).rentalFee || 0);
    }
    revenueByWeek = buckets.map((revenue, i) => ({ label: `Wk ${i + 1}`, revenue }));
  }

  const revenueByCategory: Record<string, number> = {};
  for (const t of txs) {
    const cat = t.item?.category;
    if (!cat) continue;
    revenueByCategory[cat] = (revenueByCategory[cat] || 0) + (t.rentalFee || 0);
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
