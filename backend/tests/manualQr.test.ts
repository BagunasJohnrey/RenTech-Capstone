import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/storage.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/storage.service.js')>();
  return { ...actual, uploadFile: vi.fn() };
});

import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  getPaymentGateway,
  parseManualQrCodes,
  assertValidManualQrCodes,
} from '../src/services/settings.service.js';
import { applyPaymentToTransaction } from '../src/services/payments.ledger.js';
import { recordPayment } from '../src/services/transactions.service.js';

const app = express();
// Mirror the production body limit (index.ts, 25mb) so the 5MB decoded proof
// cap is exercised by the service, not rejected by body-parser first.
app.use(express.json({ limit: '25mb' }));
app.use('/api', routes);
app.use(errorHandler);

const QR = { id: 'gcash-1', label: 'GCash', accountName: 'Mylene S.', imagePath: 'qrcodes/gcash-1.webp' };

describe('getPaymentGateway manual', () => {
  it('returns manual when the rule says so', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([{ key: 'payment_gateway', value: 'manual' }]);
    expect(await getPaymentGateway()).toBe('manual');
  });
});

describe('parseManualQrCodes', () => {
  it('parses a valid list', () => {
    expect(parseManualQrCodes(JSON.stringify([QR]))).toEqual([QR]);
  });
  it('tolerates garbage without throwing', () => {
    expect(parseManualQrCodes('not-json')).toEqual([]);
    expect(parseManualQrCodes(undefined)).toEqual([]);
    expect(parseManualQrCodes(JSON.stringify([{ id: 'x' }, QR]))).toEqual([QR]);
    // path traversal / absolute URLs are not allowed
    expect(parseManualQrCodes(JSON.stringify([{ ...QR, imagePath: '../secrets' }]))).toEqual([]);
    expect(parseManualQrCodes(JSON.stringify([{ ...QR, imagePath: 'https://evil/x.png' }]))).toEqual([]);
  });
});

describe('assertValidManualQrCodes', () => {
  it('returns the parsed list for valid input', () => {
    expect(assertValidManualQrCodes(JSON.stringify([QR]))).toEqual([QR]);
  });
  it('throws 400 on malformed JSON / non-array / invalid entries', () => {
    expect(() => assertValidManualQrCodes('oops')).toThrow(/valid JSON/);
    expect(() => assertValidManualQrCodes('{}')).toThrow(/array/);
    expect(() => assertValidManualQrCodes(JSON.stringify([{ id: '', label: '', accountName: '', imagePath: '' }]))).toThrow(/Invalid QR/);
  });
});

describe('GET /api/settings/rental-defaults with manual gateway', () => {
  it('carries the parsed QR list and the manual gateway', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([
      { key: 'payment_gateway', value: 'manual' },
      { key: 'manual_qr_codes', value: JSON.stringify([QR]) },
    ]);
    const res = await request(app).get('/api/settings/rental-defaults');
    expect(res.status).toBe(200);
    expect(res.body.payment_gateway).toBe('manual');
    expect(res.body.manual_qr_codes).toEqual([QR]);
  });

  it('defaults manual_qr_codes to [] when unset', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/settings/rental-defaults');
    expect(res.body.manual_qr_codes).toEqual([]);
  });
});

describe('PUT /api/settings/rules validates manual_qr_codes', () => {
  it('rejects malformed JSON with 400', async () => {
    const res = await request(app)
      .put('/api/settings/rules')
      .set('Authorization', 'Bearer admin-token')
      .send({ manual_qr_codes: 'not-json' });
    expect(res.status).toBe(400);
  });
});

describe('ledger credits a manual proof', () => {
  it('writes a manual/instapay payment row and moves totals', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', status: 'Active', rentalFee: 5000, latePenalty: 0, damageFee: 0, totalPaid: 0, balance: 5000,
    });
    prisma.payment.findUnique.mockResolvedValueOnce(null);

    const result = await applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 5000, gateway: 'manual', gatewayRef: 'proof_p1', method: 'instapay',
    });

    expect(result).toMatchObject({ duplicate: false, totalPaid: 5000, balance: 0 });
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gateway: 'manual', gatewayRef: 'proof_p1', method: 'instapay', status: 'succeeded' }),
    }));
  });

  it('treats a repeated gatewayRef as a duplicate', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', status: 'Active', rentalFee: 5000, totalPaid: 5000, balance: 0, latePenalty: 0, damageFee: 0,
    });
    prisma.payment.findUnique.mockResolvedValueOnce({ id: 'pay-existing' });
    const result = await applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 5000, gateway: 'manual', gatewayRef: 'proof_p1', method: 'instapay',
    });
    expect(result.duplicate).toBe(true);
  });
});

