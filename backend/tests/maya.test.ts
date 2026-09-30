import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  createQrPayment,
  retrievePayment,
  retrievePaymentStatus,
  cancelPayment,
  isMayaWebhookIpAllowed,
  checkMayaHealth,
} from '../src/services/maya.service.js';

vi.mock('../src/config/env.js', () => ({
  env: {
    MAYA_PUBLIC_KEY: 'pk_test_mock',
    MAYA_SECRET_KEY: 'sk_test_mock',
    MAYA_ENV: 'sandbox',
    MAYA_SIMULATE: false,
    MAYA_WEBHOOK_ALLOWED_IPS: [],
    PAYMONGO_SECRET_KEY: '',
    PAYMONGO_SIMULATE: true,
    NODE_ENV: 'test',
    FRONTEND_URL: 'http://localhost:5173',
  },
}));

describe('getPaymentGateway', () => {
  it('falls back to paymongo when the rule is unset', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([]);
    const { getPaymentGateway } = await import('../src/services/settings.service.js');
    expect(await getPaymentGateway()).toBe('paymongo');
  });

  it('returns maya when the rule says so', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([{ key: 'payment_gateway', value: 'maya' }]);
    const { getPaymentGateway } = await import('../src/services/settings.service.js');
    expect(await getPaymentGateway()).toBe('maya');
  });

  it('falls back to paymongo for an unrecognized gateway value', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([{ key: 'payment_gateway', value: 'stripe' }]);
    const { getPaymentGateway } = await import('../src/services/settings.service.js');
    expect(await getPaymentGateway()).toBe('paymongo');
  });
});

const SANDBOX = 'https://pg-sandbox.paymaya.com';

describe('createQrPayment', () => {
  beforeEach(() => { global.fetch = vi.fn(); });

  it('converts pesos to centavos and returns the normalized charge', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        paymentId: 'pay-maya-1',
        redirectUrl: 'https://pg-sandbox.paymaya.com/pay/pay-maya-1',
        qrCodeBody: 'https://paymaya.com/qr/pay-maya-1',
        totalAmount: { currency: 'PHP', value: 250000 },
      }),
    });

    const charge = await createQrPayment(2500, 'Downpayment TX-1001', {
      transactionId: 'tx-1',
      requestReferenceNumber: 'TX-1001',
      redirectUrl: { success: 'http://localhost:5173/payment-return?tx=tx-1' },
    });

    expect(charge).toMatchObject({ gateway: 'maya', id: 'pay-maya-1', amount: 2500, simulated: false });
    expect(charge.redirectUrl).toBe('https://pg-sandbox.paymaya.com/pay/pay-maya-1');
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.totalAmount).toEqual({ currency: 'PHP', value: 250000 });
    expect(body.redirectUrl.success).toBe('http://localhost:5173/payment-return?tx=tx-1');
    expect((global.fetch as any).mock.calls[0][0]).toBe(`${SANDBOX}/payments/v1/qr/payments`);
  });

  it('sets expiresAt one hour out', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'p2', redirectUrl: 'u', totalAmount: { value: 20000 } }),
    });
    const charge = await createQrPayment(200, 'd', { transactionId: 't', requestReferenceNumber: 'r' });
    const delta = new Date(charge.expiresAt!).getTime() - Date.now();
    expect(delta).toBeGreaterThan(59 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('does not leak the upstream error body', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve('Maya internal detail') });
    await expect(createQrPayment(200, 'd', { transactionId: 't', requestReferenceNumber: 'r' }))
      .rejects.toThrow('Payment provider error (400)');
  });

  it('returns a simulated charge when no key is configured', async () => {
    const { env } = await import('../src/config/env.js');
    env.MAYA_PUBLIC_KEY = '';
    const charge = await createQrPayment(200, 'd', { transactionId: 't', requestReferenceNumber: 'r' });
    expect(charge.simulated).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    env.MAYA_PUBLIC_KEY = 'pk_test_mock';
  });
});

describe('retrievePayment', () => {
  beforeEach(() => { global.fetch = vi.fn(); });

  it('normalizes SUCCESS and the amount', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'p1', paymentStatus: 'SUCCESS', totalAmount: { value: 250000 }, receiptNumber: 'RRN123' }),
    });
    expect(await retrievePayment('p1')).toEqual({ paymentId: 'p1', status: 'SUCCESS', amount: 2500, receiptNumber: 'RRN123' });
    expect((global.fetch as any).mock.calls[0][0]).toBe(`${SANDBOX}/payments/v1/payments/p1`);
  });
});

