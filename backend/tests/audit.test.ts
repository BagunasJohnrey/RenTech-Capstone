import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import ExcelJS from 'exceljs';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { prisma } from '../src/config/database.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

const log = (over: Record<string, unknown> = {}) => ({
  id: 'log-a',
  action: 'settings.rules.update',
  entity: 'business_rule',
  entityId: 'late_penalty_per_day',
  performedById: 'staff-id-456',
  oldValue: { value: '100' },
  newValue: { value: '150' },
  createdAt: new Date('2026-10-30T02:00:00Z'),
  ...over,
});

describe('GET /api/audit', () => {
  it('lists events newest first with the actor resolved', async () => {
    vi.mocked(prisma.auditLog.count).mockResolvedValueOnce(2);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([log(), log({ id: 'log-b', performedById: null })] as never);

    const res = await request(app).get('/api/audit?page=1&pageSize=10').set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.rows[0].actor).toMatchObject({ name: 'Staff User', role: 'Staff' });
    expect(res.body.rows[1].actor).toBeNull(); // system / scheduler
    const args = vi.mocked(prisma.auditLog.findMany).mock.calls.at(-1)![0] as { orderBy: unknown; take: number };
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.take).toBe(10);
  });

  it('turns Manila-day date filters into a [from, to+1) window and ignores blank filters', async () => {
    await request(app).get('/api/audit?from=2026-10-01&to=2026-10-31&action=&actorId=system')
      .set('Authorization', 'Bearer admin-token');
    const where = (vi.mocked(prisma.auditLog.count).mock.calls.at(-1)![0] as { where: Record<string, any> }).where;
    expect(where.createdAt.gte.toISOString()).toBe('2026-09-30T16:00:00.000Z');
    expect(where.createdAt.lt.toISOString()).toBe('2026-10-31T16:00:00.000Z');
    expect(where.performedById).toBeNull();
    expect(where.action).toBeUndefined();
  });

  it('rejects a reversed date range', async () => {
    const res = await request(app).get('/api/audit?from=2026-10-31&to=2026-10-01').set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(400);
  });

  it('is admin-only', async () => {
    const res = await request(app).get('/api/audit').set('Authorization', 'Bearer staff-token');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/audit/export', () => {
  it('downloads a branded workbook and audits the download', async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([log()] as never);

    const res = await request(app).get('/api/audit/export').set('Authorization', 'Bearer admin-token')
      .buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.getWorksheet('Audit Trail')!;
    expect(String(ws.getCell('B1').value)).toContain('Audit Trail');
    expect(String(ws.getCell('B4').value)).toContain('Exported by');
    expect(ws.getCell('B6').value).toBe('Staff User');
    expect(ws.getCell('D6').value).toBe('settings.rules.update');
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'export.download', entityId: 'audit-trail' }),
    }));
  });
});
