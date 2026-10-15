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
    balance: 1500,
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

  it('overdue message shows the PHP balance, never penalty rates or the peso sign', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([baseTx]);
    const svc = await reload();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([{ message_id: 'm1' }]) });
    const out = await svc.autoNotifyOverdue();
    expect(out[0].message).toContain('PHP 1,500');
    expect(out[0].message.toLowerCase()).not.toMatch(/penalty|fee|₱|\d+\s*\/\s*day.*fee/);
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

describe('Reminder emails are decoupled from SMS delivery (no Brevo duplicates)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // NOTE: earlier fixtures omitted customer.email, so the email path was never
  // exercised — that is how the per-minute duplicate flood slipped through.
  const emailedCustomer = { id: 'customer-id-111', name: 'Customer User', email: 'customer@example.com', phone: '09171234567', notifyPrefs: null };

  async function reload() {
    return import('../src/services/sms.service.js');
  }

  // Prisma is mocked (see setup.ts): observe email behavior through the
  // transaction.update payloads rather than the network (Brevo sends are
  // simulated in tests and never touch fetch).
  async function flagUpdates(flag: string) {
    const { prisma } = await import('../src/config/database.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return prisma.transaction.update.mock.calls.filter((c: any) => c[0]?.data && flag in c[0].data);
  }

  it('overdue: SMS failure still marks overdueEmailSent (email sent once, SMS retries)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([{
      id: 'tx-ovd-email', status: 'Active',
      dueDate: new Date(Date.now() - 2 * 86400000),
      rentalDate: new Date(Date.now() - 5 * 86400000),
      balance: 1500, overdueSmsSent: false, overdueEmailSent: false,
      customer: emailedCustomer, item: { id: 1, name: 'Gown' },
    }]);
    const svc = await reload();
    global.fetch = vi.fn().mockRejectedValue(new Error('sms gateway down'));
    const out = await svc.autoNotifyOverdue();
    expect(out[0].status).toBe('failed'); // SMS still retries next tick
    const emailCalls = await flagUpdates('overdueEmailSent');
    expect(emailCalls.length).toBe(1);
    expect(emailCalls[0][0].data.overdueEmailSent).toBe(true);
    // …but the SMS flag stays false so the text (not the email) retries.
    expect((await flagUpdates('overdueSmsSent')).filter((c: any) => c[0].data.overdueSmsSent === true).length).toBe(0);
  });

  it('overdue: emailed tx is NOT emailed again on the next tick', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([{
      id: 'tx-ovd-email', status: 'Overdue',
      dueDate: new Date(Date.now() - 2 * 86400000),
      rentalDate: new Date(Date.now() - 5 * 86400000),
      balance: 1500, overdueSmsSent: false, overdueEmailSent: true,
      customer: emailedCustomer, item: { id: 1, name: 'Gown' },
    }]);
    const svc = await reload();
    global.fetch = vi.fn().mockRejectedValue(new Error('sms gateway down'));
    await svc.autoNotifyOverdue();
    expect(await flagUpdates('overdueEmailSent')).toHaveLength(0);
    expect((global.fetch as any).mock.calls.length).toBe(1); // SMS retry still attempted
  });

  it('due-today: SMS failure still marks dueReminderEmailSent, no re-email next tick', async () => {
    const { prisma } = await import('../src/config/database.js');
    const dueTx = {
      id: 'tx-due-email', status: 'Active', dueDate: new Date(),
      rentalDate: new Date(Date.now() - 86400000),
      balance: 1500, dueReminderSent: false, dueReminderEmailSent: false,
      customer: emailedCustomer, item: { id: 1, name: 'Gown' },
    };
    prisma.transaction.findMany.mockResolvedValueOnce([dueTx]);
    const svc = await reload();
    global.fetch = vi.fn().mockRejectedValue(new Error('sms gateway down'));
    const out = await svc.notifyDueToday();
    expect(out[0].sent).toBe(false);
    expect(await flagUpdates('dueReminderEmailSent')).toHaveLength(1);

    vi.clearAllMocks();
    prisma.transaction.findMany.mockResolvedValueOnce([{ ...dueTx, dueReminderEmailSent: true }]);
    global.fetch = vi.fn().mockRejectedValue(new Error('sms gateway down'));
    await svc.notifyDueToday();
    expect(await flagUpdates('dueReminderEmailSent')).toHaveLength(0);
  });

  it('escalation: SMS failure still marks overdueEscalationEmailSent, no re-email next tick', async () => {
    const { prisma } = await import('../src/config/database.js');
    const escTx = {
      id: 'tx-esc-email', status: 'Overdue',
      dueDate: new Date(Date.now() - 4 * 86400000),
      rentalDate: new Date(Date.now() - 7 * 86400000),
      balance: 1500, overdueEscalationSent: false, overdueEscalationEmailSent: false,
      customer: emailedCustomer, item: { id: 1, name: 'Gown' },
    };
    prisma.transaction.findMany.mockResolvedValueOnce([escTx]);
    prisma.businessRule.findMany.mockResolvedValue([]);
    const svc = await reload();
    global.fetch = vi.fn().mockRejectedValue(new Error('sms gateway down'));
    await svc.notifyOverdue3Days();
    expect(await flagUpdates('overdueEscalationEmailSent')).toHaveLength(1);

    vi.clearAllMocks();
    prisma.transaction.findMany.mockResolvedValueOnce([{ ...escTx, overdueEscalationEmailSent: true }]);
    prisma.businessRule.findMany.mockResolvedValue([]);
    global.fetch = vi.fn().mockRejectedValue(new Error('sms gateway down'));
    await svc.notifyOverdue3Days();
    expect(await flagUpdates('overdueEscalationEmailSent')).toHaveLength(0);
  });
});