describe('retrievePaymentStatus', () => {
  it('returns the status from the public status endpoint', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'p1', paymentStatus: 'PENDING' }),
    });
    expect(await retrievePaymentStatus('p1')).toEqual({ paymentId: 'p1', status: 'PENDING' });
    expect((global.fetch as any).mock.calls[0][0]).toBe(`${SANDBOX}/payments/v1/payments/p1/status`);
  });
});

describe('cancelPayment', () => {
  it('posts to the cancel endpoint', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    await cancelPayment('p1');
    expect((global.fetch as any).mock.calls[0][0]).toBe(`${SANDBOX}/payments/v1/payments/p1/cancel`);
    expect((global.fetch as any).mock.calls[0][1].method).toBe('POST');
  });
});

describe('isMayaWebhookIpAllowed', () => {
  it('allows everything when the allowlist is empty', async () => {
    const { env } = await import('../src/config/env.js');
    env.MAYA_WEBHOOK_ALLOWED_IPS = [];
    expect(isMayaWebhookIpAllowed('1.2.3.4')).toBe(true);
    expect(isMayaWebhookIpAllowed(undefined)).toBe(true);
  });

  it('rejects an ip outside a configured allowlist', async () => {
    const { env } = await import('../src/config/env.js');
    env.MAYA_WEBHOOK_ALLOWED_IPS = ['5.6.7.8'];
    expect(isMayaWebhookIpAllowed('1.2.3.4')).toBe(false);
    expect(isMayaWebhookIpAllowed('5.6.7.8')).toBe(true);
    env.MAYA_WEBHOOK_ALLOWED_IPS = [];
  });
});

describe('checkMayaHealth', () => {
  it('reports a 401 as an invalid key', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
    const health = await checkMayaHealth();
    expect(health).toMatchObject({ configured: true, reachable: false });
    expect(health.detail).toMatch(/401/);
  });

  it('reports reachable on a 200', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    expect(await checkMayaHealth()).toMatchObject({ configured: true, reachable: true });
  });
});
import { applyPaymentToTransaction } from '../src/services/payments.ledger.js';
import routes from '../src/routes/index.js';
import webhookRoutes from '../src/routes/webhooks.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

const webhookApp = express();
webhookApp.use('/api/webhooks', express.json(), webhookRoutes);
webhookApp.use(errorHandler);

const txOpen = {
  id: 'tx-1', txNumber: 1001, status: 'Active', customerId: 'customer-id-111',
  rentalFee: 5000, latePenalty: 0, damageFee: 0, totalPaid: 0, balance: 5000,
};

const successPayload = {
  id: 'pay-maya-1',
  paymentStatus: 'SUCCESS',
  receiptNumber: 'RRN123',
  metadata: { transactionId: 'tx-1' },
};

function mockMayaRetrieve(over: Record<string, any> = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ paymentId: 'pay-maya-1', paymentStatus: 'SUCCESS', totalAmount: { value: 200000 }, ...over }),
  });
}

