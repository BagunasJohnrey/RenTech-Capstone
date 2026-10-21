import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/storage.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/storage.service.js')>();
  return { ...actual, uploadFile: vi.fn(), removeObject: vi.fn() };
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

describe('getPaymentGateway', () => {
  it('always returns manual (the legacy rule is ignored)', async () => {
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

describe('POST /api/bookings (manual QR)', () => {
  const futureDate = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const bookingBody = {
    itemId: 1,
    rentalDate: futureDate(2),
    dueDate: futureDate(5),
    downpayment: 2500,
    address: '123 Test St, Balayan',
    paymentPath: 'manual',
    paymentProof: proofBody,
  };

  it('rejects a manual booking with no screenshot and creates nothing', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { uploadFile } = await import('../src/services/storage.service.js');

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', 'Bearer customer-token')
      .send({ ...bookingBody, paymentProof: undefined });

    expect(res.status).toBe(400);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('uploads the screenshot first, then creates the booking + pending proof atomically', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { uploadFile } = await import('../src/services/storage.service.js');
    (uploadFile as any).mockResolvedValueOnce({ path: 'rental/customer-id-111/proof-1.webp', thumbPath: null, public: false });
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', 'Bearer customer-token')
      .send(bookingBody);

    expect(res.status).toBe(201);
    expect(uploadFile).toHaveBeenCalledWith(
      expect.stringContaining('rental/customer-id-111/proof-'),
      'image/jpeg',
      expect.any(Buffer),
    );
    expect(prisma.transaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paymentPath: 'manual', downpayment: 2500 }),
    }));
    expect(prisma.paymentProof.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        transactionId: 'tx-new',
        amount: 2500,
        imagePath: 'rental/customer-id-111/proof-1.webp',
        reference: '000123456789',
        channel: 'gcash-1',
        status: 'pending',
      }),
    }));
    expect(prisma.profile.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'customer-id-111' },
      data: { address: '123 Test St, Balayan' },
    }));
    // The customer must not be told the booking is confirmed while the
    // downpayment screenshot is still under review.
    expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'payment_proof_pending',
        title: 'Payment under review',
      }),
    }));
    expect(prisma.notification.create).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'booking_confirmation' }),
    }));
  });

  it('blocks release while the manual QR payment is unverified', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-manual', status: 'Reserved', paymentPath: 'manual', gateway: null,
      totalPaid: 0, downpayment: 200, balance: 5000, itemId: 1,
      item: { id: 1, name: 'Test Gown' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-manual/release')
      .set('Authorization', 'Bearer staff-token')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('manual QR payment proof');
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('requires a screenshot whenever the configured gateway is manual, even without paymentPath', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { uploadFile } = await import('../src/services/storage.service.js');
    // getPaymentGateway() reads the rule; no explicit paymentPath in the body.
    prisma.businessRule.findMany.mockResolvedValueOnce([{ key: 'payment_gateway', value: 'manual' }]);

    const { paymentPath, paymentProof, ...noPathBody } = bookingBody;
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', 'Bearer customer-token')
      .send(noPathBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('payment screenshot is required');
    expect(uploadFile).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('removes the uploaded screenshot when the booking is rejected', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { uploadFile, removeObject } = await import('../src/services/storage.service.js');
    (uploadFile as any).mockResolvedValueOnce({ path: 'rental/customer-id-111/proof-2.webp', thumbPath: null, public: false });
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Rented',
    });
    prisma.transaction.findFirst.mockResolvedValue({ id: 'tx-active' });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', 'Bearer customer-token')
      .send(bookingBody);

    expect(res.status).toBe(409);
    expect(removeObject).toHaveBeenCalledWith('rental/customer-id-111/proof-2.webp');
    expect(prisma.paymentProof.create).not.toHaveBeenCalled();
  });
});

