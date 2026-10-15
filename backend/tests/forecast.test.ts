import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { smaCapped, mape } from '../src/utils/sma.js';
import { buildForecastSeries } from '../src/services/dashboard.service.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

describe('smaCapped', () => {
  it('caps an IQR outlier but keeps the true count for bars', async () => {
    const data = [5, 5, 5, 5, 5, 5, 6, 20];
    const { values, flags } = smaCapped(data, 3);
    expect(values).toHaveLength(data.length);
    // The spike is averaged down, never deleted from the input series.
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ index: 7 });
    expect(flags[0].reason).toMatch(/bulk booking/);
    expect(flags[0].reason).not.toMatch(/IQR|winsor|sigma/i);
  });

  it('emits no flags when nothing exceeds the cap', async () => {
    const { values, flags } = smaCapped([6, 9, 7, 8, 10, 9, 12, 11], 3);
    expect(flags).toEqual([]);
    expect(values.filter((v) => v !== null)).toHaveLength(6);
  });

  it('returns empty shapes for empty input instead of crashing', async () => {
    expect(smaCapped([], 3)).toEqual({ values: [], flags: [] });
  });
});

describe('mape', () => {
  it('skips zero-actual periods (no division by zero)', async () => {
    // |100−90|/100 and |200−220|/200 → (10% + 10%) / 2 = 10%.
    expect(mape([100, 0, 200], [90, 50, 220])).toBe(10);
  });

  it('returns null when nothing is comparable', async () => {
    expect(mape([0, 0], [5, 5])).toBeNull();
    expect(mape([], [])).toBeNull();
  });
});

describe('buildForecastSeries', () => {
  it('floors the expected-range band at zero (counts can never be negative)', async () => {
    // Wildly volatile history → error over 100% → raw lower bound negative.
    const counts = [2, 30, 1, 28, 2, 27, 1, 28];
    const s = buildForecastSeries(counts, 3);
    expect(s.errorPct).toBeGreaterThan(100);
    for (const v of s.band.lo) {
      if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('GET /api/dashboard/forecast granularity=weekly', () => {
  it('adapts the period down on thin history and marks it provisional', async () => {
    const { prisma } = await import('../src/config/database.js');
    const now = new Date();
    const d1 = new Date(now); d1.setDate(d1.getDate() - 3);
    const d2 = new Date(now); d2.setDate(d2.getDate() - 10);
    // Two non-zero weeks out of twelve → period adapts 3 → 2, provisional.
    prisma.transaction.findMany.mockResolvedValueOnce([
      { createdAt: d1, itemId: 1 },
      { createdAt: d2, itemId: 1 },
    ]);

    const res = await request(app)
      .get('/api/dashboard/forecast?granularity=weekly')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.period).toBe(2);
    expect(res.body.provisional).toBe(true);
    expect(res.body.counts).toHaveLength(12);
    expect(res.body).toHaveProperty('errorPct');
    expect(res.body).toHaveProperty('band');
    expect(res.body.band).toHaveProperty('lo');
    expect(res.body.band).toHaveProperty('hi');
  });

  it('produces a null layout without crashing on empty history', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([]);

    // period=5 keeps a distinct forecast cache key from the test above.
    const res = await request(app)
      .get('/api/dashboard/forecast?granularity=weekly&period=5')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.counts.every((c: number) => c === 0)).toBe(true);
    expect(res.body.provisional).toBe(true);
    expect(res.body.errorPct).toBeNull();
  });
});

describe('forecast includes imported logbook history', () => {
  it('monthly counts + byCategory union transactions and HistoricalRecords', async () => {
    const { prisma } = await import('../src/config/database.js');
    const txDate = new Date(); txDate.setDate(txDate.getDate() - 5);
    const histDate = new Date(); histDate.setDate(histDate.getDate() - 10);
    prisma.transaction.findMany.mockResolvedValueOnce([{ createdAt: txDate, itemId: 1 }]);
    prisma.inventoryItem.findMany.mockResolvedValueOnce([{ id: 1, category: 'Suit' }]);
    prisma.historicalRecord.findMany.mockResolvedValueOnce([{ eventDate: histDate, category: 'Gown' }]);

    const res = await request(app)
      .get('/api/dashboard/forecast')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    // Both demand points land somewhere in the windowed series.
    expect(res.body.counts.reduce((a: number, b: number) => a + b, 0)).toBe(2);
    // …and the response says how much of it came from the logbook.
    expect(res.body.historyPoints).toBe(1);
    const cats = (res.body.byCategory ?? []).map((c: { category: string }) => c.category);
    expect(cats).toContain('Gown');
    expect(cats).toContain('Suit');
  });
});
