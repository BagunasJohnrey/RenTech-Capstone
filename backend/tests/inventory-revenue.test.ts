import { describe, it, expect } from 'vitest';
import { getInventoryAnalytics } from '../src/services/inventoryAnalytics.service.js';

// Revenue per item is money actually collected (gateway 'succeeded' + counter
// 'completed' rows) — never the booked rental fee. An item rented but unpaid
// contributes 0, however large its fee.
describe('getInventoryAnalytics revenue', () => {
  it('attributes collected payments to the rented item and ignores unpaid fees', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findMany.mockResolvedValueOnce([
      { id: 1, name: 'Gown A', category: 'Gown', price: 5000, status: 'Available', image: null },
      { id: 2, name: 'Suit B', category: 'Suit', price: 5000, status: 'Available', image: null },
    ]);
    const txRow = (id: string, itemId: number) => ({
      id, itemId, rentalFee: 5000,
      rentalDate: new Date('2026-01-05'), returnDate: new Date('2026-01-08'), dueDate: new Date('2026-01-07'),
      status: 'Returned', releasePhoto: null, conditionPhoto: null,
    });
    // Main window query, then the global-returns query for Days Idle.
    prisma.transaction.findMany
      .mockResolvedValueOnce([txRow('tx-1', 1), txRow('tx-2', 2)])
      .mockResolvedValueOnce([]);
    // Item 1 fully collected across both ledger paths; item 2 unpaid.
    prisma.payment.findMany.mockResolvedValueOnce([
      { amount: 3000, transactionId: 'tx-1' },
      { amount: 2000, transactionId: 'tx-1' },
    ]);

    const res = await getInventoryAnalytics(new Date('2026-01-01'), new Date('2026-02-01'));

    const byId = new Map(res.items.map((i: { id: number }) => [i.id, i]));
    expect(byId.get(1)).toMatchObject({ revenueGenerated: 5000 });
    expect(byId.get(2)).toMatchObject({ revenueGenerated: 0 });
    expect(res.summary.totalRevenue).toBe(5000);
  });

  it('counts a counter-cash payment with no window filter', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findMany.mockResolvedValueOnce([
      { id: 7, name: 'Barong C', category: 'Barong', price: 4000, status: 'Available', image: null },
    ]);
    prisma.transaction.findMany.mockResolvedValueOnce([{
      id: 'tx-7', itemId: 7, rentalFee: 4000,
      rentalDate: new Date('2026-03-05'), returnDate: null, dueDate: new Date('2026-03-08'),
      status: 'Active', releasePhoto: null, conditionPhoto: null,
    }]);
    prisma.payment.findMany.mockResolvedValueOnce([
      { amount: 4000, transactionId: 'tx-7' },
    ]);

    const res = await getInventoryAnalytics();

    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ revenueGenerated: 4000 });
  });
});
