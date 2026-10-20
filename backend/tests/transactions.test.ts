import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

// Dynamic future dates — hardcoded dates rot (pickup-in-the-past 400s) as
// real time moves forward. Pickup = +2 days, due = +5 days.
const futureDate = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const PICKUP = futureDate(2);
const DUE = futureDate(5);

describe('POST /api/transactions', () => {
  it('should create rental when admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 1000 });

    // Security: rentalFee is NOT accepted from the client — derived server-side.
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.rentalFee).toBe(5000);
  });

  it('writes a completed Payment row for staff cash collected at booking', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 1000, downpaymentCash: true });

    expect(res.status).toBe(201);
    // The cash is money in hand: completed row + totalPaid seeded, so revenue
    // counts it and later collections don't re-collect it.
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 1000, method: 'cash', status: 'completed' }),
      })
    );
    expect(res.body.totalPaid).toBe(1000);
    expect(res.body.balance).toBe(4000);
  });

  it('writes no Payment row without the cash flag (gateway credits it later)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 1000 });

    expect(res.status).toBe(201);
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(res.body.totalPaid).toBe(0);
  });

  it('ignores downpaymentCash on customer bookings (webhook is the only credit)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', 'Bearer customer-token')
      .send({ itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 1000, downpaymentCash: true });

    expect(res.status).toBe(201);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  // The prisma transaction.create mock returns { id, ...data } with no
  // included item/customer, so the notification/SMS blocks (which read
  // transaction.item.name) need a fuller shape stubbed per-test.
  const setupBookingSmsTest = async (notifyPrefs: Record<string, boolean> | null) => {
    const { prisma } = await import('../src/config/database.js');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([{ message_id: 'm1' }]) });
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValue(null);
    vi.mocked(prisma.transaction.create).mockResolvedValueOnce({
      id: 'tx-new', customerId: 'customer-id-111', itemId: 1,
      rentalDate: new Date(PICKUP), dueDate: new Date(DUE),
      status: 'Reserved', rentalFee: 5000, downpayment: 1000, balance: 4000,
      item: { id: 1, name: 'Test Gown' },
      customer: { id: 'customer-id-111', name: 'SMS Customer' },
    } as any);
    const orig = vi.mocked(prisma.profile.findUnique).getMockImplementation();
    vi.mocked(prisma.profile.findUnique).mockImplementation((args: any) => {
      if (args?.where?.id === 'customer-id-111') {
        return Promise.resolve({ id: 'customer-id-111', name: 'SMS Customer', phone: '09171234567', email: null, notifyPrefs });
      }
      return orig!(args);
    });
    return orig;
  };

  it('should skip booking SMS when customer opted out (notifyPrefs.booking=false)', async () => {
    const { prisma } = await import('../src/config/database.js');
    const orig = await setupBookingSmsTest({ booking: false });

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 1000 });

    expect(res.status).toBe(201);
    expect(prisma.sentSms.create).not.toHaveBeenCalled();
    vi.mocked(prisma.profile.findUnique).mockImplementation(orig!);
  });

  it('should send booking SMS by default (no opt-out)', async () => {
    const { prisma } = await import('../src/config/database.js');
    const orig = await setupBookingSmsTest(null);

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 1000 });

    expect(res.status).toBe(201);
    expect(prisma.sentSms.create).toHaveBeenCalled();
    vi.mocked(prisma.profile.findUnique).mockImplementation(orig!);
  });

  it('should skip booking SMS when the global SMS switch is OFF (booking still succeeds)', async () => {
    const { prisma } = await import('../src/config/database.js');
    const orig = await setupBookingSmsTest(null);
    prisma.businessRule.findUnique.mockResolvedValueOnce({ key: 'messaging_sms_enabled', value: 'false' });

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 1000 });

    expect(res.status).toBe(201);
    expect(prisma.sentSms.create).not.toHaveBeenCalled();
    vi.mocked(prisma.profile.findUnique).mockImplementation(orig!);
  });

  it('should reject when customer posts directly (customers use /bookings)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer customer-token')
      .send({ itemId: 2, rentalDate: PICKUP, dueDate: DUE, downpayment: 1500 });

    expect(res.status).toBe(403);
  });

  it('should reject when item not found', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 999, rentalDate: PICKUP, dueDate: DUE });

    expect(res.status).toBe(404);
  });

  it('should reject when item is not available', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'OutOfService',
    });

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 2500 });

    expect(res.status).toBe(400);
  });

  it('should reject when dates overlap', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'Available',
    });
    // Persistent: the availability + overlap checks both hit findFirst.
    prisma.transaction.findFirst.mockResolvedValue({ id: 'overlapping-tx' });

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 2500 });

    expect(res.status).toBe(409);
  });

  it('should reject unauthenticated', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({ itemId: 1, rentalDate: PICKUP, dueDate: DUE });

    expect(res.status).toBe(401);
  });

  it('should reject a past pickup date', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test', category: 'Gown', price: 5000, status: 'Available',
    });

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({ customerId: 'customer-id-111', itemId: 1, rentalDate: '2026-07-20', dueDate: '2026-07-23', downpayment: 2500 });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/transactions', () => {
  it('should list transactions for admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([]);
    prisma.transaction.count.mockResolvedValueOnce(0);

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('transactions');
    expect(res.body).toHaveProperty('total');
  });

  it('should list own transactions for customer', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([]);
    prisma.transaction.count.mockResolvedValueOnce(0);

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(200);
  });

  it('should reject unauthenticated', async () => {
    const res = await request(app).get('/api/transactions');
    expect(res.status).toBe(401);
  });
});

