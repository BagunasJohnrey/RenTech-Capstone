import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

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