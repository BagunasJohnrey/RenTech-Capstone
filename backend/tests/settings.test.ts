import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { createRateLimiter, clearLocalStore } from '../src/middleware/rateLimiter.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

describe('GET /api/settings/rules', () => {
  it('should return business rules for admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([
      { id: '1', key: 'late_penalty_per_day', value: '500', description: 'Late penalty per day', updatedAt: new Date() },
      { id: '2', key: 'damage_fee', value: '1000', description: 'Flat damage fee', updatedAt: new Date() },
    ]);

    const res = await request(app)
      .get('/api/settings/rules')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ late_penalty_per_day: '500', damage_fee: '1000' });
  });

  it('should return rules for staff', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/settings/rules')
      .set('Authorization', 'Bearer staff-token');

    expect(res.status).toBe(200);
  });

  it('should reject when unauthenticated', async () => {
    const res = await request(app).get('/api/settings/rules');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/settings/rules', () => {
  it('should update rules for admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.upsert
      .mockResolvedValueOnce({ key: 'late_penalty_per_day', value: '600' })
      .mockResolvedValueOnce({ key: 'damage_fee', value: '1200' });

    const res = await request(app)
      .put('/api/settings/rules')
      .set('Authorization', 'Bearer admin-token')
      .send({ late_penalty_per_day: '600', damage_fee: '1200' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ late_penalty_per_day: '600', damage_fee: '1200' });
  });

  it('should reject for staff', async () => {
    const res = await request(app)
      .put('/api/settings/rules')
      .set('Authorization', 'Bearer staff-token')
      .send({ late_penalty_per_day: '600' });

    expect(res.status).toBe(403);
  });
});

describe('SMS templates CRUD', () => {
  it('should list templates', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.smsTemplate.findMany.mockResolvedValueOnce([
      { id: 't1', name: 'Due Reminder', content: 'Hello {customer}...', isDefault: true, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const res = await request(app)
      .get('/api/settings/sms-templates')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Due Reminder');
  });

  it('should create template', async () => {
    const res = await request(app)
      .post('/api/settings/sms-templates')
      .set('Authorization', 'Bearer admin-token')
      .send({ name: 'New Template', content: 'Hello {customer}, your {item} is ready!' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('New Template');
  });

  it('should update template', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.smsTemplate.findUnique.mockResolvedValueOnce({ id: 't1', name: 'Old', content: 'Old content', isDefault: false });

    const res = await request(app)
      .put('/api/settings/sms-templates/t1')
      .set('Authorization', 'Bearer admin-token')
      .send({ name: 'Updated', content: 'Updated content' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated');
  });

  it('should return 404 when updating non-existent template', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.smsTemplate.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .put('/api/settings/sms-templates/nonexistent')
      .set('Authorization', 'Bearer admin-token')
      .send({ name: 'Nope' });

    expect(res.status).toBe(404);
  });

  it('should delete template', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.smsTemplate.findUnique.mockResolvedValueOnce({ id: 't1', name: 'To Delete', content: 'x', isDefault: false });

    const res = await request(app)
      .delete('/api/settings/sms-templates/t1')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
  });

  it('should reject template CRUD for staff', async () => {
    const res = await request(app)
      .post('/api/settings/sms-templates')
      .set('Authorization', 'Bearer staff-token')
      .send({ name: 'Test', content: 'Test' });

    expect(res.status).toBe(403);
  });
});

describe('Messaging kill-switch flags', () => {
  it('default ON when no rule row exists', async () => {
    const { isSmsEnabled, isEmailEnabled } = await import('../src/services/settings.service.js');
    // setup.ts default: businessRule.findUnique resolves null (no row).
    await expect(isSmsEnabled()).resolves.toBe(true);
    await expect(isEmailEnabled()).resolves.toBe(true);
  });

  it('reads OFF when the rule is "false"', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { isSmsEnabled, isEmailEnabled } = await import('../src/services/settings.service.js');
    prisma.businessRule.findUnique.mockResolvedValueOnce({ key: 'messaging_sms_enabled', value: 'false' });
    await expect(isSmsEnabled()).resolves.toBe(false);
    prisma.businessRule.findUnique.mockResolvedValueOnce({ key: 'messaging_email_enabled', value: 'false' });
    await expect(isEmailEnabled()).resolves.toBe(false);
  });

  it('reads ON when the rule is "true"', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { isSmsEnabled, isEmailEnabled } = await import('../src/services/settings.service.js');
    prisma.businessRule.findUnique.mockResolvedValueOnce({ key: 'messaging_sms_enabled', value: 'true' });
    await expect(isSmsEnabled()).resolves.toBe(true);
    prisma.businessRule.findUnique.mockResolvedValueOnce({ key: 'messaging_email_enabled', value: 'true' });
    await expect(isEmailEnabled()).resolves.toBe(true);
  });

  it('persists the kill-switch through PUT /rules (admin, audited)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.upsert.mockResolvedValueOnce({ key: 'messaging_sms_enabled', value: 'false' });

    const res = await request(app)
      .put('/api/settings/rules')
      .set('Authorization', 'Bearer admin-token')
      .send({ messaging_sms_enabled: 'false' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messaging_sms_enabled: 'false' });
  });
});

describe('Rate limiter', () => {
  it('should allow requests within limit', () => {
    const limiter = createRateLimiter(5, 60_000);
    const req = { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } } as any;
    const next = vi.fn();

    for (let i = 0; i < 5; i++) {
      limiter(req, {} as any, next);
    }

    expect(next).toHaveBeenCalledTimes(5);
  });

  it('should block requests over limit', () => {
    const limiter = createRateLimiter(3, 60_000);
    const req = { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } } as any;
    const next = vi.fn();

    for (let i = 0; i < 3; i++) {
      limiter(req, {} as any, next);
    }

    expect(() => {
      limiter(req, {} as any, vi.fn());
    }).toThrow('Too many requests');
  });
});
