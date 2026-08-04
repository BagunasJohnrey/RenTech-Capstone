import { describe, it, expect, vi } from 'vitest';
import { purgeOldData, orphanedImageDryRun } from '../src/services/retention.service.js';

describe('retention purge (Phase 4.3)', () => {
  it('purges rows older than the retention window, keeps younger ones', async () => {
    const { prisma } = await import('../src/config/database.js');
    (prisma.notification.deleteMany as any).mockResolvedValueOnce({ count: 4 });
    (prisma.sentSms.deleteMany as any).mockResolvedValueOnce({ count: 2 });
    (prisma.auditLog.deleteMany as any).mockResolvedValueOnce({ count: 7 });
    (prisma.businessRule.findMany as any).mockResolvedValueOnce([{ key: 'data_retention_months', value: '6' }]);

    const now = new Date('2026-08-05T12:00:00Z');
    const result = await purgeOldData(now);

    expect(result.notifications).toBe(4);
    expect(result.sentSms).toBe(2);
    expect(result.auditLogs).toBe(7);
    expect(result.retentionMonths).toBe(6);

    for (const mock of [prisma.notification.deleteMany, prisma.sentSms.deleteMany, prisma.auditLog.deleteMany]) {
      expect(mock).toHaveBeenCalledTimes(1);
      const arg = (mock as any).mock.calls[0][0];
      expect(Object.keys(arg.where)).toEqual(['createdAt']);
      expect(arg.where.createdAt.lt < now).toBe(true);
    }

    // 6 months before 2026-08-05 => 2026-02-05
    const cut = (prisma.notification.deleteMany as any).mock.calls[0][0].where.createdAt.lt as Date;
    expect(cut.getUTCFullYear()).toBe(2026);
    expect(cut.getUTCMonth()).toBe(1); // February (0-based)
    expect(cut.getUTCDate()).toBe(5);
  });

  it('falls back to the 12-month default when no rule exists (tolerates missing rules)', async () => {
    const { prisma } = await import('../src/config/database.js');
    (prisma.notification.deleteMany as any).mockResolvedValueOnce({ count: 0 });
    (prisma.sentSms.deleteMany as any).mockResolvedValueOnce({ count: 0 });
    (prisma.auditLog.deleteMany as any).mockResolvedValueOnce({ count: 0 });

    const result = await purgeOldData(new Date('2026-08-05T12:00:00Z'));

    expect(result.retentionMonths).toBe(12);
    const cut = (prisma.notification.deleteMany as any).mock.calls[0][0].where.createdAt.lt as Date;
    expect(cut.getUTCFullYear()).toBe(2025);
    expect(cut.getUTCMonth()).toBe(7); // August 2025
  });

  it('ignores malformed rule values (still purges with the default window)', async () => {
    const { prisma } = await import('../src/config/database.js');
    (prisma.notification.deleteMany as any).mockResolvedValueOnce({ count: 1 });
    (prisma.sentSms.deleteMany as any).mockResolvedValueOnce({ count: 0 });
    (prisma.auditLog.deleteMany as any).mockResolvedValueOnce({ count: 0 });
    (prisma.businessRule.findMany as any).mockResolvedValueOnce([
      { key: 'data_retention_months', value: 'banana' },
      { key: 'data_retention_months', value: '-4' },
    ]);

    const result = await purgeOldData(new Date('2026-08-05T12:00:00Z'));
    expect(result.retentionMonths).toBe(12);
    expect(result.notifications + result.sentSms + result.auditLogs).toBe(1);
  });

  it('returns the purged counts so the scheduler can log them', async () => {
    const { prisma } = await import('../src/config/database.js');
    (prisma.notification.deleteMany as any).mockResolvedValueOnce({ count: 10 });
    (prisma.sentSms.deleteMany as any).mockResolvedValueOnce({ count: 20 });
    (prisma.auditLog.deleteMany as any).mockResolvedValueOnce({ count: 30 });

    const result = await purgeOldData();
    expect(result).toMatchObject({ notifications: 10, sentSms: 20, auditLogs: 30 });
    expect(result.cutoff).toBeInstanceOf(Date);
  });
});

describe('orphaned image dry-run (Phase 4.3)', () => {
  it('flags items whose latest transaction is older than the retention window', async () => {
    const { prisma } = await import('../src/config/database.js');
    (prisma.inventoryItem.findMany as any).mockResolvedValueOnce([
      { id: 1, name: 'Old Gown', image: 'items/1.jpg', updatedAt: new Date('2024-01-01') },
    ]);

    const result = await orphanedImageDryRun(new Date('2026-08-05T12:00:00Z'));

    expect(prisma.inventoryItem.findMany).toHaveBeenCalledTimes(1);
    const arg = (prisma.inventoryItem.findMany as any).mock.calls[0][0];
    expect(arg.where.image).toEqual({ not: null });
    expect(Array.isArray(arg.where.OR)).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].image).toBe('items/1.jpg');
  });
});