// Staff audit: who assisted the booking (walk-ins included) and who released
// the item. Regression: release/return used to overwrite processedById, which
// destroyed the record of the assisting staffer.
describe('Staff audit trail (assisted-by / released-by)', () => {
  it('create stores assistedById = the staff who booked', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({
      id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available',
    });
    prisma.transaction.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer staff-token')
      .send({ customerId: 'customer-id-111', itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 1000 });

    expect(res.status).toBe(201);
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assistedById: 'staff-id-456' }),
      })
    );
  });

  it('release stores releasedById without touching assistedById', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-rel', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(PICKUP), dueDate: new Date(DUE),
      rentalFee: 5000, totalPaid: 5000, balance: 0, status: 'Reserved',
      assistedById: 'staff-id-456', releasedById: null,
      item: { id: 1, name: 'Test', status: 'Reserved' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-rel/release')
      .set('Authorization', 'Bearer admin-token')
      .send({ releasePhoto: 'rental/tx-rel/release.jpg' });

    expect(res.status).toBe(200);
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ releasedById: 'admin-id-789' }),
      })
    );
    // assistedById must never be part of the release update (history preserved).
    const updateData = vi.mocked(prisma.transaction.update).mock.calls.at(-1)?.[0]?.data as Record<string, unknown>;
    expect(updateData).not.toHaveProperty('assistedById');
  });

  it('release refuses when balance is outstanding', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-rel-unpaid', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(PICKUP), dueDate: new Date(DUE),
      rentalFee: 5000, totalPaid: 1000, balance: 4000, status: 'Reserved',
      assistedById: 'staff-id-456', releasedById: null,
      item: { id: 1, name: 'Test', status: 'Reserved' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-rel-unpaid/release')
      .set('Authorization', 'Bearer admin-token')
      .send({ releasePhoto: 'rental/tx-rel-unpaid/release.jpg' });

    expect(res.status).toBe(400);
    expect(res.body.message || res.body.error || JSON.stringify(res.body)).toMatch(/payment|balance/i);
  });

  it('GET /transactions/:id/audits returns the timeline with staff names', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', customerId: 'customer-id-111', itemId: 1,
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 4000, status: 'Active',
      customer: { id: 'customer-id-111', name: 'Customer User' },
      item: { id: 1, name: 'Test Gown' },
      payments: [],
    });
    prisma.auditLog.findMany.mockResolvedValue([
      { id: 'l1', action: 'create', entity: 'transaction', entityId: 'tx-1', performedById: 'staff-id-456', oldValue: null, newValue: { assistedById: 'staff-id-456' }, createdAt: new Date('2026-01-01') },
      { id: 'l2', action: 'update', entity: 'transaction', entityId: 'tx-1', performedById: 'admin-id-789', oldValue: { status: 'Reserved' }, newValue: { status: 'Active', released: true }, createdAt: new Date('2026-01-02') },
    ]);
    prisma.profile.findMany.mockResolvedValueOnce([
      { id: 'staff-id-456', name: 'Staff User', role: 'Staff' },
      { id: 'admin-id-789', name: 'Admin User', role: 'Admin' },
    ]);

    const res = await request(app)
      .get('/api/transactions/tx-1/audits')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].performedBy).toMatchObject({ name: 'Staff User' });
    expect(res.body[1].performedBy).toMatchObject({ name: 'Admin User' });
  });

  it('re-release logs no second release audit (first release wins)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-rerelease', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(PICKUP), dueDate: new Date(DUE),
      rentalFee: 5000, totalPaid: 5000, balance: 0, status: 'Active',
      assistedById: 'staff-id-456', releasedById: 'staff-id-456',
      releasePhoto: 'rental/tx-rerelease/release-old.jpg',
      item: { id: 1, name: 'Test', status: 'Rented' },
    });

    const before = vi.mocked(prisma.auditLog.create).mock.calls.length;
    const res = await request(app)
      .put('/api/transactions/tx-rerelease/release')
      .set('Authorization', 'Bearer admin-token')
      .send({ releasePhoto: 'rental/tx-rerelease/release-new.jpg' });

    expect(res.status).toBe(200);
    // No NEW audit row for the re-release (releasedById also untouched).
    expect(vi.mocked(prisma.auditLog.create).mock.calls.length).toBe(before);
    const updateData = vi.mocked(prisma.transaction.update).mock.calls.at(-1)?.[0]?.data as Record<string, unknown>;
    expect(updateData).not.toHaveProperty('releasedById');
  });

  it('timeline collapses legacy duplicate releases to the first', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-dup', customerId: 'customer-id-111', itemId: 1,
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 4000, status: 'Active',
      customer: { id: 'customer-id-111', name: 'Customer User' },
      item: { id: 1, name: 'Test Gown' },
      payments: [],
    });
    prisma.auditLog.findMany.mockResolvedValue([
      { id: 'l1', action: 'create', entity: 'transaction', entityId: 'tx-dup', performedById: 'staff-id-456', oldValue: null, newValue: {}, createdAt: new Date('2026-01-01') },
      { id: 'l2', action: 'update', entity: 'transaction', entityId: 'tx-dup', performedById: 'staff-id-456', oldValue: { status: 'Reserved' }, newValue: { status: 'Active', released: true }, createdAt: new Date('2026-01-02') },
      { id: 'l3', action: 'update', entity: 'transaction', entityId: 'tx-dup', performedById: 'staff-id-456', oldValue: { status: 'Returned' }, newValue: { status: 'Active', released: true, backfilled: true }, createdAt: new Date('2026-01-03') },
    ]);
    prisma.profile.findMany.mockResolvedValueOnce([
      { id: 'staff-id-456', name: 'Staff User', role: 'Staff' },
    ]);

    const res = await request(app)
      .get('/api/transactions/tx-dup/audits')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    // create + ONE release (the legacy duplicate is collapsed server-side).
    expect(res.body).toHaveLength(2);
    expect(res.body[1]).toMatchObject({ id: 'l2' });
  });

  it('timeline includes QR payment proof submit + review events', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-qr', customerId: 'customer-id-111', itemId: 1,
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 4000, status: 'Active',
      customer: { id: 'customer-id-111', name: 'Customer User' },
      item: { id: 1, name: 'Test Gown' },
      payments: [],
    });
    prisma.auditLog.findMany.mockResolvedValue([
      { id: 'l1', action: 'create', entity: 'transaction', entityId: 'tx-qr', performedById: 'staff-id-456', oldValue: null, newValue: {}, createdAt: new Date('2026-01-01') },
    ]);
    prisma.paymentProof.findMany.mockResolvedValueOnce([
      {
        id: 'proof-1', status: 'approved', amount: 200, reference: 'REF-9', channel: 'qr-1',
        rejectionReason: null, createdAt: new Date('2026-01-02'), reviewedAt: new Date('2026-01-03'),
        reviewedById: 'admin-id-789', transaction: { customerId: 'customer-id-111' },
      },
    ]);
    prisma.profile.findMany.mockResolvedValueOnce([
      { id: 'staff-id-456', name: 'Staff User', role: 'Staff' },
      { id: 'customer-id-111', name: 'Customer User', role: 'Customer' },
      { id: 'admin-id-789', name: 'Admin User', role: 'Admin' },
    ]);

    const res = await request(app)
      .get('/api/transactions/tx-qr/audits')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[1]).toMatchObject({
      action: 'payment_proof.submit',
      entity: 'payment_proof',
      performedBy: { name: 'Customer User' },
    });
    expect(res.body[2]).toMatchObject({
      action: 'payment_proof.approve',
      performedBy: { name: 'Admin User' },
    });
    expect(res.body[2].newValue).toMatchObject({ transactionId: 'tx-qr', amount: 200 });
  });

  it('GET /transactions/:id/audits rejects customers and unauthenticated', async () => {
    const noAuth = await request(app).get('/api/transactions/tx-1/audits');
    expect(noAuth.status).toBe(401);

    // NOTE: no DB stub here — the route-level requireRole(Admin, Staff) 403s
    // before the controller runs, so a queued mockResolvedValueOnce would leak
    // into the NEXT test's mock queue (off-by-one poisoning). The controller
    // keeps its own ownership check as defense-in-depth.
    const forbidden = await request(app)
      .get('/api/transactions/tx-1/audits')
      .set('Authorization', 'Bearer customer-token');
    expect(forbidden.status).toBe(403);
  });
});

