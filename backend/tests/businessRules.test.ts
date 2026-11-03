import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { prisma } from '../src/config/database.js';
import { numberRule, reminderWindowFrom, assertValidRuleValues } from '../src/services/settings.service.js';
import { isReminderQuietHours } from '../src/utils/manilaDay.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

describe('numeric business rules', () => {
  it('falls back to the default for missing/garbage values and clamps to range', () => {
    expect(numberRule({}, 'cleaning_buffer_days')).toBe(1);
    expect(numberRule({ cleaning_buffer_days: 'abc' }, 'cleaning_buffer_days')).toBe(1);
    expect(numberRule({ cleaning_buffer_days: '3' }, 'cleaning_buffer_days')).toBe(3);
    expect(numberRule({ cleaning_buffer_days: '99' }, 'cleaning_buffer_days')).toBe(7);
  });

  it('rejects out-of-range values and an inverted reminder window', () => {
    expect(() => assertValidRuleValues({ no_show_after_days: '0' })).toThrow(/between 1 and 14/);
    expect(() => assertValidRuleValues({ damage_fee: 'lots' })).toThrow(/must be a number/);
    expect(() => assertValidRuleValues({ reminder_send_start_hour: '22' }, { reminder_send_end_hour: '21' })).toThrow(/earlier than/);
    expect(() => assertValidRuleValues({ reminder_send_start_hour: '7', reminder_send_end_hour: '20', business_name: 'x' })).not.toThrow();
  });

  it('applies the configured reminder window to quiet hours', () => {
    const win = reminderWindowFrom({ reminder_send_start_hour: '10', reminder_send_end_hour: '18' });
    expect(win).toEqual({ startHour: 10, endHour: 18 });
    expect(isReminderQuietHours(new Date('2026-10-30T01:30:00Z'), win)).toBe(true);  // 09:30 Manila
    expect(isReminderQuietHours(new Date('2026-10-30T02:00:00Z'), win)).toBe(false); // 10:00
    expect(isReminderQuietHours(new Date('2026-10-30T10:00:00Z'), win)).toBe(true);  // 18:00
    // A bad stored window falls back to 08:00–21:00.
    expect(reminderWindowFrom({ reminder_send_start_hour: '20', reminder_send_end_hour: '9' })).toEqual({ startHour: 8, endHour: 21 });
  });
});

describe('PUT /api/settings/rules', () => {
  it('400s an out-of-range value without saving', async () => {
    const res = await request(app).put('/api/settings/rules')
      .set('Authorization', 'Bearer admin-token')
      .send({ cleaning_buffer_days: '30' });
    expect(res.status).toBe(400);
    expect(vi.mocked(prisma.businessRule.upsert)).not.toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'cleaning_buffer_days' } }));
  });

  it('audits only the changed keys with before and after values', async () => {
    vi.mocked(prisma.businessRule.findMany).mockResolvedValueOnce([
      { key: 'damage_fee', value: '1000' },
      { key: 'rental_period_days', value: '3' },
    ] as never);
    vi.mocked(prisma.auditLog.create).mockClear();

    const res = await request(app).put('/api/settings/rules')
      .set('Authorization', 'Bearer admin-token')
      .send({ damage_fee: '1500', rental_period_days: '3' });

    expect(res.status).toBe(200);
    const call = vi.mocked(prisma.auditLog.create).mock.calls.find((c) => (c[0] as any).data.action === 'settings.rules.update');
    expect((call![0] as any).data.oldValue).toEqual({ damage_fee: '1000' });
    expect((call![0] as any).data.newValue).toEqual({ damage_fee: '1500' });
  });
});

describe('getBusinessRules cache (egress)', () => {
  it('serves repeat reads from memory and refreshes after an update', async () => {
    const { prisma } = await import('../src/config/database.js');
    const settings = await import('../src/services/settings.service.js');
    settings.clearBusinessRulesCache();
    vi.mocked(prisma.businessRule.findMany).mockResolvedValue([{ key: 'k', value: '1' }] as never);
    const a = await settings.getBusinessRules();
    const b = await settings.getBusinessRules();
    expect(a.k).toBe('1');
    expect(b.k).toBe('1');
    expect(vi.mocked(prisma.businessRule.findMany)).toHaveBeenCalledTimes(1);

    vi.mocked(prisma.businessRule.upsert).mockResolvedValue({ key: 'k', value: '2' } as never);
    await settings.updateBusinessRules({ k: '2' });
    vi.mocked(prisma.businessRule.findMany).mockResolvedValue([{ key: 'k', value: '2' }] as never);
    expect((await settings.getBusinessRules()).k).toBe('2');
    expect(vi.mocked(prisma.businessRule.findMany)).toHaveBeenCalledTimes(2);
  });
});
