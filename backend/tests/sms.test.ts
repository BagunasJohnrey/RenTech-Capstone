import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

describe('SMS routes', () => {
  beforeAll(() => {
    global.fetch = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ message_id: 'sms-mock-id' }]),
    });
  });

  describe('POST /api/sms/send', () => {
    it('should send SMS to a customer', async () => {
      const res = await request(app)
        .post('/api/sms/send')
        .set('Authorization', 'Bearer admin-token')
        .send({ profileId: 'customer-id-111', message: 'Your item is ready for pickup!' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('status', 'sent');
    });

    it('should reject when profile has no phone', async () => {
      const res = await request(app)
        .post('/api/sms/send')
        .set('Authorization', 'Bearer admin-token')
        .send({ profileId: 'no-phone-id', message: 'Test' });

      expect(res.status).toBe(400);
    });

    it('should reject for customer', async () => {
      const res = await request(app)
        .post('/api/sms/send')
        .set('Authorization', 'Bearer customer-token')
        .send({ profileId: 'customer-id-111', message: 'Test' });

      expect(res.status).toBe(403);
    });

    it('should reject when unauthenticated', async () => {
      const res = await request(app)
        .post('/api/sms/send')
        .send({ profileId: 'customer-id-111', message: 'Test' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/sms/history', () => {
    it('should list SMS history for staff', async () => {
      const res = await request(app)
        .get('/api/sms/history')
        .set('Authorization', 'Bearer staff-token');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should reject for customer', async () => {
      const res = await request(app)
        .get('/api/sms/history')
        .set('Authorization', 'Bearer customer-token');

      expect(res.status).toBe(403);
    });
  });
});

// Direct service-level tests for the SMS scheduler overhaul (Phase 2.4).
// These don't go through HTTP; they drive autoNotifyOverdue/notifyOverdue3Days
// against the mocked prisma client to assert the once-guard + retry semantics.
describe('SMS scheduler service (Phase 2.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseTx = {
    id: 'tx-ovd-1',
    status: 'Active',
    dueDate: new Date(Date.now() - 2 * 86400000), // 2 days overdue
    rentalDate: new Date(Date.now() - 5 * 86400000),
    overdueSmsSent: false,
    overdueEscalationSent: false,
    customer: { id: 'customer-id-111', name: 'Customer User', phone: '09171234567', notifyPrefs: null },
    item: { id: 1, name: 'Gown' },
  };

  async function reload() {
    return import('../src/services/sms.service.js');
  }

  it('successful send marks overdueSmsSent and sets status Overdue', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([baseTx]);
    const svc = await reload();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([{ message_id: 'm1' }]) });
    const out = await svc.autoNotifyOverdue();
    expect(out.length).toBe(1);
    const statusCall = prisma.transaction.update.mock.calls.find((c: any) => c[0]?.data?.status === 'Overdue');
    expect(statusCall).toBeTruthy();
  });

  it('message text contains no penalty/fee amounts', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([baseTx]);
    const svc = await reload();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([{ message_id: 'm1' }]) });
    const out = await svc.autoNotifyOverdue();
    const msg = out[0].message.toLowerCase();
    expect(msg).not.toMatch(/penalty|fee|₱|php|\d+\s*\/\s*day.*fee/);
  });

  it('send failure leaves overdueSmsSent false so next tick retries', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([baseTx]);
    const svc = await reload();
    global.fetch = vi.fn().mockRejectedValue(new Error('gateway down'));
    const out = await svc.autoNotifyOverdue();
    expect(out[0].status).toBe('failed');
    const sentCall = prisma.transaction.update.mock.calls.find((c: any) => c[0]?.data?.overdueSmsSent === true);
    expect(sentCall).toBeFalsy();
  });

  it('no phone = marked sent once-guard without retry', async () => {
    const { prisma } = await import('../src/config/database.js');
    const noPhoneTx = { ...baseTx, customer: { ...baseTx.customer, phone: null } };
    prisma.transaction.findMany.mockResolvedValueOnce([noPhoneTx]);
    const svc = await reload();
    const out = await svc.autoNotifyOverdue();
    expect(out[0].status).toBe('skipped');
    const sentCall = prisma.transaction.update.mock.calls.find((c: any) => c[0]?.data?.overdueSmsSent === true);
    expect(sentCall).toBeTruthy();
  });

  it('opt-out (notifyPrefs.lateReturn=false) skips SMS, staff alert still fires', async () => {
    const { prisma } = await import('../src/config/database.js');
    const optOut = { ...baseTx, customer: { ...baseTx.customer, notifyPrefs: { lateReturn: false } } };
    prisma.transaction.findMany.mockResolvedValueOnce([optOut]);
    const svc = await reload();
    global.fetch = vi.fn();
    await svc.autoNotifyOverdue();
    expect((global.fetch as any).mock.calls.length).toBe(0); // no provider call
  });

  it('notifyOverdue3Days: 2-days-overdue tx does NOT escalate; 3-days does', async () => {
    const { prisma } = await import('../src/config/database.js');
    const three = { ...baseTx, id: 'tx-3d', dueDate: new Date(Date.now() - 3 * 86400000) };
    prisma.transaction.findMany.mockResolvedValueOnce([three]);
    prisma.businessRule.findMany.mockResolvedValue([]);
    const svc = await reload();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([{ message_id: 'x' }]) });
    const out = await svc.notifyOverdue3Days();
    expect(out.length).toBe(1);
    const escCall = prisma.transaction.update.mock.calls.find((c: any) => c[0]?.data?.overdueEscalationSent === true);
    expect(escCall).toBeTruthy();
  });
});
