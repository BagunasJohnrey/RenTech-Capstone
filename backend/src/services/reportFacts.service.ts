// Deterministic report facts: the exact figures behind an AI business report,
// built from the SAME data the model is given. The report's KPI tiles, charts
// and tables are drawn from these numbers instead of being re-read out of the
// AI's sentences, so a differently phrased line (or a "₱3,786.5K" rounding)
// can never drop a category or change an amount. Saved alongside the report
// so reopened reports show the same figures. Pure function, no DB access.

export interface ReportFacts {
  version: 1;
  kpis: {
    monthlyRevenue: number;
    prevMonthRevenue: number;
    todayRevenue: number;
    totalRevenue: number; // app + logbook for the revenue period
    collectedInApp: number;
    logbookRevenue: number;
    revenuePeriod: string;
    activeRentals: number;
    overdueReturns: number;
    returnedCount: number;
    cancelledCount: number;
    damagedItems: number;
    totalItems: number;
    availableItems: number;
    inUseItems: number;
    utilizationRate: number;
    overdueRate: number; // overdue ÷ (overdue + returned)
    returnedRate: number;
    cancellationRate: number;
  };
  // In-app collected payments only (logbook rows carry no item/category price split).
  revenueByCategory: { label: string; value: number }[];
  // Live stock: pieces not Available right now — sums to kpis.inUseItems.
  categoryStock: { label: string; total: number; inUse: number }[];
  topItems: { label: string; value: number }[];
  categoryProjections: { label: string; value: number; trend: 'up' | 'down' | 'flat' }[];
}

type Num = number | null | undefined;
const n = (v: Num) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function buildReportFacts(input: {
  kpis: Record<string, unknown>;
  insights: Record<string, unknown> | null | undefined;
  forecast: Record<string, unknown> | null | undefined;
  analyticsItems: { category: string; status: string }[] | null | undefined;
}): ReportFacts {
  const k = (input.kpis || {}) as Record<string, Num | string>;
  const num = (key: string) => n(k[key] as Num);
  const collected = num('totalRevenue');
  const logbook = num('totalLogbookRevenue');
  const total = typeof k.totalRevenueInclLogbook === 'number' ? (k.totalRevenueInclLogbook as number) : collected + logbook;

  const insights = (input.insights || {}) as {
    revenueByCategory?: Record<string, number>;
    topRented?: { name: string; category: string; rentals: number }[];
  };
  const revenueByCategory = Object.entries(insights.revenueByCategory || {})
    .map(([label, value]) => ({ label, value: n(value) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const stock = new Map<string, { total: number; inUse: number }>();
  for (const it of input.analyticsItems || []) {
    if (!it || it.status === 'Deleted') continue;
    const s = stock.get(it.category) || { total: 0, inUse: 0 };
    s.total++;
    if (it.status !== 'Available') s.inUse++;
    stock.set(it.category, s);
  }
  const categoryStock = [...stock.entries()]
    .map(([label, s]) => ({ label, ...s }))
    .sort((a, b) => b.total - a.total);

  const topItems = (insights.topRented || [])
    .filter((i) => n(i.rentals) > 0)
    .slice(0, 6)
    .map((i) => ({ label: `${i.name} (${i.category})`, value: n(i.rentals) }));

  const byCat = ((input.forecast || {}) as { byCategory?: { category: string; projection: number | null; trend: string }[] }).byCategory || [];
  const categoryProjections = byCat
    .filter((c) => typeof c.projection === 'number' && c.projection > 0)
    .map((c) => ({
      label: c.category,
      value: c.projection as number,
      trend: (c.trend === 'up' || c.trend === 'down' ? c.trend : 'flat') as 'up' | 'down' | 'flat',
    }))
    .sort((a, b) => b.value - a.value);

  return {
    version: 1,
    kpis: {
      monthlyRevenue: num('monthlyRevenue'),
      prevMonthRevenue: num('prevMonthRevenue'),
      todayRevenue: num('todayRevenue'),
      totalRevenue: total,
      collectedInApp: collected,
      logbookRevenue: logbook,
      revenuePeriod: typeof k.revenueScope === 'string' ? (k.revenueScope as string) : 'all time',
      activeRentals: num('activeRentals'),
      overdueReturns: num('overdueReturns'),
      returnedCount: num('returnedCount'),
      cancelledCount: num('cancelledCount'),
      damagedItems: num('damagedItems'),
      totalItems: num('totalItems'),
      availableItems: num('availableItems'),
      inUseItems: num('inUseItems'),
      utilizationRate: num('utilizationRate'),
      overdueRate: num('overdueRate'),
      returnedRate: num('returnedRate'),
      cancellationRate: num('cancellationRate'),
    },
    revenueByCategory,
    categoryStock,
    topItems,
    categoryProjections,
  };
}
