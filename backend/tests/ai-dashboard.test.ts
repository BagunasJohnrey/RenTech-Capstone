import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { sma } from '../src/utils/sma.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

describe('SMA utility', () => {
  it('should return nulls for incomplete windows', () => {
    const result = sma([10, 20, 30], 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBe(20);
  });

  it('should compute SMA correctly', () => {
    const result = sma([10, 20, 30, 40], 3);
    expect(result).toEqual([null, null, 20, 30]);
  });

  it('should handle period of 1', () => {
    const result = sma([10, 20, 30], 1);
    expect(result).toEqual([10, 20, 30]);
  });

  it('should round to 2 decimals', () => {
    const result = sma([10, 11, 12], 3);
    expect(result[2]).toBe(11);
  });
});

describe('GET /api/dashboard/forecast', () => {
  it('should return forecast data for admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    // getDataMonths spans from 3 months ago through the current month = 4 months.
    // The service fetches createdAt rows ONCE and buckets them by month in JS,
    // so mock a flat list of 10+15+12+18 rows spread over those 4 months.
    const monthsAgo = (n: number) => {
      const d = new Date();
      d.setMonth(d.getMonth() - n);
      d.setDate(10);
      return d;
    };
    const rows: { createdAt: Date }[] = [];
    // One of these is a Cancelled booking — demand forecasting now includes
    // cancelled transactions, so the buckets still total 10/15/12/18.
    for (let i = 0; i < 10; i++) rows.push({ createdAt: monthsAgo(3) });
    for (let i = 0; i < 15; i++) rows.push({ createdAt: monthsAgo(2) });
    for (let i = 0; i < 12; i++) rows.push({ createdAt: monthsAgo(1) });
    for (let i = 0; i < 18; i++) rows.push({ createdAt: monthsAgo(0) });
    prisma.transaction.findMany.mockResolvedValueOnce(rows);

    const res = await request(app)
      .get('/api/dashboard/forecast')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('labels');
    expect(res.body).toHaveProperty('counts');
    expect(res.body).toHaveProperty('sma');
    expect(res.body.counts).toEqual([10, 15, 12, 18]);
    expect(res.body.labels).toHaveLength(4);
    expect(res.body.sma).toHaveLength(4);

    // The query must include cancelled transactions in the demand window.
    const findManyArg = prisma.transaction.findMany.mock.calls[0][0] as any;
    expect(findManyArg.where.status.in).toContain('Cancelled');
  });

  it('should include 3 forward projections and per-category splits', async () => {
    const { prisma } = await import('../src/config/database.js');
    // period=4 → distinct cache key from the test above (no shared-cache flakiness).
    const monthsAgo = (n: number) => {
      const d = new Date();
      d.setMonth(d.getMonth() - n);
      d.setDate(10);
      return d;
    };
    const rows: { createdAt: Date; itemId: number }[] = [];
    for (let i = 0; i < 10; i++) rows.push({ createdAt: monthsAgo(3), itemId: 1 });
    for (let i = 0; i < 15; i++) rows.push({ createdAt: monthsAgo(2), itemId: 1 });
    for (let i = 0; i < 12; i++) rows.push({ createdAt: monthsAgo(1), itemId: 2 });
    for (let i = 0; i < 18; i++) rows.push({ createdAt: monthsAgo(0), itemId: 2 });
    prisma.transaction.findMany.mockResolvedValueOnce(rows);
    prisma.inventoryItem.findMany.mockResolvedValueOnce([
      { id: 1, category: 'Gown' },
      { id: 2, category: 'Suit' },
    ]);

    const res = await request(app)
      .get('/api/dashboard/forecast?period=4')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    // sma(10,15,12,18 @4) = [null,null,null,13.75] → flat projection of 13.8 (1dp).
    expect(res.body.projections).toHaveLength(3);
    expect(res.body.projections[0].value).toBe(13.8);
    expect(res.body.projections[0]).toHaveProperty('label');
    const cats = (res.body.byCategory as { category: string }[]).map((c) => c.category);
    expect(cats).toContain('Gown');
    expect(cats).toContain('Suit');
    const gown = (res.body.byCategory as any[]).find((c) => c.category === 'Gown');
    const suit = (res.body.byCategory as any[]).find((c) => c.category === 'Suit');
    expect(gown.trend).toBe('flat'); // Gown [10,15,0,0]: latest 0 vs prev 0
    expect(suit.trend).toBe('up'); // Suit [0,0,12,18]: latest 18 vs prev 12
  });

  it('should return weekly buckets with granularity=weekly', async () => {
    const { prisma } = await import('../src/config/database.js');
    const daysAgo = (n: number) => {      const d = new Date();
      d.setDate(d.getDate() - n);
      return d;
    };
    prisma.transaction.findMany.mockResolvedValueOnce([
      { createdAt: daysAgo(2), itemId: 1 },
      { createdAt: daysAgo(9), itemId: 1 },
    ]);

    const res = await request(app)
      .get('/api/dashboard/forecast?granularity=weekly')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.granularity).toBe('weekly');
    expect(res.body.labels).toHaveLength(12);
    expect(res.body.counts).toHaveLength(12);
    expect(res.body.projections).toHaveLength(3);
  });

  it('should reject for staff', async () => {
    const res = await request(app)
      .get('/api/dashboard/forecast')
      .set('Authorization', 'Bearer staff-token');

    expect(res.status).toBe(403);
  });

  it('should reject when unauthenticated', async () => {
    const res = await request(app).get('/api/dashboard/forecast');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/dashboard/insights', () => {
  it('should return insights data for admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    // Items are now fetched without their transaction history (light select) —
    // rental counts / revenue come from a single transaction query.
    prisma.inventoryItem.findMany.mockResolvedValueOnce([
      { id: 1, name: 'Gown A', category: 'Gown' },
      { id: 2, name: 'Suit B', category: 'Suit' },
      { id: 3, name: 'Barong C', category: 'Barong' },
    ]);
    prisma.transaction.findMany.mockResolvedValueOnce([
      { itemId: 1, rentalFee: 3000, createdAt: new Date(), item: { category: 'Gown' } },
      { itemId: 1, rentalFee: 3000, createdAt: new Date(), item: { category: 'Gown' } },
      { itemId: 2, rentalFee: 4000, createdAt: new Date(), item: { category: 'Suit' } },
    ]);
    prisma.payment.findMany.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/dashboard/insights')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('categoryBreakdown');
    expect(res.body).toHaveProperty('topRented');
    expect(res.body).toHaveProperty('underperforming');
    expect(res.body).toHaveProperty('revenueByMonth');
    expect(res.body.totalItems).toBe(3);
    expect(res.body.totalRented).toBe(2);
    expect(res.body.topRented).toHaveLength(2);
    expect(res.body.topRented[0]).toMatchObject({ name: 'Gown A', rentals: 2 });
    expect(res.body.underperforming).toHaveLength(1);
    expect(res.body.underperforming[0].name).toBe('Barong C');
  });

  it('buckets this month\'s revenue into weekly chunks on period=monthly', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findMany.mockResolvedValueOnce([{ id: 1, name: 'Gown A', category: 'Gown' }]);

    const now = new Date();
    const inThisMonth = (day: number) => new Date(now.getFullYear(), now.getMonth(), Math.min(day, 28));
    prisma.transaction.findMany.mockResolvedValueOnce([
      // Wk 1 (day 3), Wk 2 (day 10), Wk 3 (day 17)
      { itemId: 1, rentalFee: 1000, createdAt: inThisMonth(3), item: { category: 'Gown' } },
      { itemId: 1, rentalFee: 2000, createdAt: inThisMonth(10), item: { category: 'Gown' } },
      { itemId: 1, rentalFee: 4000, createdAt: inThisMonth(17), item: { category: 'Gown' } },
      // Previous-month transaction must NOT leak into this month's weekly view.
      { itemId: 1, rentalFee: 9000, createdAt: new Date(now.getFullYear(), now.getMonth() - 1, 15), item: { category: 'Gown' } },
    ]);
    prisma.payment.findMany.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/dashboard/insights?period=monthly')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.revenueByWeek).toEqual([
      { label: 'Wk 1', revenue: 1000 },
      { label: 'Wk 2', revenue: 2000 },
      { label: 'Wk 3', revenue: 4000 },
      { label: 'Wk 4', revenue: 0 },
      { label: 'Wk 5', revenue: 0 },
    ]);
  });

  it('month=6&year=2025 returns a bounded [June 1, July 1) window so later months do not leak in', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findMany.mockResolvedValueOnce([{ id: 1, name: 'Gown A', category: 'Gown' }]);

    prisma.transaction.findMany.mockResolvedValueOnce([
      { itemId: 1, rentalFee: 500, createdAt: new Date(2025, 5, 5), item: { category: 'Gown' } },   // Jun 5 2025 → Wk 1
      { itemId: 1, rentalFee: 700, createdAt: new Date(2025, 5, 20), item: { category: 'Gown' } },  // Jun 20 2025 → Wk 3
      { itemId: 1, rentalFee: 9000, createdAt: new Date(2025, 7, 2), item: { category: 'Gown' } },  // Aug 2 2025 → must NOT leak
    ]);
    prisma.payment.findMany.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/dashboard/insights?period=monthly&year=2025&month=6')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    // Weekly buckets exist for the pinned month.
    expect(res.body.revenueByWeek).toEqual([
      { label: 'Wk 1', revenue: 500 },
      { label: 'Wk 2', revenue: 0 },
      { label: 'Wk 3', revenue: 700 },
      { label: 'Wk 4', revenue: 0 },
      { label: 'Wk 5', revenue: 0 },
    ]);
    // And the transaction query was bounded: gte June 1, lt July 1.
    const findManyArg = prisma.transaction.findMany.mock.calls[0][0] as any;
    expect(findManyArg.where.createdAt.gte).toEqual(new Date(2025, 5, 1));
    expect(findManyArg.where.createdAt.lt).toEqual(new Date(2025, 6, 1));
  });

  it('year filter scopes Yearly revenue to Jan 1..Dec 31 of that year', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findMany.mockResolvedValueOnce([{ id: 1, name: 'Gown A', category: 'Gown' }]);
    prisma.transaction.findMany.mockResolvedValueOnce([]);
    prisma.payment.findMany.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/dashboard/insights?period=yearly&year=2024')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    const findManyArg = prisma.transaction.findMany.mock.calls[0][0] as any;
    expect(findManyArg.where.createdAt.gte).toEqual(new Date(2024, 0, 1));
    expect(findManyArg.where.createdAt.lt).toEqual(new Date(2025, 0, 1));
    expect(res.body).not.toHaveProperty('revenueByWeek');
  });

  it('does NOT add revenueByWeek for period=all', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findMany.mockResolvedValueOnce([{ id: 1, name: 'Gown A', category: 'Gown' }]);
    prisma.transaction.findMany.mockResolvedValueOnce([]);
    prisma.payment.findMany.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/dashboard/insights')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('revenueByWeek');
  });

  it('should reject for staff', async () => {
    const res = await request(app)
      .get('/api/dashboard/insights')
      .set('Authorization', 'Bearer staff-token');

    expect(res.status).toBe(403);
  });
});