describe('GET /api/transactions/:id', () => {
  it('should return transaction by id', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', customerId: 'admin-id-789', itemId: 1, rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 4000, status: 'Active',
      customer: { id: 'admin-id-789', name: 'Admin', email: 'admin@example.com' },
      item: { id: 1, name: 'Test Gown', category: 'Gown' },
      payments: [],
    });

    const res = await request(app)
      .get('/api/transactions/tx-1')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'tx-1');
  });

  it('should return 404 for non-existent transaction', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/transactions/tx-404')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/transactions/:id/return', () => {
  it('should process return when fully paid', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date('2026-07-10'), dueDate: new Date('2026-07-13'),
      rentalFee: 5000, downpayment: 5000, totalPaid: 5000, balance: 0,
      latePenalty: 0, damageFee: 0, status: 'Active',
      item: { id: 1, name: 'Test', status: 'Rented' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-1/return')
      .set('Authorization', 'Bearer admin-token')
      .send({ returnDate: '2026-07-14', isDamaged: false });

    expect(res.status).toBe(200);
    expect(res.body.fees).toBeDefined();
  });

  it('should refuse return when balance is outstanding', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-unpaid', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date('2026-07-10'), dueDate: new Date('2026-07-13'),
      rentalFee: 5000, downpayment: 1000, totalPaid: 1000, balance: 4000,
      latePenalty: 0, damageFee: 0, status: 'Active',
      item: { id: 1, name: 'Test', status: 'Rented' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-unpaid/return')
      .set('Authorization', 'Bearer admin-token')
      .send({ returnDate: '2026-07-14', isDamaged: false });

    expect(res.status).toBe(400);
    expect(res.body.message || res.body.error || JSON.stringify(res.body)).toMatch(/balance/i);
  });

  it('should waive late penalty (late fees removed)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-2', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date('2026-07-01'), dueDate: new Date('2026-07-04'),
      rentalFee: 5000, downpayment: 5000, totalPaid: 5000, balance: 0,
      latePenalty: 0, damageFee: 0, status: 'Active',
      item: { id: 1, name: 'Test', status: 'Rented' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-2/return')
      .set('Authorization', 'Bearer admin-token')
      .send({ returnDate: '2026-07-10', isDamaged: false });

    expect(res.status).toBe(200);
    expect(res.body.fees.latePenalty).toBe(0);
    expect(res.body.fees.daysLate).toBeGreaterThan(0);
  });

  it('should honor a custom damage fee override', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-4', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date('2026-07-01'), dueDate: new Date('2026-07-04'),
      rentalFee: 5000, downpayment: 5000, totalPaid: 5000, balance: 0,
      latePenalty: 0, damageFee: 0, status: 'Active',
      item: { id: 1, name: 'Test', status: 'Rented' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-4/return')
      .set('Authorization', 'Bearer admin-token')
      .send({ returnDate: '2026-07-04', isDamaged: true, damageFee: 2500, damageReason: 'Torn' });

    expect(res.status).toBe(200);
    expect(res.body.fees.damageFee).toBe(2500);
  });

  it('should reject if already returned', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-3', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 0, status: 'Returned',
      item: { id: 1, name: 'Test', status: 'Cleaning' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-3/return')
      .set('Authorization', 'Bearer admin-token')
      .send({ returnDate: '2026-07-14', isDamaged: false });

    expect(res.status).toBe(400);
  });

  it('should reject return on an unreleased (Reserved) rental', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-reserved', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, downpayment: 5000, totalPaid: 5000, balance: 0,
      latePenalty: 0, damageFee: 0, status: 'Reserved',
      item: { id: 1, name: 'Test', status: 'Reserved' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-reserved/return')
      .set('Authorization', 'Bearer admin-token')
      .send({ returnDate: '2026-07-14', isDamaged: false });

    expect(res.status).toBe(400);
    expect(res.body.message || res.body.error || JSON.stringify(res.body)).toMatch(/release/i);
  });

  it('should reject for customer', async () => {
    const res = await request(app)
      .put('/api/transactions/tx-1/return')
      .set('Authorization', 'Bearer customer-token')
      .send({ returnDate: '2026-07-14', isDamaged: false });

    expect(res.status).toBe(403);
  });
});

