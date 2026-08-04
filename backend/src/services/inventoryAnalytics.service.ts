import { prisma } from '../config/database.js';
import { cacheOrCompute } from '../utils/ttlCache.js';

type TxShape = {
  itemId: number;
  rentalFee: number;
  rentalDate: Date;
  returnDate: Date | null;
  dueDate: Date;
};

export async function getInventoryAnalytics(startDate?: Date) {
  const key = startDate ? `inventory-analytics:${startDate.toISOString()}` : 'inventory-analytics:all';
  return cacheOrCompute(key, async () => {
    const txWhere: any = { status: { in: ['Active', 'Returned', 'Overdue'] } };
    if (startDate) txWhere.rentalDate = { gte: startDate };

    // Light item select + one transaction query, grouped in JS — the old
    // `include: { transactions }` loaded every item's full history into memory.
    const items = await prisma.inventoryItem.findMany({
      select: { id: true, name: true, category: true, price: true, status: true, image: true },
    });

    const txs = await prisma.transaction.findMany({
      where: txWhere,
      select: {
        itemId: true,
        rentalFee: true,
        rentalDate: true,
        returnDate: true,
        dueDate: true,
      },
    });

    const txsByItem = new Map<number, TxShape[]>();
    for (const t of txs) {
      const list = txsByItem.get(t.itemId);
      if (list) list.push(t);
      else txsByItem.set(t.itemId, [t]);
    }

    const now = new Date();
    const analytics = items.map(item => {
      const tx = txsByItem.get(item.id) || [];
      const totalRentals = tx.length;
      const revenueGenerated = tx.reduce((sum, t) => sum + t.rentalFee, 0);
      const avgRevenuePerRental = totalRentals > 0 ? revenueGenerated / totalRentals : 0;

      const totalRentedDays = tx.reduce((days, t) => {
        const end = t.returnDate || t.dueDate;
        return days + Math.ceil((end.getTime() - t.rentalDate.getTime()) / (1000 * 60 * 60 * 24));
      }, 0);

      const earliestTx = tx.length > 0 ? tx.reduce((a, b) => a.rentalDate < b.rentalDate ? a : b) : null;
      const daysSinceFirstRental = earliestTx
        ? Math.max(1, Math.ceil((now.getTime() - earliestTx.rentalDate.getTime()) / (1000 * 60 * 60 * 24)))
        : 1;

      const utilizationPct = Math.min(100, Math.round((totalRentedDays / daysSinceFirstRental) * 100));

      const lastReturn = tx.filter(t => t.returnDate).sort((a, b) => new Date(b.returnDate!).getTime() - new Date(a.returnDate!).getTime())[0];
      const daysIdle = lastReturn
        ? Math.ceil((now.getTime() - lastReturn.returnDate!.getTime()) / (1000 * 60 * 60 * 24))
        : null;

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
      };
    });

    const rankedByRevenue = [...analytics].sort((a, b) => b.revenueGenerated - a.revenueGenerated);
    const rankedByUtilization = [...analytics].sort((a, b) => b.utilizationPct - a.utilizationPct);
    const rankedByFrequency = [...analytics].sort((a, b) => b.totalRentals - a.totalRentals);

    return {
      items: analytics,
      summary: {
        totalItems: items.length,
        totalRevenue: analytics.reduce((s, i) => s + i.revenueGenerated, 0),
        totalRentals: analytics.reduce((s, i) => s + i.totalRentals, 0),
        avgUtilization: analytics.length > 0 ? Math.round(analytics.reduce((s, i) => s + i.utilizationPct, 0) / analytics.length) : 0,
      },
      topByRevenue: rankedByRevenue.slice(0, 5),
      topByUtilization: rankedByUtilization.slice(0, 5),
      topByFrequency: rankedByFrequency.slice(0, 5),
    };
  });
}