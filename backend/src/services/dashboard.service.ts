import { prisma } from '../config/database.js';
import { sma } from '../utils/sma.js';

function applyPeriod(where: any, filter?: { start?: Date; end?: Date }) {
  if (filter?.start) where.createdAt = { gte: filter.start };
  if (filter?.end) where.createdAt = { ...where.createdAt, lt: filter.end };
  return where;
}

export async function getKpis(filter?: { start?: Date; end?: Date }) {
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
    filter?.start ? aggregateRevenueFrom(filter.start) : aggregateMonthlyRevenue(),
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
    overdueRate: pct(overdueReturns, activeRentals),
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
    where: { status: 'Overdue' },
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
  const { months } = await getDataMonths();
  const now = new Date();

  const monthlyCounts = await Promise.all(
    months.map(async (m) => {
      const start = new Date(m.year, m.month - 1, 1);
      const end = new Date(m.year, m.month, 1);
      const count = await prisma.transaction.count({
        where: {
          status: { in: ['Returned', 'Active', 'Overdue'] },
          createdAt: { gte: start, lt: end },
        },
      });
      return count;
    })
  );

  const smaValues = sma(monthlyCounts, period);

  return {
    labels: months.map(m => m.label),
    counts: monthlyCounts,
    sma: smaValues,
    period,
  };
}

export async function getInsights(filter?: { start?: Date; end?: Date }) {
  const txWhere: any = { status: { in: ['Active', 'Returned', 'Overdue'] } };
  if (filter?.start) txWhere.createdAt = { gte: filter.start };
  if (filter?.end) txWhere.createdAt = { ...txWhere.createdAt, lt: filter.end };

  const items = await prisma.inventoryItem.findMany({
    include: { transactions: { where: txWhere, select: { id: true } } },
  });

  const categoryBreakdown: Record<string, { total: number; rented: number }> = {};
  for (const item of items) {
    if (!categoryBreakdown[item.category]) {
      categoryBreakdown[item.category] = { total: 0, rented: 0 };
    }
    categoryBreakdown[item.category].total++;
    if (item.transactions.length > 0) {
      categoryBreakdown[item.category].rented++;
    }
  }

  const itemRentalCounts = items
    .map(item => ({ id: item.id, name: item.name, category: item.category, rentals: item.transactions.length }))
    .sort((a, b) => b.rentals - a.rentals);

  const topRented = itemRentalCounts.slice(0, 5);
  const underperforming = itemRentalCounts.filter(i => i.rentals === 0).slice(0, 10);

  const { months } = await getDataMonths();
  const paymentWhere: any = { status: 'succeeded' };
  if (filter?.start) paymentWhere.createdAt = { gte: filter.start };
  if (filter?.end) paymentWhere.createdAt = { ...paymentWhere.createdAt, lt: filter.end };
  const payments = await prisma.payment.findMany({
    where: paymentWhere,
    select: { amount: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const hasPayments = payments.length > 0;
  const revenueByMonth: { label: string; revenue: number }[] = [];

  const filteredMonths = filter?.start
    ? months.filter(m => new Date(m.year, m.month - 1, 1) >= filter.start!)
    : months;

  for (const m of filteredMonths) {
    const label = m.label;
    const start = new Date(m.year, m.month - 1, 1);
    const end = new Date(m.year, m.month, 1);
    const revenue = hasPayments
      ? payments.filter(p => p.createdAt >= start && p.createdAt < end).reduce((sum, p) => sum + p.amount, 0)
      : await prisma.transaction.aggregate({
          _sum: { rentalFee: true },
          where: {
            status: { in: ['Active', 'Overdue', 'Returned'] },
            createdAt: { gte: start, lt: end },
          },
        }).then(r => r._sum.rentalFee || 0);
    revenueByMonth.push({ label, revenue });
  }

  const txWithItems = await prisma.transaction.findMany({
    where: txWhere,
    select: { rentalFee: true, item: { select: { category: true } } },
  });
  const revenueByCategory: Record<string, number> = {};
  for (const tx of txWithItems) {
    const cat = tx.item.category;
    revenueByCategory[cat] = (revenueByCategory[cat] || 0) + tx.rentalFee;
  }

  return {
    categoryBreakdown,
    topRented,
    underperforming,
    revenueByMonth,
    revenueByCategory,
    totalItems: items.length,
    totalRented: items.filter(i => i.transactions.length > 0).length,
  };
}
