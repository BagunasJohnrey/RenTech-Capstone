import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  getPaymentGateway,
  getRentalDefaults,
  parseManualQrCodes,
  assertValidManualQrCodes,
} from '../src/services/settings.service.js';

const app = express();
app.use(express.json());
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