describe('recordPayment accepts instapay', () => {
  it('rejects an unknown method', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', status: 'Active', rentalFee: 5000, totalPaid: 0, latePenalty: 0, damageFee: 0, payments: [],
    });
    await expect(recordPayment('tx-1', 'staff-1', 200, 'bitcoin')).rejects.toThrow(/Invalid payment method/);
  });

  it('accepts instapay', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', status: 'Active', rentalFee: 5000, totalPaid: 0, latePenalty: 0, damageFee: 0, payments: [],
    });
    // recordPayment uses the ARRAY form of $transaction — the default mock only
    // supports the callback form, so resolve it explicitly for this test.
    (prisma.$transaction as any).mockResolvedValueOnce([
      { id: 'pay-1', amount: 200, method: 'instapay' },
      { id: 'tx-1', totalPaid: 200, balance: 4800 },
    ]);
    await expect(recordPayment('tx-1', 'staff-1', 200, 'instapay')).resolves.toBeDefined();
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: 'instapay' }),
    }));
  });
});

describe('recordPayment route accepts instapay', () => {
  it('POST /api/transactions/:id/payments records an instapay payment', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', status: 'Active', rentalFee: 5000, totalPaid: 0, latePenalty: 0, damageFee: 0, payments: [],
    });
    // Same array-form override as the service test above: the default mock only
    // supports the callback form of $transaction.
    (prisma.$transaction as any).mockResolvedValueOnce([
      { id: 'pay-1', amount: 200, method: 'instapay' },
      { id: 'tx-1', totalPaid: 200, balance: 4800 },
    ]);

    const res = await request(app)
      .post('/api/transactions/tx-1/payments')
      .set('Authorization', 'Bearer staff-token')
      .send({ amount: 200, method: 'instapay' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ totalPaid: 200, balance: 4800 });
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: 'instapay' }),
    }));
  });
});

const proofBody = {
  data: Buffer.from('fake-image-bytes').toString('base64'),
  contentType: 'image/jpeg',
  reference: '000123456789',
  channel: 'gcash-1',
};

// customer-token resolves to the Profile whose id is 'customer-id-111'
// (see tests/setup.ts) — req.user.id is the profile id, not the auth id.
const manualTx = {
  id: 'tx-1', txNumber: 1001, status: 'Active', customerId: 'customer-id-111',
  rentalFee: 5000, downpayment: 200, totalPaid: 0, balance: 5000, gateway: null, paymentPath: null,
  item: { name: 'Barong' }, customer: { name: 'Ana' },
};

describe('POST /api/bookings/:id/payment-proof', () => {
  it('uploads, stores, marks paymentPath, and alerts staff+admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { uploadFile } = await import('../src/services/storage.service.js');
    (uploadFile as any).mockResolvedValueOnce({ path: 'rental/tx-1/proof-1.webp', thumbPath: null, public: false });
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx });
    prisma.paymentProof.findFirst.mockResolvedValueOnce(null);
    prisma.profile.findMany.mockResolvedValueOnce([{ id: 'staff-1' }, { id: 'admin-1' }]);

    const res = await request(app)
      .post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token')
      .send(proofBody);

    expect(res.status).toBe(201);
    expect(res.body.proof).toMatchObject({ status: 'pending', amount: 200, reference: '000123456789' });
    expect(prisma.paymentProof.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ transactionId: 'tx-1', amount: 200, imagePath: 'rental/tx-1/proof-1.webp' }),
    }));
    expect(prisma.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-1' }, data: { paymentPath: 'manual' },
    }));
    expect(prisma.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({ profileId: 'staff-1', type: 'payment_proof' })]),
    }));
  });

  it('403s another customer\'s booking', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx, customerId: 'someone-else' });
    const res = await request(app).post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token').send(proofBody);
    expect(res.status).toBe(403);
    expect(prisma.paymentProof.create).not.toHaveBeenCalled();
  });

  it('400s a cancelled booking', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx, status: 'Cancelled' });
    const res = await request(app).post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token').send(proofBody);
    expect(res.status).toBe(400);
  });

  it('400s when the downpayment is already settled', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx, totalPaid: 200 });
    const res = await request(app).post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token').send(proofBody);
    expect(res.status).toBe(400);
  });

  it('400s a booking with an active gateway charge', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx, gateway: 'maya' });
    const res = await request(app).post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token').send(proofBody);
    expect(res.status).toBe(400);
  });

  it('409s while a proof is already pending', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx });
    prisma.paymentProof.findFirst.mockResolvedValueOnce({ id: 'proof-live', status: 'pending' });
    const res = await request(app).post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token').send(proofBody);
    expect(res.status).toBe(409);
  });

  it('400s an oversize screenshot before uploading', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { uploadFile } = await import('../src/services/storage.service.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx });
    prisma.paymentProof.findFirst.mockResolvedValueOnce(null);
    const big = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64');
    const res = await request(app).post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token').send({ ...proofBody, data: big });
    expect(res.status).toBe(400);
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