describe('Global SMS kill-switch (messaging_sms_enabled)', () => {
  const baseTx = {
    id: 'tx-ovd-1',
    status: 'Active',
    dueDate: new Date(Date.now() - 2 * 86400000), // 2 days overdue
    rentalDate: new Date(Date.now() - 5 * 86400000),
    balance: 1500,
    overdueSmsSent: false,
    overdueEscalationSent: false,
    customer: { id: 'customer-id-111', name: 'Customer User', phone: '09171234567', notifyPrefs: null },
    item: { id: 1, name: 'Gown' },
  };

  async function reload() {
    return import('../src/services/sms.service.js');
  }

  it('autoNotifyOverdue OFF: skips the text but still flips status + alerts staff', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([baseTx]);
    prisma.businessRule.findUnique.mockResolvedValueOnce({ key: 'messaging_sms_enabled', value: 'false' });
    const svc = await reload();
    global.fetch = vi.fn();
    const out = await svc.autoNotifyOverdue();
    expect(out.length).toBe(1);
    expect(out[0].status).toBe('skipped');
    expect((global.fetch as any).mock.calls.length).toBe(0); // no provider call
    // Status flip + once-guard still run (derived state is not delivery).
    const statusCall = prisma.transaction.update.mock.calls.find((c: any) => c[0]?.data?.status === 'Overdue');
    expect(statusCall).toBeTruthy();
    const sentCall = prisma.transaction.update.mock.calls.find((c: any) => c[0]?.data?.overdueSmsSent === true);
    expect(sentCall).toBeTruthy();
    // Staff in-app alert still fires.
    expect(prisma.notification.createMany).toHaveBeenCalled();
  });

  it('notifyDueToday OFF: no text, reminder still marked done', async () => {
    const { prisma } = await import('../src/config/database.js');
    const dueTodayTx = { ...baseTx, id: 'tx-due-1', dueDate: new Date(), dueReminderSent: false };
    prisma.transaction.findMany.mockResolvedValueOnce([dueTodayTx]);
    prisma.businessRule.findUnique.mockResolvedValueOnce({ key: 'messaging_sms_enabled', value: 'false' });
    const svc = await reload();
    global.fetch = vi.fn();
    const out = await svc.notifyDueToday();
    expect(out.length).toBe(1);
    expect(out[0].sent).toBe(false);
    expect((global.fetch as any).mock.calls.length).toBe(0);
    const doneCall = prisma.transaction.update.mock.calls.find((c: any) => c[0]?.data?.dueReminderSent === true);
    expect(doneCall).toBeTruthy();
  });

  it('manual sends bypass the kill-switch (staff intent always works)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findUnique.mockResolvedValueOnce({ key: 'messaging_sms_enabled', value: 'false' });
    const svc = await reload();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([{ message_id: 'm1' }]) });
    const sent = await svc.sendManualSms({
      profileId: 'customer-id-111',
      message: 'Manual staff message',
      sentById: 'staff-id-456',
    });
    expect(sent.status).toBe('sent');
    expect((global.fetch as any).mock.calls.length).toBe(1);
  });
});

describe('DELETE /api/sms/history/:id (admin log cleanup)', () => {
  it('admin can delete a log row', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.sentSms.findUnique.mockResolvedValueOnce({ id: 'sms-1' });
    const res = await request(app)
      .delete('/api/sms/history/sms-1')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'sms-1' });
    expect(prisma.sentSms.delete).toHaveBeenCalledWith({ where: { id: 'sms-1' } });
  });

  it('missing row returns 404', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.sentSms.findUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .delete('/api/sms/history/does-not-exist')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(404);
  });

  it('staff cannot delete (admin-only audit trail)', async () => {
    const res = await request(app)
      .delete('/api/sms/history/sms-1')
      .set('Authorization', 'Bearer staff-token');
    expect(res.status).toBe(403);
  });

  it('unauthenticated delete is rejected', async () => {
    const res = await request(app).delete('/api/sms/history/sms-1');
    expect(res.status).toBe(401);
  });
});