describe('proof review', () => {
  const pendingProof = {
    id: 'proof-1', status: 'pending', amount: 200, reference: 'R1', channel: 'gcash-1',
    createdAt: new Date(), transaction: {
      id: 'tx-1', txNumber: 1001, status: 'Active', customerId: 'auth-customer-id',
      rentalFee: 5000, latePenalty: 0, damageFee: 0, totalPaid: 0, downpayment: 200,
      item: { name: 'Barong' },
      customer: { name: 'Bea', email: 'bea@example.com' },
    },
  };

  it('GET /proofs requires staff or admin', async () => {
    const res = await request(app).get('/api/payments/proofs').set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(403);
  });

  it('serves the queue from cache until a mutation clears it', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { listProofQueue } = await import('../src/services/paymentProofs.service.js');
    const { clearDataCache } = await import('../src/utils/ttlCache.js');
    prisma.paymentProof.findMany.mockResolvedValue([]);
    prisma.paymentProof.count.mockResolvedValue(0);
    prisma.transaction.findMany.mockResolvedValue([]);
    clearDataCache();

    await listProofQueue();
    const afterFirst = prisma.paymentProof.findMany.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    await listProofQueue();
    expect(prisma.paymentProof.findMany.mock.calls.length).toBe(afterFirst);

    clearDataCache();
    await listProofQueue();
    expect(prisma.paymentProof.findMany.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('GET /proofs returns pending rows and awaiting bookings', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findMany.mockResolvedValueOnce([pendingProof]);
    prisma.paymentProof.count.mockResolvedValueOnce(1);
    prisma.transaction.findMany.mockResolvedValueOnce([{
      id: 'tx-9', txNumber: 1009, downpayment: 200, totalPaid: 0, balance: 5000,
      status: 'Reserved', rentalDate: new Date(), dueDate: new Date(),
      item: { name: 'Gown' }, customer: { id: 'c1', name: 'Bea', phone: '0917' },
      paymentProofs: [{ status: 'rejected', rejectionReason: 'Blurry', createdAt: new Date() }],
    }]);
    const res = await request(app).get('/api/payments/proofs').set('Authorization', 'Bearer staff-token');
    expect(res.status).toBe(200);
    expect(res.body.pending).toHaveLength(1);
    expect(res.body.awaiting).toHaveLength(1);
    expect(res.body.counts).toEqual({ pending: 1, awaiting: 1, reviewed: 0 });
    // Staff need the customer's address in the awaiting-proof sheet.
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        customer: expect.objectContaining({
          select: expect.objectContaining({ address: true }),
        }),
      }),
    }));
  });

  it('GET /proofs carries the reviewed history (approved + rejected)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'proof-a', status: 'approved', amount: 200, reviewedAt: new Date(),
          reviewedBy: { id: 'staff-id-456', name: 'Staff User' },
          transaction: { id: 'tx-1', txNumber: 1001, status: 'Active', item: { name: 'Barong' }, customer: { id: 'c1', name: 'Bea' } },
        },
        {
          id: 'proof-r', status: 'rejected', amount: 200, rejectionReason: 'Blurry screenshot', reviewedAt: new Date(),
          reviewedBy: { id: 'staff-id-456', name: 'Staff User' },
          transaction: { id: 'tx-2', txNumber: 1002, status: 'Reserved', item: { name: 'Gown' }, customer: { id: 'c2', name: 'Ana' } },
        },
      ]);
    prisma.paymentProof.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    prisma.transaction.findMany.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/payments/proofs').set('Authorization', 'Bearer staff-token');
    expect(res.status).toBe(200);
    expect(res.body.reviewed).toHaveLength(2);
    expect(res.body.counts).toEqual({ pending: 0, awaiting: 0, reviewed: 2 });
    expect(res.body.reviewed[1]).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Blurry screenshot',
      reviewedBy: { name: 'Staff User' },
    });
    expect(prisma.paymentProof.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { status: { in: ['approved', 'rejected'] } },
    }));
  });

  it('approve credits through the ledger and reconciles the proof', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findUnique.mockResolvedValueOnce(pendingProof);   // service read
    prisma.transaction.findUnique.mockResolvedValueOnce({                 // ledger read
      id: 'tx-1', status: 'Active', rentalFee: 5000, latePenalty: 0, damageFee: 0, totalPaid: 0, balance: 5000,
    });
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/payments/proofs/proof-1/approve')
      .set('Authorization', 'Bearer staff-token')
      .send({ amount: 200 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalPaid: 200, balance: 4800 });
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gateway: 'manual', gatewayRef: 'proof_proof-1', method: 'instapay', amount: 200 }),
    }));
    expect(prisma.paymentProof.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'proof-1', status: 'pending' },
      data: expect.objectContaining({ status: 'approved' }),
    }));
  });

  it('approve is idempotent (duplicate ledger result still reconciles)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findUnique.mockResolvedValueOnce(pendingProof);
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', status: 'Active', rentalFee: 5000, latePenalty: 0, damageFee: 0, totalPaid: 200, balance: 4800,
    });
    prisma.payment.findUnique.mockResolvedValueOnce({ id: 'pay-existing' }); // already credited
    const res = await request(app)
      .post('/api/payments/proofs/proof-1/approve')
      .set('Authorization', 'Bearer admin-token')
      .send({});
    expect(res.status).toBe(200);
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.paymentProof.updateMany).toHaveBeenCalled();
  });

  it('approve 400s an amount above the outstanding balance', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findUnique.mockResolvedValueOnce(pendingProof);
    const res = await request(app)
      .post('/api/payments/proofs/proof-1/approve')
      .set('Authorization', 'Bearer staff-token')
      .send({ amount: 999999 });
    expect(res.status).toBe(400);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('approve 409s a non-pending proof', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findUnique.mockResolvedValueOnce({ ...pendingProof, status: 'rejected' });
    const res = await request(app)
      .post('/api/payments/proofs/proof-1/approve')
      .set('Authorization', 'Bearer staff-token')
      .send({});
    expect(res.status).toBe(409);
  });

  it('reject stores the reason, notifies the customer, moves no money', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findUnique.mockResolvedValueOnce(pendingProof);
    const res = await request(app)
      .post('/api/payments/proofs/proof-1/reject')
      .set('Authorization', 'Bearer staff-token')
      .send({ reason: 'Screenshot is blurry' });
    expect(res.status).toBe(200);
    expect(prisma.paymentProof.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'rejected', rejectionReason: 'Screenshot is blurry' }),
    }));
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'payment_proof_rejected' }),
    }));
  });

  it('reject 400s a too-short reason (zod)', async () => {
    const res = await request(app)
      .post('/api/payments/proofs/proof-1/reject')
      .set('Authorization', 'Bearer staff-token')
      .send({ reason: 'no' });
    expect(res.status).toBe(400);
  });
});