describe('POST /api/ai/generate-report', () => {
  // A structurally complete report (all sections + numbered recommendations,
  // no ₱ amounts so the amount-guard passes regardless of fixture data).
  const FULL_REPORT = [
    'Executive Summary',
    'The boutique recorded stable rental activity with no overdue returns this period.',
    'Key Performance Indicators',
    'Active rentals are 10 with 0 overdue.',
    'Revenue Analysis',
    'No sales data available yet.',
    'Inventory & Utilization',
    'The catalog snapshot holds no items needing urgent action.',
    'Operational Health',
    'No overdue returns and no damaged items were recorded.',
    'Demand Forecast',
    'Projected rental volume is stable at current levels.',
    'Recommendations',
    '1. Run a category-themed promo week for slow-moving items to lift bookings.',
    '2. Feature the most-rented items at the storefront to capture walk-in demand.',
  ].join('\n');
  // The truncated stub seen in production (provider cut off by token limits):
  // passes the amount-guard (no ₱) but must fail structural validation.
  const TRUNCATED_STUB = "Executive Summary:\n\n\n\nThe data for Mylene's Boutique for the month of September 2021 is as follows:";

  beforeAll(async () => {
    // Route generateReport past the no-keys fallback into the Gemini path
    // (setup.ts blanks all provider keys so tests never hit live APIs).
    // Mutating the shared env object works — the service reads it per call.
    const { env } = await import('../src/config/env.js');
    env.GEMINI_API_KEY = 'test-key';
    global.fetch = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: FULL_REPORT }] } }],
      }),
    });
  });

  afterAll(async () => {
    const { env } = await import('../src/config/env.js');
    env.GEMINI_API_KEY = '';
  });

  it('should generate AI report for admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(15)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(18)
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(22);
    prisma.inventoryItem.findMany.mockResolvedValueOnce([]);
    prisma.payment.findMany.mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/api/ai/generate-report')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('report');
    expect(res.body).toHaveProperty('source');
    expect(res.body.source).toBe('ai');
    expect(res.body).toHaveProperty('reportId');
  });

  it('rejects a truncated provider stub as source=error without saving history', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(15)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(18)
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(22);
    prisma.inventoryItem.findMany.mockResolvedValueOnce([]);
    prisma.payment.findMany.mockResolvedValueOnce([]);

    // Both the first attempt and the correction retry return the stub.
    const stub = {
      ok: true,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: TRUNCATED_STUB }] } }],
      }),
    };
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(stub)
      .mockResolvedValueOnce(stub);

    const res = await request(app)
      .post('/api/ai/generate-report')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('error');
    expect(res.body.report).toMatch(/incomplete|truncated/i);
    expect(res.body).not.toHaveProperty('reportId');
  });

  it('should reject for customer', async () => {
    const res = await request(app)
      .post('/api/ai/generate-report')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(403);
  });

  it('should reject when unauthenticated', async () => {
    const res = await request(app).post('/api/ai/generate-report');
    expect(res.status).toBe(401);
  });
});