describe('PUT /api/transactions/:id/cancel', () => {
  it('should cancel transaction when admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    // Persistent: the controller looks up the tx, then the service re-fetches.
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 4000, status: 'Active',
      item: { id: 1, name: 'Test', status: 'Rented' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-1/cancel')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'booking_cancelled', profileId: 'customer-id-111' }),
      })
    );
  });

  it('should let staff cancel without seeking approval', async () => {
    const { prisma } = await import('../src/config/database.js');
    // Persistent: the controller looks up the tx, then the service re-fetches.
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 4000, status: 'Active',
      item: { id: 1, name: 'Test', status: 'Rented' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-1/cancel')
      .set('Authorization', 'Bearer staff-token');

    expect(res.status).toBe(200);
  });

  it('keeps the item Reserved when a second live hold remains', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 4000, status: 'Reserved',
      item: { id: 1, name: 'Test', status: 'Reserved' },
    });
    prisma.transaction.findFirst.mockResolvedValue({ id: 'tx-2', status: 'Reserved' });

    const res = await request(app)
      .put('/api/transactions/tx-1/cancel')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ itemId: 1, itemStatus: 'Reserved' });
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('frees the item to Available when no other hold remains', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 4000, status: 'Active',
      item: { id: 1, name: 'Test', status: 'Rented' },
    });
    prisma.transaction.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/transactions/tx-1/cancel')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ itemId: 1, itemStatus: 'Available' });
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ status: 'Available', outOfServiceReason: null }),
      })
    );
  });

  it('never touches Cleaning/OutOfService items on cancel', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 4000, status: 'Active',
      item: { id: 1, name: 'Test', status: 'Cleaning' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-1/cancel')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ itemStatus: 'Cleaning' });
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
  });

  // SECURITY: a customer may only REQUEST a cancellation (with a written
  // explanation, via the messages inbox). Cancelling is staff/admin-only, so a
  // paid Reserved booking can never be voided unilaterally over the API.
  it('should reject a customer cancelling their own booking', async () => {
    const { prisma } = await import('../src/config/database.js');
    const res = await request(app)
      .put('/api/transactions/tx-1/cancel')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(403);
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('should reject already cancelled', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-cancelled', itemId: 1, customerId: 'customer-id-111',
      rentalDate: new Date(), dueDate: new Date(),
      rentalFee: 5000, balance: 0, status: 'Cancelled',
      item: { id: 1, name: 'Test', status: 'Available' },
    });

    const res = await request(app)
      .put('/api/transactions/tx-cancelled/cancel')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/transactions/:id/swap-item', () => {
  const existingTx = () => ({
    id: 'tx-swap', itemId: 1, customerId: 'customer-id-111',
    rentalDate: new Date(PICKUP), dueDate: new Date(DUE),
    rentalFee: 5000, downpayment: 1000, totalPaid: 1000, balance: 4000,
    promoCodeId: 'promo-1', size: 'L', measurements: { chest: 40 },
    releasePhoto: null, releasedById: null, notes: 'Orig note',
    status: 'Reserved', updatedAt: new Date('2026-01-01T00:00:00Z'),
    item: { id: 1, name: 'Old Gown', status: 'Reserved', price: 5000 },
    customer: { id: 'customer-id-111', name: 'Swap Customer', email: 'swap@test.local' },
  });
  const replacementItem = (overrides = {}) => ({
    id: 2, name: 'New Gown', category: 'Gown', price: 6000, status: 'Available',
    onSale: true, salePrice: 5500, saleEndsAt: null, ...overrides,
  });
  const setupSwap = async (existing: any, replacement: any, updated: any) => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(updated);
    prisma.inventoryItem.findUnique.mockResolvedValueOnce(replacement);
    return prisma;
  };

  it('swaps the item: sale-aware reprice, promo voided, downpayment kept, audit written', async () => {
    const existing = existingTx();
    const updated = {
      ...existing, itemId: 2, rentalFee: 5500, balance: 4500, promoCodeId: null,
      size: null, releasePhoto: null, releasedById: null,
      item: { id: 2, name: 'New Gown', category: 'Gown' },
    };
    const prisma = await setupSwap(existing, replacementItem(), updated);

    const res = await request(app)
      .put('/api/transactions/tx-swap/swap-item')
      .set('Authorization', 'Bearer admin-token')
      .send({ newItemId: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      itemId: 2, rentalFee: 5500, balance: 4500, downpayment: 1000, promoCodeId: null,
      swappedFrom: { id: 1, name: 'Old Gown' }, previousFee: 5000, promoVoided: true,
    });
    // Optimistic lock: the update only applies when the row is untouched.
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'tx-swap', updatedAt: existing.updatedAt }),
        data: expect.objectContaining({ itemId: 2, rentalFee: 5500, promoCodeId: null, size: null, releasePhoto: null }),
      })
    );
    // Promo use handed back; old garment pooled; new one held (future pickup → Reserved).
    expect(prisma.promoCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentUses: expect.objectContaining({ decrement: 1 }) }) })
    );
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ status: 'Available' }) })
    );
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2 }, data: expect.objectContaining({ status: 'Reserved' }) })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'item_swap', entityId: 'tx-swap' }) })
    );
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'booking_updated', profileId: 'customer-id-111' }) })
    );
  });

  it('floors balance at 0 on a cheaper swap and keeps the downpayment (no refund)', async () => {
    const existing = existingTx();
    const updated = {
      ...existing, itemId: 2, rentalFee: 800, balance: 0, promoCodeId: null,
      item: { id: 2, name: 'Cheap Barong', category: 'Barong' },
    };
    await setupSwap(existing, replacementItem({ id: 2, name: 'Cheap Barong', category: 'Barong', price: 800, onSale: false, salePrice: null }), updated);

    const res = await request(app)
      .put('/api/transactions/tx-swap/swap-item')
      .set('Authorization', 'Bearer admin-token')
      .send({ newItemId: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rentalFee: 800, balance: 0, downpayment: 1000 });
  });

  it('rejects the same item, finished/out rentals, and missing records', async () => {
    const { prisma } = await import('../src/config/database.js');

    // Same item — no-op.
    prisma.transaction.findUnique.mockResolvedValueOnce(existingTx());
    expect((await request(app).put('/api/transactions/tx-swap/swap-item')
      .set('Authorization', 'Bearer admin-token').send({ newItemId: 1 })).status).toBe(400);

    for (const status of ['Returned', 'Cancelled', 'Overdue']) {
      prisma.transaction.findUnique.mockResolvedValueOnce({ ...existingTx(), status });
      expect((await request(app).put('/api/transactions/tx-swap/swap-item')
        .set('Authorization', 'Bearer admin-token').send({ newItemId: 2 })).status).toBe(400);
    }

    // Unknown transaction / replacement item.
    prisma.transaction.findUnique.mockResolvedValueOnce(null);
    expect((await request(app).put('/api/transactions/tx-nope/swap-item')
      .set('Authorization', 'Bearer admin-token').send({ newItemId: 2 })).status).toBe(404);

    prisma.transaction.findUnique.mockResolvedValueOnce(existingTx());
    prisma.inventoryItem.findUnique.mockResolvedValueOnce(null);
    expect((await request(app).put('/api/transactions/tx-swap/swap-item')
      .set('Authorization', 'Bearer admin-token').send({ newItemId: 999 })).status).toBe(404);
  });

  it('rejects unrentable replacements and date collisions', async () => {
    const { prisma } = await import('../src/config/database.js');

    for (const [status, expected] of [['OutOfService', 400], ['Cleaning', 409]] as const) {
      prisma.transaction.findUnique.mockResolvedValueOnce(existingTx());
      prisma.inventoryItem.findUnique.mockResolvedValueOnce(replacementItem({ status }));
      expect((await request(app).put('/api/transactions/tx-swap/swap-item')
        .set('Authorization', 'Bearer admin-token').send({ newItemId: 2 })).status).toBe(expected);
    }

    // Another booking holds the replacement for these dates.
    prisma.transaction.findUnique.mockResolvedValueOnce(existingTx());
    prisma.inventoryItem.findUnique.mockResolvedValueOnce(replacementItem());
    prisma.transaction.findFirst.mockResolvedValueOnce({ id: 'other-tx' } as any);
    expect((await request(app).put('/api/transactions/tx-swap/swap-item')
      .set('Authorization', 'Bearer admin-token').send({ newItemId: 2 })).status).toBe(409);
  });

  it('rejects customers, bad payloads, and unauthenticated callers', async () => {
    const forbidden = await request(app).put('/api/transactions/tx-swap/swap-item')
      .set('Authorization', 'Bearer customer-token').send({ newItemId: 2 });
    expect(forbidden.status).toBe(403);

    const badBody = await request(app).put('/api/transactions/tx-swap/swap-item')
      .set('Authorization', 'Bearer admin-token').send({});
    expect(badBody.status).toBe(400);

    const noAuth = await request(app).put('/api/transactions/tx-swap/swap-item').send({ newItemId: 2 });
    expect(noAuth.status).toBe(401);
  });
});