describe('POST /api/payments/create-intent with gateway=maya', () => {
  it('returns a Maya redirect URL and stores the payment ref', async () => {
    const { prisma } = await import('../src/config/database.js');
    // getBusinessRules() is read twice: once for min_downpayment, once for the
    // gateway selection.
    prisma.businessRule.findMany
      .mockResolvedValueOnce([{ key: 'min_downpayment', value: '200' }])
      .mockResolvedValueOnce([{ key: 'payment_gateway', value: 'maya' }]);
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen, payments: [] });
    prisma.transaction.update.mockResolvedValueOnce({});
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        paymentId: 'pay-maya-9',
        redirectUrl: 'https://pg-sandbox.paymaya.com/pay/pay-maya-9',
        qrCodeBody: 'https://paymaya.com/qr/pay-maya-9',
        totalAmount: { currency: 'PHP', value: 200000 },
      }),
    });

    const res = await request(app)
      .post('/api/payments/create-intent')
      .set('Authorization', 'Bearer customer-token')
      .send({ transactionId: 'tx-1', amount: 2000 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gateway: 'maya', paymentId: 'pay-maya-9' });
    expect(res.body.redirectUrl).toContain('pay-maya-9');
    expect(res.body.simulated).toBe(false);
    expect(prisma.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gateway: 'maya', gatewayPaymentId: 'pay-maya-9' }),
    }));
  });

  it('still enforces the [min, due] payment bounds under maya', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany
      .mockResolvedValueOnce([{ key: 'min_downpayment', value: '200' }])
      .mockResolvedValueOnce([{ key: 'payment_gateway', value: 'maya' }]);
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen, payments: [] });
    global.fetch = vi.fn();

    const res = await request(app)
      .post('/api/payments/create-intent')
      .set('Authorization', 'Bearer customer-token')
      .send({ transactionId: 'tx-1', amount: 100 });

    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/payments/transaction/:id/status', () => {
  it('reports succeeded without calling Maya when a payment is already recorded', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen, totalPaid: 2000, balance: 3000 });
    global.fetch = vi.fn();

    const res = await request(app)
      .get('/api/payments/transaction/tx-1/status')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'succeeded', totalPaid: 2000, balance: 3000 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('credits and reports succeeded when Maya confirms a payment the webhook missed', async () => {
    const { prisma } = await import('../src/config/database.js');
    // Read twice: once for the ownership/gateway check, once inside the ledger.
    prisma.transaction.findUnique
      .mockResolvedValueOnce({ ...txOpen, gateway: 'maya', gatewayPaymentId: 'pay-maya-7' })
      .mockResolvedValueOnce({ ...txOpen, gateway: 'maya', gatewayPaymentId: 'pay-maya-7' });
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'pay-maya-7', paymentStatus: 'SUCCESS', totalAmount: { value: 200000 } }),
    });

    const res = await request(app)
      .get('/api/payments/transaction/tx-1/status')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'succeeded', totalPaid: 2000, balance: 3000 });
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gatewayRef: 'pay-maya-7', amount: 2000 }),
    }));
  });

  it('reports pending while Maya is still pending', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen, gateway: 'maya', gatewayPaymentId: 'pay-maya-8' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'pay-maya-8', paymentStatus: 'PENDING' }),
    });

    const res = await request(app)
      .get('/api/payments/transaction/tx-1/status')
      .set('Authorization', 'Bearer customer-token');

    expect(res.body).toMatchObject({ status: 'pending', totalPaid: 0 });
  });

  it('reports failed on PAYMENT_FAILED', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen, gateway: 'maya', gatewayPaymentId: 'pay-maya-x' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'pay-maya-x', paymentStatus: 'PAYMENT_FAILED' }),
    });

    const res = await request(app).get('/api/payments/transaction/tx-1/status').set('Authorization', 'Bearer customer-token');
    expect(res.body).toMatchObject({ status: 'failed' });
  });

  it('reports expired when the one-time QR has lapsed', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen, gateway: 'maya', gatewayPaymentId: 'pay-maya-y' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'pay-maya-y', paymentStatus: 'PAYMENT_EXPIRED' }),
    });

    const res = await request(app).get('/api/payments/transaction/tx-1/status').set('Authorization', 'Bearer customer-token');
    expect(res.body).toMatchObject({ status: 'expired' });
  });

  it('403s another customer\'s transaction', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen, customerId: 'someone-else' });
    const res = await request(app).get('/api/payments/transaction/tx-1/status').set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(403);
  });

  it('404s an unknown transaction', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/payments/transaction/nope/status').set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/webhooks/maya', () => {
  it('credits a verified SUCCESS webhook', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    global.fetch = mockMayaRetrieve();

    const res = await request(webhookApp).post('/api/webhooks/maya').send(successPayload);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, verified: true });
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gateway: 'maya', gatewayRef: 'pay-maya-1', method: 'maya', amount: 2000 }),
    }));
  });

  it('REFUSES a forged SUCCESS the secret-key re-check does not confirm', async () => {
    const { prisma } = await import('../src/config/database.js');
    global.fetch = mockMayaRetrieve({ paymentStatus: 'PENDING' });

    const res = await request(webhookApp).post('/api/webhooks/maya').send(successPayload);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, verified: false });
    // Rejected on the re-check alone: no transaction read, no payment written.
    expect(prisma.transaction.findUnique).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('never credits more than Maya confirmed (Review Focus #3: forged inflation)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    // Payload claims PHP 2000; Maya actually received PHP 2.
    global.fetch = mockMayaRetrieve({ totalAmount: { value: 200 } });

    const res = await request(webhookApp).post('/api/webhooks/maya')
      .send({ ...successPayload, totalAmount: { value: 200000 } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, verified: true });
    // The credit is PHP 2 — the payload's PHP 2000 claim is discarded.
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 2 }),
    }));
  });

  it('uses the re-check amount when the payload understates it (Review Focus #5)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    // Payload claims PHP 9999.99; Maya actually received PHP 1500.
    global.fetch = mockMayaRetrieve({ totalAmount: { value: 150000 } });

    await request(webhookApp).post('/api/webhooks/maya')
      .send({ ...successPayload, totalAmount: { value: 999999 } });

    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 1500 }),
    }));
  });

  it('answers 200 without crediting when the re-check itself fails', async () => {
    const { prisma } = await import('../src/config/database.js');
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') });

    const res = await request(webhookApp).post('/api/webhooks/maya').send(successPayload);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, verified: false });
    expect(prisma.transaction.findUnique).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('reports duplicate for a replayed webhook', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);
    prisma.payment.findUnique.mockResolvedValueOnce({ id: 'pay-existing', gatewayRef: 'pay-maya-1' });
    global.fetch = mockMayaRetrieve();

    const res = await request(webhookApp).post('/api/webhooks/maya').send(successPayload);
    expect(res.body).toMatchObject({ received: true, duplicate: true });
  });

  it('ignores a non-SUCCESS event without calling Maya', async () => {
    const { prisma } = await import('../src/config/database.js');
    global.fetch = vi.fn();

    const res = await request(webhookApp).post('/api/webhooks/maya')
      .send({ id: 'pay-maya-1', paymentStatus: 'PAYMENT_FAILED' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, verified: false });
    expect(global.fetch).not.toHaveBeenCalled();
    // Rejected before any lookup — deliberately not queueing a findUnique here,
    // an unused mockResolvedValueOnce would leak into the next test.
    expect(prisma.transaction.findUnique).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('403s a source outside a configured IP allowlist', async () => {
    const { env } = await import('../src/config/env.js');
    const { prisma } = await import('../src/config/database.js');
    env.MAYA_WEBHOOK_ALLOWED_IPS = ['203.0.113.9'];

    const res = await request(webhookApp).post('/api/webhooks/maya').send(successPayload);

    expect(res.status).toBe(403);
    expect(prisma.transaction.findUnique).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    env.MAYA_WEBHOOK_ALLOWED_IPS = [];
  });

  it('resolves the transaction by gatewayPaymentId when metadata is absent', async () => {
    const { prisma } = await import('../src/config/database.js');
    // No metadata ⇒ correlate via the stored gateway ref, then the ledger
    // re-reads the transaction it was handed.
    prisma.transaction.findFirst.mockResolvedValueOnce({ ...txOpen, gatewayPaymentId: 'pay-maya-1' });
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen });
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    global.fetch = mockMayaRetrieve();

    const res = await request(webhookApp).post('/api/webhooks/maya')
      .send({ id: 'pay-maya-1', paymentStatus: 'SUCCESS', totalAmount: { value: 200000 } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, verified: true });
  });
});

