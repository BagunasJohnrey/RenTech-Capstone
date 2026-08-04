import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../src/config/env.js', () => ({
  env: {
    PAYMONGO_SECRET_KEY: 'sk_test_mock',
    PAYMONGO_WEBHOOK_SECRET: 'whsec_mock',
    PAYMONGO_PUBLIC_KEY: 'pk_test_mock',
    FRONTEND_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
    PORT: 3001,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    SUPABASE_ANON_KEY: 'test-anon',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    SEMAPHORE_API_KEY: '',
    GEMINI_API_KEY: '',
  },
}));

const MOCK_SIGNATURE = 'a'.repeat(64);

vi.mock('crypto', () => ({
  default: {
    createHmac: () => ({
      update: () => ({
        digest: () => MOCK_SIGNATURE,
      }),
    }),
    timingSafeEqual: (a: Buffer, b: Buffer) => a.toString() === b.toString(),
  },
  createHmac: () => ({
    update: () => ({
      digest: () => MOCK_SIGNATURE,
    }),
  }),
  timingSafeEqual: (a: Buffer, b: Buffer) => a.toString() === b.toString(),
}));

import routes from '../src/routes/index.js';
import webhookRoutes from '../src/routes/webhooks.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

const webhookApp = express();
webhookApp.use('/api/webhooks', express.raw({ type: 'application/json' }), (req, _res, next) => {
  if (Buffer.isBuffer(req.body)) {
    (req as unknown as { rawBody: string }).rawBody = req.body.toString('utf-8');
    try { req.body = JSON.parse(req.body.toString('utf-8')); } catch { req.body = {}; }
  }
  next();
}, webhookRoutes);
webhookApp.use(errorHandler);

describe('POST /api/payments/create-intent', () => {
  beforeAll(() => {
    global.fetch = vi.fn();
  });

  it('should create payment intent for own transaction', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', txNumber: 1001, customerId: 'customer-id-111',
      rentalFee: 5000, downpayment: 1000, balance: 4000,
      status: 'Active', totalPaid: 0, latePenalty: 0, damageFee: 0,
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: {
          id: 'pi_mock123',
          attributes: {
            amount: 250000,
            currency: 'PHP',
            status: 'awaiting_payment_method',
            client_key: 'ck_mock123',
            metadata: { transactionId: 'tx-1', customerId: 'customer-id-111' },
          },
        },
      }),
    });

    const res = await request(app)
      .post('/api/payments/create-intent')
      .set('Authorization', 'Bearer customer-token')
      // 2500 = the 50% minimum downpayment of the 5000 fee (security rule:
      // payments must be within [50% of fee, outstanding balance]).
      .send({ transactionId: 'tx-1', amount: 2500 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('paymentIntentId', 'pi_mock123');
    expect(res.body).toHaveProperty('clientKey');
  });

  it('should reject a payment below the 50% minimum downpayment', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', txNumber: 1001, customerId: 'customer-id-111',
      rentalFee: 5000, downpayment: 1000, balance: 4000,
      status: 'Active', totalPaid: 0, latePenalty: 0, damageFee: 0,
    });

    const res = await request(app)
      .post('/api/payments/create-intent')
      .set('Authorization', 'Bearer customer-token')
      .send({ transactionId: 'tx-1', amount: 1000 });

    expect(res.status).toBe(400);
  });

  it('should reject for another customer\'s transaction', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-other', customerId: 'other-customer-id', txNumber: 1002,
      rentalFee: 3000, balance: 3000, status: 'Active',
    });

    const res = await request(app)
      .post('/api/payments/create-intent')
      .set('Authorization', 'Bearer customer-token')
      .send({ transactionId: 'tx-other', amount: 500 });

    expect(res.status).toBe(403);
  });

  it('should reject unauthenticated', async () => {
    const res = await request(app)
      .post('/api/payments/create-intent')
      .send({ transactionId: 'tx-1', amount: 1000 });

    expect(res.status).toBe(401);
  });

  it('should reject for admin (customer-only)', async () => {
    const res = await request(app)
      .post('/api/payments/create-intent')
      .set('Authorization', 'Bearer admin-token')
      .send({ transactionId: 'tx-1', amount: 1000 });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/payments/:id', () => {
  it('should return local payment by id', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.payment.findUnique.mockResolvedValueOnce({
      id: 'pay-1', transactionId: 'tx-1', amount: 1000,
      method: 'gcash', type: 'downpayment', status: 'succeeded',
      createdAt: new Date(),
      transaction: { id: 'tx-1', txNumber: 1001, customerId: 'customer-id-111', status: 'Active' },
    });

    const res = await request(app)
      .get('/api/payments/pay-1')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'pay-1');
  });

  it('should reject for another customer\'s payment', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.payment.findUnique.mockResolvedValueOnce({
      id: 'pay-2', transactionId: 'tx-other', amount: 500,
      method: 'card', type: 'downpayment', status: 'succeeded',
      createdAt: new Date(),
      transaction: { id: 'tx-other', txNumber: 1002, customerId: 'other-customer-id', status: 'Active' },
    });

    const res = await request(app)
      .get('/api/payments/pay-2')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(403);
  });

  it('should be accessible by admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.payment.findUnique.mockResolvedValueOnce({
      id: 'pay-1', transactionId: 'tx-1', amount: 1000,
      method: 'gcash', type: 'downpayment', status: 'succeeded',
      createdAt: new Date(),
      transaction: { id: 'tx-1', txNumber: 1001, customerId: 'customer-id-111', status: 'Active' },
    });

    const res = await request(app)
      .get('/api/payments/pay-1')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
  });
});

describe('POST /api/webhooks/paymongo', () => {
  it('should handle payment succeeded webhook', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', txNumber: 1001, customerId: 'customer-id-111',
      rentalFee: 5000, downpayment: 1000, balance: 4000,
      totalPaid: 0, latePenalty: 0, damageFee: 0, status: 'Active',
    });

    const payload = JSON.stringify({
      data: {
        attributes: {
          type: 'payment_intent.payment_succeeded',
          data: {
            id: 'pi_webhook123',
            attributes: {
              amount: 100000,
              status: 'succeeded',
              metadata: { transactionId: 'tx-1', customerId: 'customer-id-111' },
              payments: [{ id: 'pay_123', attributes: { amount: 100000, status: 'succeeded', source: 'gcash' } }],
            },
          },
        },
      },
    });

    const res = await request(webhookApp)
      .post('/api/webhooks/paymongo')
      .set('Content-Type', 'application/json')
      .set('paymongo-signature', MOCK_SIGNATURE)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('should reject missing signature', async () => {
    const res = await request(webhookApp)
      .post('/api/webhooks/paymongo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: { attributes: { type: 'payment_intent.payment_succeeded', data: {} } } }));

    expect(res.status).toBe(400);
  });
});