describe('GET /api/transactions/upcoming', () => {
  it('should list upcoming returns for staff', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/transactions/upcoming')
      .set('Authorization', 'Bearer staff-token');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should reject for customer', async () => {
    const res = await request(app)
      .get('/api/transactions/upcoming')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/dashboard/kpis', () => {
  it('should return KPIs for admin', async () => {
    const res = await request(app)
      .get('/api/dashboard/kpis')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('activeRentals');
    expect(res.body).toHaveProperty('overdueReturns');
    expect(res.body).toHaveProperty('monthlyRevenue');
    expect(res.body).toHaveProperty('totalRevenue');
  });

  it('should include a collected-payments revenueTrend (6 months) + todayRevenue', async () => {
    const { prisma } = await import('../src/config/database.js');
    // Unique period window → unique cache key, so this test always computes
    // fresh instead of hitting the `kpis:all` entry warmed by the test above.
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    prisma.payment.findMany.mockResolvedValueOnce([
      { amount: 1500, createdAt: new Date() },
    ]);

    const res = await request(app)
      .get(`/api/dashboard/kpis?period=monthly&year=${now.getFullYear()}&month=${thisMonth}`)
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('todayRevenue');
    expect(typeof res.body.todayRevenue).toBe('number');
    expect(Array.isArray(res.body.revenueTrend)).toBe(true);
    expect(res.body.revenueTrend).toHaveLength(6);
    for (const m of res.body.revenueTrend) {
      expect(m).toHaveProperty('label');
      expect(typeof m.revenue).toBe('number');
    }
    // The trend query targets collected ledger rows only (never booked fees).
    const trendCall = (prisma.payment.findMany as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c?.[0]?.select?.amount === true && Array.isArray(c?.[0]?.where?.status?.in)
    );
    expect(trendCall).toBeTruthy();
    expect(trendCall[0].where.status.in).toEqual(expect.arrayContaining(['succeeded', 'completed']));
    // This month's collected payment lands in the current-month bucket.
    const currentLabel = now.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    const current = res.body.revenueTrend.find((m: { label: string }) => m.label === currentLabel);
    expect(current?.revenue).toBe(1500);
  });

  it('should reject for customer', async () => {
    const res = await request(app)
      .get('/api/dashboard/kpis')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/dashboard/today', () => {
  it('should return today tasks for staff', async () => {
    const { prisma } = await import('../src/config/database.js');
    // The 'today' digest is cached server-side and earlier tests (via the
    // mutation cache-warmer) may have filled it — clear so this test's mocks
    // drive a fresh compute and the query-shape assertions below are real.
    const { clearDataCache } = await import('../src/utils/ttlCache.js');
    clearDataCache();
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.inventoryItem.count.mockResolvedValueOnce(0);

    const res = await request(app)
      .get('/api/dashboard/today')
      .set('Authorization', 'Bearer staff-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dueToday');
    expect(res.body).toHaveProperty('overdue');
    expect(res.body).toHaveProperty('inCleaning');
    // First-paint fast path: the digest carries the pickup queue + revenue
    // so Tasks paints before the 500-row list lands.
    expect(res.body).toHaveProperty('pendingPickup');
    expect(Array.isArray(res.body.pendingPickup)).toBe(true);
    expect(res.body).toHaveProperty('todayRevenue');
    // Digest rows are FULL records (all scalars + customer/item names) —
    // every queue action works directly off them.
    const pickupCall = (prisma.transaction.findMany as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => Array.isArray(c?.[0]?.where?.status?.in) && c[0].where.status.in.includes('Reserved') && 'releasePhoto' in (c[0].where ?? {})
    );
    expect(pickupCall).toBeTruthy();
    expect(pickupCall[0].include?.customer?.select).toMatchObject({ id: true, name: true, phone: true, address: true });
  });

  it('should reject for customer', async () => {
    const res = await request(app)
      .get('/api/dashboard/today')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/dashboard/version', () => {
  it('should return a tiny freshness fingerprint for staff', async () => {
    const { prisma } = await import('../src/config/database.js');
    // The mutation cache-warmer is disabled under vitest (see
    // dashboard.service), so Once mocks below are consumed only by this
    // request.
    prisma.transaction.aggregate.mockResolvedValueOnce({ _max: { updatedAt: new Date('2026-10-07T01:00:00Z') } });
    prisma.transaction.count.mockResolvedValueOnce(290);
    prisma.inventoryItem.aggregate.mockResolvedValueOnce({ _max: { updatedAt: new Date('2026-10-06T12:00:00Z') } });
    prisma.inventoryItem.count.mockResolvedValueOnce(116);

    const res = await request(app)
      .get('/api/dashboard/version')
      .set('Authorization', 'Bearer staff-token');

    expect(res.status).toBe(200);
    // Version = max of the two table watermarks (tx wins here).
    expect(res.body.version).toBe(new Date('2026-10-07T01:00:00Z').getTime());
    expect(res.body.txCount).toBe(290);
    expect(res.body.itemCount).toBe(116);
    expect(typeof res.body.at).toBe('string');
  });

  it('should reject for customer', async () => {
    const res = await request(app)
      .get('/api/dashboard/version')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(403);
  });

  it('should reject when unauthenticated', async () => {
    const res = await request(app).get('/api/dashboard/version');
    expect(res.status).toBe(401);
  });
});

describe('Query param validation (500→400)', () => {
  it('GET /transactions with garbage status → 400', async () => {
    const res = await request(app)
      .get('/api/transactions?status=garbage')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(400);
  });

  it('GET /transactions with valid status → not 400', async () => {
    const res = await request(app)
      .get('/api/transactions?status=Active')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).not.toBe(400);
  });
});

describe('Return date validation', () => {
  it('PUT /transactions/:id/return with bad returnDate → 400', async () => {
    const res = await request(app)
      .put('/api/transactions/tx-new/return')
      .set('Authorization', 'Bearer admin-token')
      .send({ returnDate: 'garbage' });
    expect(res.status).toBe(400);
  });
});
