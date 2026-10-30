import { describe, it, expect } from 'vitest';
import {
  reorderSuggestions,
  liveStockByCategory,
  clearanceSuggestions,
  cleaningPriority,
} from '../src/services/optimization.service.js';

describe('reorderSuggestions', () => {
  it('flags a category whose projection outruns free units at high utilization', () => {
    const out = reorderSuggestions(
      [{ category: 'Gown', projection: 12, trend: 'up' }],
      { Gown: { total: 10, rented: 9 } }
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: 'Gown', freeUnits: 1, shortfall: 11 });
  });

  it('stays quiet when stock covers demand', () => {
    expect(
      reorderSuggestions(
        [{ category: 'Suit', projection: 2, trend: 'flat' }],
        { Suit: { total: 10, rented: 2 } }
      )
    ).toEqual([]);
  });

  it('uses live stock (not rented-in-window) for free units when items are given', () => {
    // Window breakdown says 13/19 rented (68%) and trend is down → no flag.
    // Live stock: 17 of 19 gowns are out right now → 2 free vs 17 projected.
    const items = Array.from({ length: 19 }, (_, i) => ({
      id: i + 1, name: `G${i}`, category: 'Gown',
      status: i < 15 ? 'Rented' : i < 17 ? 'Reserved' : 'Available',
      totalRentals: 1, daysIdle: 0,
    }));
    const out = reorderSuggestions(
      [{ category: 'Gown', projection: 17, trend: 'down' }],
      { Gown: { total: 19, rented: 13 } },
      items
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: 'Gown', freeUnits: 2, shortfall: 15, util: 89 });
    expect(liveStockByCategory(items).Gown).toEqual({ total: 19, out: 17 });
  });

  it('skips categories without a projection', () => {
    expect(
      reorderSuggestions(
        [{ category: 'Gown', projection: null, trend: 'flat' }],
        { Gown: { total: 1, rented: 1 } }
      )
    ).toEqual([]);
  });
});

describe('clearanceSuggestions', () => {
  const items = [
    { id: 1, name: 'Old Gown', category: 'Gown', status: 'Available', totalRentals: 3, daysIdle: 74 },
    { id: 2, name: 'New Suit', category: 'Suit', status: 'Available', totalRentals: 5, daysIdle: 4 },
    { id: 3, name: 'Never Worn', category: 'Barong', status: 'Available', totalRentals: 0, daysIdle: null },
    { id: 4, name: 'Broken', category: 'Gown', status: 'OutOfService', totalRentals: 0, daysIdle: null },
  ];

  it('flags idle and never-rented items, skipping out-of-service', () => {
    const out = clearanceSuggestions(items);
    expect(out.map((i) => i.id)).toEqual([3, 1]); // never-rented first, then idlest
    expect(out[0].reason).toBe('never rented');
    expect(out[1].reason).toBe('idle 74d');
  });
});

describe('cleaningPriority', () => {
  it('orders cleaning items by projected category demand', () => {
    const items = [
      { id: 1, name: 'Suit A', category: 'Suit', status: 'Cleaning', totalRentals: 1, daysIdle: 2 },
      { id: 2, name: 'Gown B', category: 'Gown', status: 'Cleaning', totalRentals: 1, daysIdle: 2 },
      { id: 3, name: 'Gown C', category: 'Gown', status: 'Available', totalRentals: 1, daysIdle: 2 },
    ];
    const out = cleaningPriority(items, [
      { category: 'Gown', projection: 12, trend: 'up' },
      { category: 'Suit', projection: 2, trend: 'flat' },
    ]);
    expect(out.map((i) => i.id)).toEqual([2, 1]);
  });
});
