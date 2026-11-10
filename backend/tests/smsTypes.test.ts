import { describe, it, expect, vi, beforeEach } from 'vitest';

// Per-type automatic SMS toggles (Settings → Notifications → Customer SMS).
vi.mock('../src/services/semaphore.service.js', async (orig) => {
  const actual = await orig<typeof import('../src/services/semaphore.service.js')>();
  return { ...actual, sendSms: vi.fn().mockResolvedValue({ messageId: 'm-1' }) };
});

const { smsTypeEnabledFrom, assertValidRuleValues } = await import('../src/services/settings.service.js');
const { sendPaymentReceivedSms } = await import('../src/services/sms.service.js');
const { sendSms } = await import('../src/services/semaphore.service.js');
const { prisma } = await import('../src/config/database.js');

const TX = {
  id: 'tx-1', customerId: 'cust-1', balance: 3800,
  item: { name: 'Ivory Embroidered Terno' },
  customer: { name: 'Iverene Causapin', phone: '09616015914', notifyPrefs: null },
};

describe('smsTypeEnabledFrom', () => {
  it('keeps existing texts on and the new payment text off by default', () => {
    expect(smsTypeEnabledFrom({}, 'booking')).toBe(true);
    expect(smsTypeEnabledFrom({}, 'due_reminder')).toBe(true);
    expect(smsTypeEnabledFrom({}, 'overdue')).toBe(true);
    expect(smsTypeEnabledFrom({}, 'payment')).toBe(false);
  });

  it('follows the saved rule', () => {
    expect(smsTypeEnabledFrom({ sms_type_booking_enabled: 'false' }, 'booking')).toBe(false);
    expect(smsTypeEnabledFrom({ sms_type_payment_enabled: 'true' }, 'payment')).toBe(true);
  });

  it('rejects non-boolean values on save', () => {
    expect(() => assertValidRuleValues({ sms_type_booking_enabled: 'maybe' })).toThrow(/true' or 'false/);
    expect(() => assertValidRuleValues({ sms_type_booking_enabled: 'false' })).not.toThrow();
  });
});

describe('sendPaymentReceivedSms', () => {
  beforeEach(() => {
    (sendSms as any).mockClear();
    (prisma.sentSms.create as any).mockClear();
  });

  it('sends nothing while the payment SMS is off (default)', async () => {
    await sendPaymentReceivedSms('tx-1', 200);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('texts the amount and remaining balance once enabled, and logs it', async () => {
    (prisma.businessRule.findMany as any).mockResolvedValueOnce([{ key: 'sms_type_payment_enabled', value: 'true' }]);
    (prisma.transaction.findUnique as any).mockResolvedValueOnce(TX);

    await sendPaymentReceivedSms('tx-1', 200);

    expect(sendSms).toHaveBeenCalledTimes(1);
    const [phone, message] = (sendSms as any).mock.calls[0];
    expect(phone).toBe('09616015914');
    expect(message).toContain('PHP 200');
    expect(message).toContain('Balance: PHP 3,800');
    expect(message).not.toContain('₱');
    expect(prisma.sentSms.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ transactionId: 'tx-1', status: 'sent' }),
    }));
  });

  it('respects the customer opt-out', async () => {
    (prisma.businessRule.findMany as any).mockResolvedValueOnce([{ key: 'sms_type_payment_enabled', value: 'true' }]);
    (prisma.transaction.findUnique as any).mockResolvedValueOnce({
      ...TX, customer: { ...TX.customer, notifyPrefs: { payment: false } },
    });
    await sendPaymentReceivedSms('tx-1', 200);
    expect(sendSms).not.toHaveBeenCalled();
  });
});
