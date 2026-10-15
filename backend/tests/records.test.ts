import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import ExcelJS from 'exceljs';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

// Historical records import (logbook history for the demand forecast).
// Service-level parsing/validation + HTTP route gating. Prisma is mocked
// (see setup.ts); the forecast-union behavior is covered by the dashboard
// suite's mocked-history cases.
describe('Historical records import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function svc() {
    return import('../src/services/historicalRecords.service.js');
  }

  const CSV_OK =
    'name,category,address,event_date,price\n' +
    'Maria Santos,Gown,"Balayan, Batangas",2024-12-15,2500\n' +
    ',Barong,Calatagan Batangas,2024-12-20,"PHP 1,200"\n';

  it('parses a valid CSV and imports all rows', async () => {
    const { prisma } = await import('../src/config/database.js');
    const s = await svc();
    const out = await s.importRecords({
      fileName: 'logbook.csv',
      buffer: Buffer.from(CSV_OK, 'utf-8'),
      importedById: 'staff-id-456',
    });
    expect(out.imported).toBe(2);
    expect(out.categories).toEqual(['Barong', 'Gown']);
    expect(prisma.historicalRecord.createMany).toHaveBeenCalledOnce();
    const data = prisma.historicalRecord.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({ customerName: 'Maria Santos', category: 'Gown', price: 2500 });
    expect(data[0].eventDate).toBeInstanceOf(Date);
    expect(data[1]).toMatchObject({ customerName: null, category: 'Barong', price: 1200 });
  });

  it('parses a valid .xlsx file (same columns, Excel date cell)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('logbook');
    ws.addRow(['name', 'category', 'address', 'event_date', 'price']);
    ws.addRow(['Juan', 'Suit', 'Taal Batangas', new Date(2024, 11, 10), 1800]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const s = await svc();
    const out = await s.importRecords({ fileName: 'logbook.xlsx', buffer, importedById: 'staff-id-456' });
    expect(out.imported).toBe(1);
    expect(out.categories).toEqual(['Suit']);
  });

  it('rejects bad rows all-or-nothing with row numbers (nothing saved)', async () => {
    const { prisma } = await import('../src/config/database.js');
    const s = await svc();
    const bad =
      'name,category,address,event_date,price\n' +
      'Maria,Gown,Balayan,2024-12-15,2500\n' +
      'Juan,,Taal,not-a-date,abc\n';
    await expect(s.importRecords({
      fileName: 'logbook.csv', buffer: Buffer.from(bad, 'utf-8'), importedById: 'staff-id-456',
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.historicalRecord.createMany).not.toHaveBeenCalled();
    try {
      await s.importRecords({
        fileName: 'logbook.csv', buffer: Buffer.from(bad, 'utf-8'), importedById: 'staff-id-456',
      });
      expect.unreachable();
    } catch (err: any) {
      expect(err.details.errors).toHaveLength(1);
      expect(err.details.errors[0].row).toBe(3);
      expect(err.details.errors[0].message).toMatch(/category|date|price/);
    }
  });

  it('rejects wrong extension, empty files, and missing columns', async () => {
    const s = await svc();
    await expect(s.importRecords({
      fileName: 'logbook.pdf', buffer: Buffer.from('x'), importedById: 'staff-id-456',
    })).rejects.toMatchObject({ statusCode: 400 });
    await expect(s.importRecords({
      fileName: 'logbook.csv', buffer: Buffer.from(''), importedById: 'staff-id-456',
    })).rejects.toMatchObject({ statusCode: 400 });
    await expect(s.importRecords({
      fileName: 'logbook.csv',
      buffer: Buffer.from('name,category\nMaria,Gown\n', 'utf-8'),
      importedById: 'staff-id-456',
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('splitCsvLine handles quoted commas and escaped quotes', async () => {
    const s = await svc();
    expect(s.splitCsvLine('a,"Balayan, Batangas",c')).toEqual(['a', 'Balayan, Batangas', 'c']);
    expect(s.splitCsvLine('"say ""hi""",b')).toEqual(['say "hi"', 'b']);
  });

  it('parsePrice accepts peso formats, rejects negatives', async () => {
    const s = await svc();
    expect(s.parsePrice('PHP 1,500')).toBe(1500);
    expect(s.parsePrice('₱1500')).toBe(1500);
    expect(s.parsePrice(200)).toBe(200);
    expect(s.parsePrice('-5')).toBeNull();
    expect(s.parsePrice('abc')).toBeNull();
  });
});

describe('POST /api/records/import (routes)', () => {
  const body = (csv: string, fileName = 'logbook.csv') => ({
    fileName,
    data: Buffer.from(csv, 'utf-8').toString('base64'),
  });

  const CSV_OK = 'name,category,address,event_date,price\nMaria,Gown,Balayan,2024-12-15,2500\n';

  it('staff can import (201 with counts)', async () => {
    const res = await request(app)
      .post('/api/records/import')
      .set('Authorization', 'Bearer staff-token')
      .send(body(CSV_OK));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ imported: 1, categories: ['Gown'] });
  });

  it('admin can import', async () => {
    const res = await request(app)
      .post('/api/records/import')
      .set('Authorization', 'Bearer admin-token')
      .send(body(CSV_OK));
    expect(res.status).toBe(201);
  });

  it('customer is refused (403), anonymous is refused (401)', async () => {
    const asCustomer = await request(app)
      .post('/api/records/import')
      .set('Authorization', 'Bearer customer-token')
      .send(body(CSV_OK));
    expect(asCustomer.status).toBe(403);
    const anon = await request(app).post('/api/records/import').send(body(CSV_OK));
    expect(anon.status).toBe(401);
  });

  it('bad rows return 400 WITH the row errors (every env, not dev-only)', async () => {
    const res = await request(app)
      .post('/api/records/import')
      .set('Authorization', 'Bearer staff-token')
      .send(body('name,category,address,event_date,price\nJuan,,Taal,blah,xyz\n'));
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors[0].row).toBe(2);
  });

  it('list + stats + delete flow', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.historicalRecord.findMany.mockResolvedValueOnce([{
      id: 'rec-1', customerName: 'Maria', category: 'Gown', address: 'Balayan',
      eventDate: new Date('2024-12-15'), price: 2500,
    }]);
    prisma.historicalRecord.count.mockResolvedValueOnce(1);
    const list = await request(app).get('/api/records?limit=10').set('Authorization', 'Bearer staff-token');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);

    prisma.historicalRecord.findUnique.mockResolvedValueOnce({ id: 'rec-1' });
    const del = await request(app).delete('/api/records/rec-1').set('Authorization', 'Bearer staff-token');
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ id: 'rec-1' });
  });
});

