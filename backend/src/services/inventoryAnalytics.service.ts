import { prisma } from '../config/database.js';

export async function getInventoryAnalytics(startDate?: Date) {
  const txWhere: any = { status: { in: ['Active', 'Returned', 'Overdue'] } };
  if (startDate) txWhere.rentalDate = { gte: startDate };

  const items = await prisma.inventoryItem.findMany({
    include: {
      transactions: { where: txWhere },
    },
  });

  const now = new Date();
  const analytics = items.map(item => {
    const tx = item.transactions;
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
}
