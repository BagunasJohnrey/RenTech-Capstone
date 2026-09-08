import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

// Dynamic future dates — hardcoded dates rot (pickup-in-the-past 400s) as
// real time moves forward. Pickup = +2 days, due = +5 days.
const futureDate = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const PICKUP = futureDate(2);
const DUE = futureDate(5);

describe('GET /api/catalog', () => {
  it('should list available items without auth', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findMany.mockResolvedValueOnce([
      { id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available', transactions: [] },
    ]);

    const res = await request(app).get('/api/catalog');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should filter by category', async () => {
    const res = await request(app).get('/api/catalog?category=Gown');
    expect(res.status).toBe(200);
  });

  it('should search by name', async () => {
    const res = await request(app).get('/api/catalog?search=Suit');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/catalog/:id', () => {
  it('should return item detail', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available', transactions: [],
    });

    const res = await request(app).get('/api/catalog/1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'Test Gown');
  });

  it('should return 404 for non-existent item', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce(null);

    const res = await request(app).get('/api/catalog/999');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/bookings', () => {
  it('should create booking when customer', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValueOnce(null);

    // Security contract: fee is derived server-side (₱5000), customer must put
    // down >= 50% (₱2500), and pickup can't be in the past.
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', 'Bearer customer-token')
      .send({ itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 2500 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.rentalFee).toBe(5000);
  });

  it('should reject when not authenticated', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ itemId: 1, rentalDate: PICKUP, dueDate: DUE });

    expect(res.status).toBe(401);
  });

  it('should reject when admin (customer-only endpoint)', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', 'Bearer admin-token')
      .send({ itemId: 1, rentalDate: PICKUP, dueDate: DUE });

    expect(res.status).toBe(403);
  });

  it('should reject a downpayment below the 50% minimum', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', 'Bearer customer-token')
      .send({ itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 1000 });

    expect(res.status).toBe(400);
  });

  it('should reject when item unavailable', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'Rented',
    });
    // An active rental exists on the item → both the status check and the
    // overlap check must see it (persistent mock: findFirst is called twice).
    prisma.transaction.findFirst.mockResolvedValue({ id: 'tx-1' });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', 'Bearer customer-token')
      .send({ itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 2500 });

    expect(res.status).toBe(409);
  });
});

describe('GET /api/bookings', () => {
  it('should list customer bookings', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([]);
    prisma.transaction.count.mockResolvedValueOnce(0);

    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('transactions');
    expect(res.body).toHaveProperty('total');
  });

  it('should reject for admin', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/bookings/:id', () => {
  it('should return booking detail for own booking', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'booking-1', customerId: 'customer-id-111', itemId: 1,
      rentalDate: new Date(), dueDate: new Date(), rentalFee: 5000, balance: 4000, status: 'Active',
      customer: { id: 'customer-id-111', name: 'Customer', email: 'customer@example.com' },
      item: { id: 1, name: 'Test Gown', category: 'Gown' },
      payments: [],
    });

    const res = await request(app)
      .get('/api/bookings/booking-1')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'booking-1');
  });

  it('should reject for another customer\'s booking', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'booking-2', customerId: 'other-customer-id', itemId: 1,
      rentalDate: new Date(), dueDate: new Date(), rentalFee: 5000, balance: 4000, status: 'Active',
      customer: { id: 'other-customer-id', name: 'Other', email: 'other@example.com' },
      item: { id: 1, name: 'Test', category: 'Gown' },
      payments: [],
    });

    const res = await request(app)
      .get('/api/bookings/booking-2')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(403);
  });
});

describe('POST /api/ai/chat', () => {
  it('should answer from FAQ for known questions', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer customer-token')
      .send({ message: 'How much is the rental?' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reply');
    expect(res.body.source).toBe('faq');
  });

  it('should return fallback when no FAQ match and no API key', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer customer-token')
      .send({ message: 'What colors are trending this season?' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reply');
  });

  it('should reject unauthenticated', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .send({ message: 'Hello' });

    expect(res.status).toBe(401);
  });

  it('should reject for admin (customer-only)', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer admin-token')
      .send({ message: 'Hello' });

    expect(res.status).toBe(403);
  });

  it('should reject empty message', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer customer-token')
      .send({ message: '' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/catalog/:id validation', () => {
  it('non-numeric id → 400 (not 500)', async () => {
    const res = await request(app).get('/api/catalog/abc');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/bookings query validation', () => {

  it('garbage status → 400', async () => {
    const res = await request(app)
      .get('/api/bookings?status=garbage')
      .set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(400);
  });

  it('valid status → not 400', async () => {
    const res = await request(app)
      .get('/api/bookings?status=Active')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).not.toBe(400);
  });
});

describe('POST /api/customers/contact', () => {
  it('should send a message without a booking', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.notification.createMany = vi.fn().mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/customers/contact')
      .set('Authorization', 'Bearer customer-token')
      .send({ message: 'Please cancel my booking, my event was moved.' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(prisma.notification.createMany).toHaveBeenCalled();
  });

  it('should send a message about an own booking', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.notification.createMany = vi.fn().mockResolvedValue({ count: 1 });
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'booking-1', customerId: 'customer-id-111', txNumber: 1001,
    });

    const res = await request(app)
      .post('/api/customers/contact')
      .set('Authorization', 'Bearer customer-token')
      .send({ transactionId: 'booking-1', message: 'Please cancel this booking for me, thanks!' });

    expect(res.status).toBe(200);
  });

  it('should reject messaging about another customer booking', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'booking-2', customerId: 'other-customer-id', txNumber: 1002,
    });

    const res = await request(app)
      .post('/api/customers/contact')
      .set('Authorization', 'Bearer customer-token')
      .send({ transactionId: 'booking-2', message: 'Please cancel this booking for me, thanks!' });

    expect(res.status).toBe(403);
  });

  it('should reject a too-short message', async () => {
    const res = await request(app)
      .post('/api/customers/contact')
      .set('Authorization', 'Bearer customer-token')
      .send({ message: 'hi' });

    expect(res.status).toBe(400);
  });

  it('should reject unauthenticated', async () => {
    const res = await request(app)
      .post('/api/customers/contact')
      .send({ message: 'Please cancel my booking, my event was moved.' });

    expect(res.status).toBe(401);
  });

  it('should reject for admin (customer-only endpoint)', async () => {
    const res = await request(app)
      .post('/api/customers/contact')
      .set('Authorization', 'Bearer admin-token')
      .send({ message: 'Please cancel my booking, my event was moved.' });

    expect(res.status).toBe(403);
  });
});