const openTx = {
  id: 'tx-1', txNumber: 1001, status: 'Active',
  rentalFee: 5000, latePenalty: 0, damageFee: 0, totalPaid: 0, balance: 5000,
};

describe('applyPaymentToTransaction', () => {
  it('credits the payment and recomputes the balance', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(openTx);
    prisma.payment.findUnique.mockResolvedValueOnce(null);

    const result = await applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 2000, gateway: 'maya', gatewayRef: 'pay-maya-1', method: 'maya',
    });

    expect(result).toMatchObject({ duplicate: false, totalPaid: 2000, balance: 3000 });
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gateway: 'maya', gatewayRef: 'pay-maya-1', method: 'maya', type: 'downpayment' }),
    }));
    expect(prisma.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ totalPaid: 2000, balance: 3000, gatewayPaymentId: 'pay-maya-1' }),
    }));
  });

  it('classifies a full payment', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(openTx);
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    await applyPaymentToTransaction({ transactionId: 'tx-1', amount: 5000, gateway: 'maya', gatewayRef: 'p-full', method: 'maya' });
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'full_payment' }),
    }));
  });

  it('is idempotent for an already-recorded gatewayRef', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(openTx);
    prisma.payment.findUnique.mockResolvedValueOnce({ id: 'pay-existing', gatewayRef: 'pay-maya-1' });

    const result = await applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 2000, gateway: 'maya', gatewayRef: 'pay-maya-1', method: 'maya',
    });

    expect(result.duplicate).toBe(true);
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('treats a P2002 race as a duplicate', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(openTx);
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    prisma.payment.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));

    const result = await applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 2000, gateway: 'maya', gatewayRef: 'pay-maya-1', method: 'maya',
    });
    expect(result.duplicate).toBe(true);
  });

  it('refuses a payment on a closed transaction', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...openTx, status: 'Returned' });
    await expect(applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 2000, gateway: 'maya', gatewayRef: 'pay-late', method: 'maya',
    })).rejects.toThrow(/already closed/);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('includes latePenalty and damageFee in the balance', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...openTx, latePenalty: 300, damageFee: 500 });
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    const result = await applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 1000, gateway: 'maya', gatewayRef: 'p-3', method: 'maya',
    });
    expect(result).toMatchObject({ totalPaid: 1000, balance: 4800 });
  });
});
