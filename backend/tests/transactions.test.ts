import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

describe('POST /api/transactions', () => {
  it('should create rental when admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 1, rentalDate: '2026-07-20', dueDate: '2026-07-23', rentalFee: 5000, downpayment: 1000 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  it('should create rental when customer (own)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 2, name: 'Test Suit', category: 'Suit', price: 3000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer customer-token')
      .send({ itemId: 2, rentalDate: '2026-08-01', dueDate: '2026-08-04', rentalFee: 3000 });

    expect(res.status).toBe(201);
  });

  it('should reject when item not found', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 999, rentalDate: '2026-07-20', dueDate: '2026-07-23', rentalFee: 5000 });

    expect(res.status).toBe(404);
  });

  it('should reject when item is not available', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'Rented',
    });

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 1, rentalDate: '2026-07-20', dueDate: '2026-07-23', rentalFee: 5000 });

    expect(res.status).toBe(400);
  });

  it('should reject when dates overlap', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValueOnce({ id: 'overlapping-tx' });

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 1, rentalDate: '2026-07-20', dueDate: '2026-07-23', rentalFee: 5000 });

    expect(res.status).toBe(409);
  });

  it('should reject unauthenticated', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({ itemId: 1, rentalDate: '2026-07-20', dueDate: '2026-07-23', rentalFee: 5000 });

    expect(res.status).toBe(401);
  });

  it('should ignore customerId for customer (uses own id)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer customer-token')
      .send({ customerId: 'some-other-id', itemId: 1, rentalDate: '2026-07-20', dueDate: '2026-07-23', rentalFee: 5000 });

    expect(res.status).toBe(201);
  });
});

describe('GET /api/transactions', () => {
  it('should list transactions for admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([]);
    prisma.transaction.count.mockResolvedValueOnce(0);

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('transactions');
    expect(res.body).toHaveProperty('total');
  });

  it('should list own transactions for customer', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([]);
    prisma.transaction.count.mockResolvedValueOnce(0);

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(200);
  });

  it('should reject unauthenticated', async () => {
    const res = await request(app).get('/api/transactions');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/transactions/:id', () => {
  it('should return transaction by id', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', customerId: 'admin-id-789', itemId: 1, rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 4000, status: 'Active',
      customer: { id: 'admin-id-789', name: 'Admin', email: 'admin@example.com' },
      item: { id: 1, name: 'Test Gown', category: 'Gown' },
      payments: [],
    });

    const res = await request(app)
      .get('/api/transactions/tx-1')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'tx-1');
  });

  it('should return 404 for non-existent transaction', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/transactions/tx-404')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/transactions/:id/return', () => {
  it('should process return', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date('2026-07-10'), dueDate: new Date('2026-07-13'),
      rentalFee: 5000, downpayment: 1000, balance: 4000,
      latePenalty: 0, damageFee: 0, status: 'Active',
      item: { id: 1, name: 'Test', status: 'Rented' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-1/return')
      .set('Authorization', 'Bearer admin-token')
      .send({ returnDate: '2026-07-14', isDamaged: false });

    expect(res.status).toBe(200);
    expect(res.body.fees).toBeDefined();
  });

  it('should charge late penalty', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-2', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date('2026-07-01'), dueDate: new Date('2026-07-04'),
      rentalFee: 5000, downpayment: 1000, balance: 4000,
      latePenalty: 0, damageFee: 0, status: 'Active',
      item: { id: 1, name: 'Test', status: 'Rented' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-2/return')
      .set('Authorization', 'Bearer admin-token')
      .send({ returnDate: '2026-07-10', isDamaged: false });

    expect(res.status).toBe(200);
    expect(res.body.fees.latePenalty).toBeGreaterThan(0);
  });

  it('should reject if already returned', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-3', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 0, status: 'Returned',
      item: { id: 1, name: 'Test', status: 'Cleaning' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-3/return')
      .set('Authorization', 'Bearer admin-token')
      .send({ returnDate: '2026-07-14', isDamaged: false });

    expect(res.status).toBe(400);
  });

  it('should reject for customer', async () => {
    const res = await request(app)
      .put('/api/transactions/tx-1/return')
      .set('Authorization', 'Bearer customer-token')
      .send({ returnDate: '2026-07-14', isDamaged: false });

    expect(res.status).toBe(403);
  });
});

describe('PUT /api/transactions/:id/cancel', () => {
  it('should cancel transaction when admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 4000, status: 'Active',
      item: { id: 1, name: 'Test', status: 'Rented' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-1/cancel')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
  });

  it('should reject when staff', async () => {
    const res = await request(app)
      .put('/api/transactions/tx-1/cancel')
      .set('Authorization', 'Bearer staff-token');

    expect(res.status).toBe(403);
  });

  it('should reject already cancelled', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-cancelled', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 0, status: 'Cancelled',
      item: { id: 1, name: 'Test', status: 'Available' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-cancelled/cancel')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(400);
  });
});

describe('GET /api/transactions/upcoming', () => {
  it('should list upcoming returns for staff', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/transactions/upcoming')
      .set('Authorization', 'Bearer staff-token');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should reject for customer', async () => {
    const res = await request(app)
      .get('/api/transactions/upcoming')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/dashboard/kpis', () => {
  it('should return KPIs for admin', async () => {
    const res = await request(app)
      .get('/api/dashboard/kpis')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('activeRentals');
    expect(res.body).toHaveProperty('overdueReturns');
    expect(res.body).toHaveProperty('monthlyRevenue');
  });

  it('should reject for customer', async () => {
    const res = await request(app)
      .get('/api/dashboard/kpis')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/dashboard/today', () => {
  it('should return today tasks for staff', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.inventoryItem.count.mockResolvedValueOnce(0);

    const res = await request(app)
      .get('/api/dashboard/today')
      .set('Authorization', 'Bearer staff-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dueToday');
    expect(res.body).toHaveProperty('overdue');
    expect(res.body).toHaveProperty('inCleaning');
  });

  it('should reject for customer', async () => {
    const res = await request(app)
      .get('/api/dashboard/today')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(403);
  });
});