// Logbook companions on the BI endpoints: ledger figures stay pure, history
// rides alongside as separately-labeled fields.
describe('Logbook companions (KPIs, insights, analytics, version)', () => {
  it('KPIs carry windowed logbookRevenue/logbookRentals beside ledger revenue', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.historicalRecord.aggregate
      .mockResolvedValueOnce({ _sum: { price: 8500 }, _count: { id: 4 } })
      .mockResolvedValueOnce({ _sum: { price: 2000 }, _count: { id: 1 } });
    // Distinct pinned month so this computes fresh (cache key includes start).
    const res = await request(app)
      .get('/api/dashboard/kpis?period=monthly&year=2024&month=2')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
    expect(res.body.monthlyRevenue).toBe(0); // ledger untouched
    expect(res.body.logbookRevenue).toBe(8500);
    expect(res.body.logbookRentals).toBe(4);
    expect(res.body.prevLogbookRevenue).toBe(2000);
    expect(res.body.prevLogbookRentals).toBe(1);
    // …and the aggregate was windowed to Feb 2024, not all-time.
    const where = prisma.historicalRecord.aggregate.mock.calls[0][0].where;
    expect(new Date(where.eventDate.gte).toISOString()).toBe(new Date(2024, 1, 1).toISOString());
  });

  it('insights carry historyByCategory per window', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findMany.mockResolvedValueOnce([]);
    prisma.transaction.findMany.mockResolvedValueOnce([]);
    prisma.payment.findMany.mockResolvedValueOnce([]);
    prisma.historicalRecord.groupBy.mockResolvedValueOnce([
      { category: 'Gown', _count: { id: 5 } },
      { category: 'Barong', _count: { id: 2 } },
    ]);
    const res = await request(app)
      .get('/api/dashboard/insights?period=monthly&year=2024&month=3')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
    expect(res.body.historyByCategory).toEqual({ Gown: 5, Barong: 2 });
    expect(res.body.categoryBreakdown).toEqual({});
  });

  it('inventory analytics summary carries logbook companions, ledger totals pure', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findMany.mockResolvedValueOnce([
      { id: 1, name: 'Gown A', category: 'Gown', price: 3000, status: 'Available', image: null },
    ]);
    prisma.transaction.findMany.mockResolvedValueOnce([]);
    prisma.historicalRecord.aggregate.mockResolvedValueOnce({ _sum: { price: 3000 }, _count: { id: 2 } });
    const res = await request(app)
      .get('/api/inventory/analytics')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
    expect(res.body.summary.totalRentals).toBe(0);
    expect(res.body.summary.totalRevenue).toBe(0);
    expect(res.body.summary.logbookRevenue).toBe(3000);
    expect(res.body.summary.logbookRentals).toBe(2);
  });

  it('inventory analytics ranks CATEGORIES in topCategories (not items)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findMany.mockResolvedValueOnce([
      { id: 1, name: 'Gown A', category: 'Gown', price: 3000, status: 'Available', image: null },
      { id: 2, name: 'Gown B', category: 'Gown', price: 3000, status: 'Available', image: null },
      { id: 3, name: 'Suit A', category: 'Suit', price: 2000, status: 'Available', image: null },
    ]);
    prisma.transaction.findMany.mockResolvedValueOnce([
      { id: 't1', itemId: 1, rentalFee: 3000, rentalDate: new Date(), returnDate: new Date(), dueDate: new Date(), status: 'Returned', releasePhoto: null, conditionPhoto: null },
      { id: 't2', itemId: 3, rentalFee: 2000, rentalDate: new Date(), returnDate: new Date(), dueDate: new Date(), status: 'Returned', releasePhoto: null, conditionPhoto: null },
    ]);
    prisma.payment.findMany.mockResolvedValueOnce([
      { amount: 3000, transactionId: 't1' },
      { amount: 2000, transactionId: 't2' },
    ]);
    prisma.historicalRecord.groupBy.mockResolvedValueOnce([
      { category: 'Gown', _count: { id: 4 } },
    ]);
    // Distinct pinned month — the unfiltered analytics key is already warmed
    // by the test above.
    const res = await request(app)
      .get('/api/inventory/analytics?period=monthly&year=2024&month=5')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
    expect(res.body.topCategories.byRevenue[0]).toMatchObject({ category: 'Gown', revenue: 3000, units: 2 });
    expect(res.body.topCategories.byFrequency[0]).toMatchObject({ category: 'Gown', rentals: 1, historyRentals: 4 });
    // Item-level tops still ride along for other consumers.
    expect(res.body.topByRevenue[0].name).toBe('Gown A');
  });

  it('version fingerprint includes the record count', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.aggregate.mockResolvedValueOnce({ _max: { updatedAt: new Date('2026-10-07T01:00:00Z') } });
    prisma.transaction.count.mockResolvedValueOnce(290);
    prisma.inventoryItem.aggregate.mockResolvedValueOnce({ _max: { updatedAt: new Date('2026-10-06T12:00:00Z') } });
    prisma.inventoryItem.count.mockResolvedValueOnce(116);
    prisma.historicalRecord.count.mockResolvedValueOnce(7);
    const res = await request(app).get('/api/dashboard/version').set('Authorization', 'Bearer staff-token');
    expect(res.status).toBe(200);
    expect(res.body.recordCount).toBe(7);
  });
});
