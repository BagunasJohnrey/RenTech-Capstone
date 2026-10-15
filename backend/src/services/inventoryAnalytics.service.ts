import { prisma } from '../config/database.js';
import { cacheOrCompute } from '../utils/ttlCache.js';

type TxShape = {
  id: string;
  itemId: number;
  rentalFee: number;
  rentalDate: Date;
  returnDate: Date | null;
  dueDate: Date;
  status: string;
  releasePhoto: string | null;
  conditionPhoto: string | null;
};

export async function getInventoryAnalytics(startDate?: Date, endDate?: Date) {
  const key = startDate
    ? `inventory-analytics:${startDate.toISOString()}:${endDate?.toISOString() ?? 'open'}`
    : 'inventory-analytics:all';
  return cacheOrCompute(key, async () => {
    const txWhere: any = { status: { in: ['Active', 'Returned', 'Overdue'] } };
    if (startDate || endDate) {
      txWhere.rentalDate = {};
      if (startDate) txWhere.rentalDate.gte = startDate;
      if (endDate) txWhere.rentalDate.lt = endDate;
    }
    // Transactions on Deleted items excluded (same rule as the items query):
    // an archived piece's past rentals must not credit it with utilisation
    // or revenue on the performance tables.
    txWhere.item = { status: { not: 'Deleted' } };

    // Light item select + one transaction query, grouped in JS — the old
    // `include: { transactions }` loaded every item's full history into memory.
    // Deleted items excluded (same rule as dashboard insights): archived pieces
    // are not rentable stock and must not appear as 0%-utilisation rows or
    // dilute the averages.
    const items = await prisma.inventoryItem.findMany({
      where: { status: { not: 'Deleted' } },
      select: { id: true, name: true, category: true, price: true, status: true, image: true },
    });

    const txs = await prisma.transaction.findMany({
      where: txWhere,
      select: {
        id: true,
        itemId: true,
        rentalFee: true,
        rentalDate: true,
        returnDate: true,
        dueDate: true,
        status: true,
        releasePhoto: true,
        conditionPhoto: true,
      },
    });

    const txsByItem = new Map<number, TxShape[]>();
    for (const t of txs) {
      const list = txsByItem.get(t.itemId);
      if (list) list.push(t);
      else txsByItem.set(t.itemId, [t]);
    }

    // Revenue is money actually collected (gateway 'succeeded' + counter
    // 'completed' rows) attributed to the rented item — never the booked fee.
    const paidByItem = new Map<number, number>();
    if (txs.length > 0) {
      const payments = await prisma.payment.findMany({
        where: {
          status: { in: ['succeeded', 'completed'] },
          transactionId: { in: txs.map(t => t.id) },
        },
        select: { amount: true, transactionId: true },
      });
      const txItemById = new Map(txs.map(t => [t.id, t.itemId]));
      for (const p of payments) {
        const itemId = txItemById.get(p.transactionId);
        if (itemId == null) continue;
        paidByItem.set(itemId, (paidByItem.get(itemId) || 0) + p.amount);
      }
    }

    // Days Idle stays a current-state column even in a period view (an item
    // with no returns *in July* isn't "— idle" — it may have been idle since
    // June), so when a window is active fetch the global latest return per
    // item once and reuse it for every row.
    let globalLastReturnByItem: Map<number, Date> | null = null;
    if (startDate || endDate) {
      const allReturns = await prisma.transaction.findMany({
        where: { status: { in: ['Active', 'Returned', 'Overdue'] }, returnDate: { not: null } },
        select: { itemId: true, returnDate: true },
      });
      globalLastReturnByItem = new Map();
      for (const r of allReturns) {
        if (!r.returnDate) continue;
        const prev = globalLastReturnByItem.get(r.itemId);
        if (!prev || r.returnDate > prev) globalLastReturnByItem.set(r.itemId, r.returnDate);
      }
    }

    const now = new Date();
    // Period-aware utilization: rented days from rentals *started* in the
    // window, over the window length (Jul 2026 → /31 days). Overall keeps the
    // lifetime denominator so the all-time view is unchanged. An in-progress
    // window (this year, this month) measures against ELAPSED days only —
    // dividing October's 5 days of rentals by the full 31 would understate
    // the current pace every time. Past complete windows are exact.
    const effectiveEnd = endDate && endDate.getTime() < now.getTime() ? endDate : now;
    const periodDays = startDate
      ? Math.max(1, Math.ceil((effectiveEnd.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)))
      : null;
    const analytics = items.map(item => {
      const tx = txsByItem.get(item.id) || [];
      const totalRentals = tx.length;
      const revenueGenerated = paidByItem.get(item.id) || 0;
      const avgRevenuePerRental = totalRentals > 0 ? revenueGenerated / totalRentals : 0;

      const totalRentedDays = tx.reduce((days, t) => {
        const end = t.returnDate || t.dueDate;
        return days + Math.ceil((end.getTime() - t.rentalDate.getTime()) / (1000 * 60 * 60 * 24));
      }, 0);

      let utilizationPct: number;
      if (periodDays) {
        utilizationPct = Math.min(100, Math.round((totalRentedDays / periodDays) * 100));
      } else {
        const earliestTx = tx.length > 0 ? tx.reduce((a, b) => a.rentalDate < b.rentalDate ? a : b) : null;
        const daysSinceFirstRental = earliestTx
          ? Math.max(1, Math.ceil((now.getTime() - earliestTx.rentalDate.getTime()) / (1000 * 60 * 60 * 24)))
          : 1;
        utilizationPct = Math.min(100, Math.round((totalRentedDays / daysSinceFirstRental) * 100));
      }

      let daysIdle: number | null;
      if (globalLastReturnByItem) {
        const lastGlobal = globalLastReturnByItem.get(item.id);
        daysIdle = lastGlobal
          ? Math.ceil((now.getTime() - lastGlobal.getTime()) / (1000 * 60 * 60 * 24))
          : null;
      } else {
        const lastReturn = tx.filter(t => t.returnDate).sort((a, b) => new Date(b.returnDate!).getTime() - new Date(a.returnDate!).getTime())[0];
        daysIdle = lastReturn
          ? Math.ceil((now.getTime() - lastReturn.returnDate!.getTime()) / (1000 * 60 * 60 * 24))
          : null;
      }

      // Transaction footprint for the Item Performance tx-status filter —
      // scoped to the active window (like rentals/revenue above) so the
      // Transact. dropdown matches the period being viewed.
      const txStatuses = [...new Set(tx.map(t => t.status))];
      const hasReleased = tx.some(t => t.releasePhoto || t.conditionPhoto);

      return {
        id: item.id,
        name: item.name,
        category: item.category,
        price: item.price,
        status: item.status,
        totalRentals,
        revenueGenerated,
        avgRevenuePerRental,
        totalRentedDays,
        utilizationPct,
        daysIdle,
        image: item.image,
        txStatuses,
        hasReleased,
      };
    });

    const rankedByRevenue = [...analytics].sort((a, b) => b.revenueGenerated - a.revenueGenerated);
    const rankedByUtilization = [...analytics].sort((a, b) => b.utilizationPct - a.utilizationPct);
    const rankedByFrequency = [...analytics].sort((a, b) => b.totalRentals - a.totalRentals);

    // Category rollups for the "Top by" cards: the cards rank LINES (Gown,
    // Barong…), not individual pieces. Logbook history rides along as a count
    // companion (same window) — revenue/utilisation stay ledger-pure since a
    // logbook row has no item link.
    const catAgg = new Map<string, { revenue: number; utilSum: number; rentals: number; units: number }>();
    for (const a of analytics) {
      const e = catAgg.get(a.category) || { revenue: 0, utilSum: 0, rentals: 0, units: 0 };
      e.revenue += a.revenueGenerated;
      e.utilSum += a.utilizationPct;
      e.rentals += a.totalRentals;
      e.units += 1;
      catAgg.set(a.category, e);
    }
    let historyByCat: Record<string, number> = {};
    try {
      const histWhere: any = {};
      if (startDate || endDate) {
        histWhere.eventDate = {};
        if (startDate) histWhere.eventDate.gte = startDate;
        if (endDate) histWhere.eventDate.lt = endDate;
      }
      const groups = await prisma.historicalRecord.groupBy({
        by: ['category'], where: histWhere, _count: { id: true },
      });
      for (const g of groups) historyByCat[g.category] = g._count.id;
    } catch { /* enrichment only */ }
    const topCategories = [...catAgg.entries()].map(([category, e]) => ({
      category,
      revenue: e.revenue,
      utilization: e.units > 0 ? Math.round(e.utilSum / e.units) : 0,
      rentals: e.rentals,
      units: e.units,
      historyRentals: historyByCat[category] || 0,
    }));

    // Logbook companions for the Total Rentals card (same window, separate
    // figures — per-item attribution is impossible without an item link, so
    // only the window totals ride along; revenue stays ledger-pure).
    let logbookRevenue = 0;
    let logbookRentals = 0;
    try {
      const histWhere: any = {};
      if (startDate || endDate) {
        histWhere.eventDate = {};
        if (startDate) histWhere.eventDate.gte = startDate;
        if (endDate) histWhere.eventDate.lt = endDate;
      }
      const agg = await prisma.historicalRecord.aggregate({
        where: histWhere,
        _sum: { price: true },
        _count: { id: true },
      });
      logbookRevenue = agg._sum.price ?? 0;
      logbookRentals = agg._count.id;
    } catch { /* enrichment only */ }

    return {
      items: analytics,
      summary: {
        totalItems: items.length,
        totalRevenue: analytics.reduce((s, i) => s + i.revenueGenerated, 0),
        totalRentals: analytics.reduce((s, i) => s + i.totalRentals, 0),
        avgUtilization: analytics.length > 0 ? Math.round(analytics.reduce((s, i) => s + i.utilizationPct, 0) / analytics.length) : 0,
        logbookRevenue,
        logbookRentals,
      },
      topByRevenue: rankedByRevenue.slice(0, 5),
      topByUtilization: rankedByUtilization.slice(0, 5),
      topByFrequency: rankedByFrequency.slice(0, 5),
      // Category-ranked variants of the above (Top cards rank lines, not pieces).
      topCategories: {
        byRevenue: [...topCategories].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
        byUtilization: [...topCategories].sort((a, b) => b.utilization - a.utilization).slice(0, 5),
        byFrequency: [...topCategories].sort((a, b) => b.rentals - a.rentals).slice(0, 5),
      },
    };
  });
}