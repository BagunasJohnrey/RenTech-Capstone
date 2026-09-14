import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

describe('GET /api/inventory', () => {
  it('should list items without auth', async () => {
    const { prisma } = await import('../src/config/database.js');
    // The service includes each item's active transactions for the effective
    // status — the fixture must mirror that shape.
    prisma.inventoryItem.findMany.mockResolvedValueOnce([
      { id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available', transactions: [], _count: { transactions: 0 } },
    ]);

    const res = await request(app).get('/api/inventory');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should filter by category', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findMany.mockResolvedValueOnce([]);

    const res = await request(app).get('/api/inventory?category=Gown');
    expect(res.status).toBe(200);
  });

  it('should filter by status when authenticated', async () => {
    const res = await request(app)
      .get('/api/inventory?status=Rented')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
  });

  it('should search by name', async () => {
    const res = await request(app).get('/api/inventory?search=Gown');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/inventory/:id', () => {
  it('should return item by id', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available', transactions: [],
    });

    const res = await request(app).get('/api/inventory/1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'Test Gown');
  });

  it('should return 404 if item not found', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce(null);

    const res = await request(app).get('/api/inventory/999');
    expect(res.status).toBe(404);
  });

  it('should 400 on a non-numeric id', async () => {
    const res = await request(app).get('/api/inventory/abc');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/inventory', () => {
  it('should create item when admin', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', 'Bearer admin-token')
      .send({ name: 'New Gown', category: 'Gown', price: 3000 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('name', 'New Gown');
  });

  it('should create item when staff', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', 'Bearer staff-token')
      .send({ name: 'Staff Created', category: 'Suit', price: 2500 });

    expect(res.status).toBe(201);
  });

  it('should reject when customer', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', 'Bearer customer-token')
      .send({ name: 'Test', category: 'Gown', price: 1000 });

    expect(res.status).toBe(403);
  });

  it('should reject when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .send({ name: 'Test', category: 'Gown', price: 1000 });

    expect(res.status).toBe(401);
  });

  it('should reject missing required fields', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', 'Bearer admin-token')
      .send({ name: 'Test' });

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/inventory/:id', () => {
  it('should update item when admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Old Name', category: 'Gown', price: 5000, status: 'Available',
    });

    const res = await request(app)
      .put('/api/inventory/1')
      .set('Authorization', 'Bearer admin-token')
      .send({ name: 'Updated Name', price: 6000 });

    expect(res.status).toBe(200);
  });

  it('should return 404 for non-existent item', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .put('/api/inventory/999')
      .set('Authorization', 'Bearer admin-token')
      .send({ name: 'Test' });

    expect(res.status).toBe(404);
  });

  it('should reject when customer', async () => {
    const res = await request(app)
      .put('/api/inventory/1')
      .set('Authorization', 'Bearer customer-token')
      .send({ name: 'Test' });

    expect(res.status).toBe(403);
  });

  it('should 400 on a garbage saleEndsAt', async () => {
    const res = await request(app)
      .put('/api/inventory/1')
      .set('Authorization', 'Bearer admin-token')
      .send({ saleEndsAt: 'garbage' });

    expect(res.status).toBe(400);
  });

  it('should 400 on an empty update body', async () => {
    const res = await request(app)
      .put('/api/inventory/1')
      .set('Authorization', 'Bearer admin-token')
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/inventory/:id', () => {
  it('should delete item when admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'Available',
    });

    const res = await request(app)
      .delete('/api/inventory/1')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
  });

  it('should reject delete when item has transaction history (archive instead)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'Available',
      image: 'path/to/image.jpg',
    });
    prisma.transaction.findFirst.mockResolvedValueOnce({ id: 10 });

    const res = await request(app)
      .delete('/api/inventory/1')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rental history/i);
    expect(prisma.inventoryItem.delete).not.toHaveBeenCalled();
  });

  it('should delete item without history and clean up image', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'Available',
      image: 'path/to/image.jpg',
    });
    prisma.transaction.findFirst.mockResolvedValueOnce(null);
    prisma.inventoryItem.delete.mockResolvedValueOnce({ id: 1 });

    const res = await request(app)
      .delete('/api/inventory/1')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(prisma.inventoryItem.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('should reject when staff (not admin)', async () => {
    const res = await request(app)
      .delete('/api/inventory/1')
      .set('Authorization', 'Bearer staff-token');

    expect(res.status).toBe(403);
  });

  it('should reject when item is rented', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'Rented',
    });

    const res = await request(app)
      .delete('/api/inventory/1')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(400);
  });

  it('should return 404 for non-existent item', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .delete('/api/inventory/999')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/inventory/availability', () => {
  it('should return available for free item', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/inventory/availability?itemId=1&rentalDate=2026-07-15&dueDate=2026-07-18');

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
  });

  it('should return unavailable for damaged item', async () => {
    const { prisma } = await import('../src/config/database.js');
    // 'Damaged' + 'Maintenance' were merged into 'OutOfService' in the
    // unified lifecycle — the availability check must honor the new status.
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'OutOfService',
    });

    const res = await request(app)
      .get('/api/inventory/availability?itemId=1&rentalDate=2026-07-15&dueDate=2026-07-18');

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
  });

  it('should return unavailable with overlapping transaction', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValueOnce({ id: 'tx-1' });

    const res = await request(app)
      .get('/api/inventory/availability?itemId=1&rentalDate=2026-07-15&dueDate=2026-07-18');

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
  });

  it('should return 404 for non-existent item', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/inventory/availability?itemId=999&rentalDate=2026-07-15&dueDate=2026-07-18');

    expect(res.status).toBe(404);
  });

  it('should 400 on a non-numeric itemId', async () => {
    const res = await request(app)
      .get('/api/inventory/availability?itemId=abc&rentalDate=2026-07-15&dueDate=2026-07-18');

    expect(res.status).toBe(400);
  });

  it('should 400 on an invalid date', async () => {
    const res = await request(app)
      .get('/api/inventory/availability?itemId=1&rentalDate=garbage&dueDate=2026-07-18');

    expect(res.status).toBe(400);
  });
});

describe('API 404 fallback', () => {
  it('returns JSON 404 for unknown api routes', async () => {
    const express2 = (await import('express')).default;
    const { errorHandler } = await import('../src/middleware/errorHandler.js');
    const routes2 = (await import('../src/routes/index.js')).default;
    const app2 = express2();
    app2.use(express2.json());
    app2.use('/api', routes2);
    app2.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
    app2.use(errorHandler);
    const res = await request(app2).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('P2002 → 409', () => {
  it('maps a unique-constraint violation to 409', async () => {
    const express2 = (await import('express')).default;
    const { errorHandler } = await import('../src/middleware/errorHandler.js');
    const app2 = express2();
    app2.use(express2.json());
    app2.get('/api/dup', () => { const e = new Error('Unique constraint'); (e as any).code = 'P2002'; throw e; });
    app2.use(errorHandler);
    const res = await request(app2).get('/api/dup');
    expect(res.status).toBe(409);
  });
});
