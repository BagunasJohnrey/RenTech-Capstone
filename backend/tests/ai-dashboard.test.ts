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
    prisma.transaction.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(15)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(18)
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(22);

    const res = await request(app)
      .get('/api/dashboard/forecast')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('labels');
    expect(res.body).toHaveProperty('counts');
    expect(res.body).toHaveProperty('sma');
    expect(res.body.counts).toEqual([10, 15, 12, 18, 20, 22]);
    expect(res.body.labels).toHaveLength(6);
    expect(res.body.sma).toHaveLength(6);
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
    const now = new Date();
    prisma.inventoryItem.findMany.mockResolvedValueOnce([
      { id: 1, name: 'Gown A', category: 'Gown', price: 3000, status: 'Available', image: null, description: null, size: null, createdAt: now, updatedAt: now, transactions: [{ id: 'tx1' }, { id: 'tx2' }] },
      { id: 2, name: 'Suit B', category: 'Suit', price: 4000, status: 'Available', image: null, description: null, size: null, createdAt: now, updatedAt: now, transactions: [{ id: 'tx3' }] },
      { id: 3, name: 'Barong C', category: 'Barong', price: 3500, status: 'Available', image: null, description: null, size: null, createdAt: now, updatedAt: now, transactions: [] },
    ]);

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
    expect(res.body.topRented).toHaveLength(3);
    expect(res.body.underperforming).toHaveLength(1);
    expect(res.body.underperforming[0].name).toBe('Barong C');
  });

  it('should reject for staff', async () => {
    const res = await request(app)
      .get('/api/dashboard/insights')
      .set('Authorization', 'Bearer staff-token');

    expect(res.status).toBe(403);
  });
});

describe('POST /api/ai/generate-report', () => {
  beforeAll(() => {
    global.fetch = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: 'Executive Summary: The boutique is performing well.' }] } }],
      }),
    });
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