describe('resubmit after reject', () => {
  it('accepts a fresh proof (201) and re-alerts staff', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { uploadFile } = await import('../src/services/storage.service.js');

    // 1) staff rejects the first proof.
    prisma.paymentProof.findUnique.mockResolvedValueOnce({
      id: 'proof-1', status: 'pending', amount: 200, reference: 'R1', channel: 'gcash-1',
      createdAt: new Date(), transaction: {
        id: 'tx-1', txNumber: 1001, status: 'Active', customerId: 'auth-customer-id',
        rentalFee: 5000, latePenalty: 0, damageFee: 0, totalPaid: 0, downpayment: 200,
        item: { name: 'Barong' },
      },
    });
    const reject = await request(app)
      .post('/api/payments/proofs/proof-1/reject')
      .set('Authorization', 'Bearer staff-token')
      .send({ reason: 'Screenshot is blurry' });
    expect(reject.status).toBe(200);

    // 2) the customer resubmits — the rejected proof must NOT block a new one
    // (only a still-pending proof should 409). The 201 also re-fires the direct
    // staff fan-out, bypassing notifyStaffMembers' dedupe.
    (uploadFile as any).mockResolvedValueOnce({ path: 'rental/tx-1/proof-2.webp', thumbPath: null, public: false });
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx });
    prisma.paymentProof.findFirst.mockResolvedValueOnce(null);
    prisma.profile.findMany.mockResolvedValueOnce([{ id: 'staff-1' }]);
    const resubmit = await request(app)
      .post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token')
      .send(proofBody);

    expect(resubmit.status).toBe(201);
    expect(resubmit.body.proof).toMatchObject({ status: 'pending' });
    expect(prisma.paymentProof.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ transactionId: 'tx-1', imagePath: 'rental/tx-1/proof-2.webp' }),
    }));
    expect(prisma.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({ profileId: 'staff-1', type: 'payment_proof' })]),
    }));
  });
});

describe('proof submit rate limit', () => {
  it('429s after 10 submissions in the window', async () => {
    // The route carries createRateLimiter(10, 1h) at customer.routes.ts:21.
    // tests/setup.ts clears every keyed store before each test, so the first
    // ten requests are allowed and the eleventh is blocked.
    const send = () => request(app)
      .post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token')
      .send(proofBody);

    for (let i = 0; i < 10; i++) {
      const res = await send();
      expect(res.status).not.toBe(429);
    }
    const blocked = await send();
    expect(blocked.status).toBe(429);
  });
});

describe('customer booking list carries the latest proof', () => {
  it('includes one paymentProof on the customer path', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/bookings').set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(200);
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ paymentProofs: expect.anything() }),
    }));
  });
});

describe('customer payment-proof history', () => {
  it('returns the signed-in customer\'s own proofs, newest first', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findMany.mockResolvedValueOnce([
      {
        id: 'proof-1', status: 'rejected', amount: 200, reference: 'GCASH-1', channel: 'gcash-1',
        imagePath: 'rental/tx-1/proof-1.webp', rejectionReason: 'Blurry screenshot',
        reviewedAt: new Date(), createdAt: new Date(),
        transaction: { id: 'tx-1', txNumber: 321, status: 'Reserved', item: { name: 'Scarlet Mermaid Terno' } },
      },
    ]);
    const res = await request(app).get('/api/bookings/payment-proofs').set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(200);
    expect(res.body.proofs).toHaveLength(1);
    expect(res.body.proofs[0]).toMatchObject({
      id: 'proof-1',
      status: 'rejected',
      rejectionReason: 'Blurry screenshot',
      transaction: { txNumber: 321, item: { name: 'Scarlet Mermaid Terno' } },
    });
    // Scoping is structural: the query filters by the session customer, never
    // by a client-supplied id.
    expect(prisma.paymentProof.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { transaction: { customerId: 'customer-id-111' } },
      orderBy: { createdAt: 'desc' },
    }));
  });

  it('403s staff (customer-only route)', async () => {
    const { prisma } = await import('../src/config/database.js');
    const res = await request(app).get('/api/bookings/payment-proofs').set('Authorization', 'Bearer staff-token');
    expect(res.status).toBe(403);
    expect(prisma.paymentProof.findMany).not.toHaveBeenCalled();
  });

  it('401s without a session', async () => {
    const res = await request(app).get('/api/bookings/payment-proofs');
    expect(res.status).toBe(401);
  });
});
