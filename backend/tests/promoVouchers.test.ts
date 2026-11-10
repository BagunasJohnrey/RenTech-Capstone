import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../src/services/storage.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/storage.service.js')>();
  return {
    ...actual,
    uploadFile: vi.fn().mockResolvedValue({ path: 'rental/test/proof.jpg' }),
    removeObject: vi.fn(),
  };
});

import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import type { checkPromo as checkPromoType } from '../src/services/promoCodes.service.js';
import type { hashAdminPin as hashAdminPinType } from '../src/services/auth.service.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

// Service modules are imported dynamically (never static top-level): a
// static service import evaluates env-dependent modules before the setup
// file's process.env assignments and breaks the mocked database wiring.
let checkPromo: typeof checkPromoType;
let hashAdminPin: typeof hashAdminPinType;
beforeAll(async () => {
  ({ checkPromo } = await import('../src/services/promoCodes.service.js'));
  ({ hashAdminPin } = await import('../src/services/auth.service.js'));
});

const futureDate = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const PICKUP = futureDate(2);
const DUE = futureDate(5);

const promoRow = (overrides = {}) => ({
  id: 'promo-1',
  code: 'SAVE10',
  isActive: true,
  discountPct: 10,
  discountAmount: null,
  minSpend: null,
  startsAt: null,
  maxUsesPerCustomer: null,
  firstBookingOnly: false,
  appliesToCategories: [],
  maxUses: null,
  currentUses: 0,
  expiresAt: null,
  ...overrides,
});

const availableItem = (overrides = {}) => ({
  id: 1, name: 'Test Gown', category: 'Gown', price: 5000, status: 'Available',
  ...overrides,
});

async function mockDb() {
  const { prisma } = await import('../src/config/database.js');
  // Explicit per-test state (no reliance on cross-test mock leftovers).
  prisma.promoCode.findUnique.mockResolvedValue(null);
  prisma.transaction.count.mockResolvedValue(0);
  prisma.transaction.findFirst.mockResolvedValue(null);
  prisma.promoClaim.findMany.mockResolvedValue([]);
  prisma.promoClaim.upsert.mockClear();
  // The consume guard references prisma.promoCode.fields (real-client API);
  // mirror it on the mock so consume paths can run under test.
  (prisma.promoCode as any).fields = { maxUses: 'maxUses' };
  return { prisma };
}

describe('checkPromo — discount shapes', () => {
  it('computes percent-off discount + final fee', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findUnique.mockResolvedValue(promoRow());

    const r = await checkPromo('save10', 5000);
    expect(r).toMatchObject({ promoCodeId: 'promo-1', code: 'SAVE10', discountPct: 10, discountAmount: 500, finalFee: 4500 });
  });

  it('applies a fixed peso amount and never goes below zero', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findUnique.mockResolvedValue(
      promoRow({ code: 'FLAT200', discountPct: null, discountAmount: 200 })
    );

    const r = await checkPromo('FLAT200', 5000);
    expect(r).toMatchObject({ discountAmount: 200, finalFee: 4800 });

    const capped = await checkPromo('FLAT200', 150);
    expect(capped).toMatchObject({ discountAmount: 150, finalFee: 0 });
  });

  it('rejects a code with no discount set', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findUnique.mockResolvedValue(
      promoRow({ discountPct: null, discountAmount: null })
    );

    await expect(checkPromo('SAVE10', 5000)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('checkPromo — guards', () => {
  it('blocks below minSpend, passes at exactly minSpend', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findUnique.mockResolvedValue(promoRow({ minSpend: 3000 }));

    await expect(checkPromo('SAVE10', 2999)).rejects.toMatchObject({ statusCode: 400 });
    const ok = await checkPromo('SAVE10', 3000);
    expect(ok.finalFee).toBe(2700);
  });

  it('blocks before startsAt', async () => {
    const { prisma } = await mockDb();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    prisma.promoCode.findUnique.mockResolvedValue(promoRow({ startsAt: tomorrow }));

    await expect(checkPromo('SAVE10', 5000)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('enforces category scope only when the code is scoped', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findUnique.mockResolvedValue(promoRow({ appliesToCategories: ['Gown'] }));

    await expect(checkPromo('SAVE10', 5000, { itemCategory: 'Suit' })).rejects.toMatchObject({ statusCode: 400 });
    const ok = await checkPromo('SAVE10', 5000, { itemCategory: 'gown' });
    expect(ok.finalFee).toBe(4500);
  });

  it('enforces the per-customer cap (default once, configurable)', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findUnique.mockResolvedValue(promoRow());
    prisma.transaction.count.mockResolvedValue(1);

    await expect(checkPromo('SAVE10', 5000, { customerId: 'customer-id-111' })).rejects.toMatchObject({
      statusCode: 400,
    });

    prisma.promoCode.findUnique.mockResolvedValue(promoRow({ maxUsesPerCustomer: 3 }));
    prisma.transaction.count.mockResolvedValue(2);
    const ok = await checkPromo('SAVE10', 5000, { customerId: 'customer-id-111' });
    expect(ok.finalFee).toBe(4500);

    prisma.transaction.count.mockResolvedValue(3);
    await expect(checkPromo('SAVE10', 5000, { customerId: 'customer-id-111' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('restricts firstBookingOnly codes to customers with no live bookings', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findUnique.mockResolvedValue(promoRow({ firstBookingOnly: true }));

    prisma.transaction.count.mockResolvedValue(0);
    const ok = await checkPromo('SAVE10', 5000, { customerId: 'new-customer' });
    expect(ok.finalFee).toBe(4500);

    // One live booking disqualifies; cancelled-only history does not.
    prisma.transaction.count
      .mockResolvedValueOnce(0) // cap count
      .mockResolvedValueOnce(2); // live bookings count
    await expect(checkPromo('SAVE10', 5000, { customerId: 'old-customer' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('excludeTransactionId keeps a swap row from counting against the cap', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findUnique.mockResolvedValue(promoRow());
    prisma.transaction.count.mockResolvedValue(0);

    const ok = await checkPromo('SAVE10', 5500, {
      customerId: 'customer-id-111',
      excludeTransactionId: 'tx-swap',
    });
    expect(ok.finalFee).toBe(4950);
    expect(prisma.transaction.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 'tx-swap' } }) })
    );
  });
});

describe('GET /api/promo-codes/public — hides exhausted vouchers', () => {
  it('leaves out codes the caller has already used up', async () => {
    const { prisma } = await mockDb();
    const { listPublicPromoCodes } = await import('../src/services/promoCodes.service.js');
    prisma.promoCode.findMany.mockResolvedValue([
      promoRow({ id: 'promo-1', code: 'USEDUP' }),
      promoRow({ id: 'promo-2', code: 'FRESH' }),
    ]);
    prisma.transaction.groupBy.mockResolvedValue([
      { promoCodeId: 'promo-1', _count: { promoCodeId: 1 } },
    ]);

    const codes = await listPublicPromoCodes('customer-id-111');
    expect(codes.map((c) => c.code)).toEqual(['FRESH']);
  });

  it('keeps multi-use codes until the personal limit is reached', async () => {
    const { prisma } = await mockDb();
    const { listPublicPromoCodes } = await import('../src/services/promoCodes.service.js');
    prisma.promoCode.findMany.mockResolvedValue([
      promoRow({ id: 'promo-3', code: 'THRICE', maxUsesPerCustomer: 3 }),
    ]);
    prisma.transaction.groupBy.mockResolvedValue([
      { promoCodeId: 'promo-3', _count: { promoCodeId: 2 } },
    ]);

    const codes = await listPublicPromoCodes('customer-id-111');
    expect(codes.map((c) => c.code)).toEqual(['THRICE']);
  });
});

describe('POST /api/promo-codes (admin CRUD)', () => {
  it('creates a fixed-amount code', async () => {
    await mockDb();
    const res = await request(app)
      .post('/api/promo-codes')
      .set('Authorization', 'Bearer admin-token')
      .send({ code: 'flat200', discountAmount: 200, minSpend: 1000 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: 'FLAT200', discountAmount: 200, minSpend: 1000 });
  });

  it('rejects both/neither discount shapes', async () => {
    await mockDb();
    const both = await request(app)
      .post('/api/promo-codes')
      .set('Authorization', 'Bearer admin-token')
      .send({ code: 'BAD1', discountPct: 10, discountAmount: 100 });
    expect(both.status).toBe(400);

    const neither = await request(app)
      .post('/api/promo-codes')
      .set('Authorization', 'Bearer admin-token')
      .send({ code: 'BAD2' });
    expect(neither.status).toBe(400);
  });

  it('blocks deleting a code with booking history, allows a clean one', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findUnique.mockResolvedValue(promoRow());
    prisma.transaction.count.mockResolvedValue(2);
    const blocked = await request(app)
      .delete('/api/promo-codes/promo-1')
      .set('Authorization', 'Bearer admin-token');
    expect(blocked.status).toBe(400);

    prisma.transaction.count.mockResolvedValue(0);
    const allowed = await request(app)
      .delete('/api/promo-codes/promo-1')
      .set('Authorization', 'Bearer admin-token');
    expect(allowed.status).toBe(200);
    expect(prisma.promoCode.delete).toHaveBeenCalledWith({ where: { id: 'promo-1' } });
  });
});

describe('POST /api/promo-codes/validate (no more validate-then-fail)', () => {
  it('fails the per-customer cap at validate time, not just at submit', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findUnique.mockResolvedValue(promoRow());
    prisma.transaction.count.mockResolvedValue(1); // already used

    const res = await request(app)
      .post('/api/promo-codes/validate')
      .set('Authorization', 'Bearer customer-token')
      .send({ code: 'SAVE10', rentalFee: 5000 });

    expect(res.status).toBe(400);
  });

  it('passes a usable code with category context', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findUnique.mockResolvedValue(promoRow({ appliesToCategories: ['Gown'] }));
    prisma.transaction.count.mockResolvedValue(0);

    const res = await request(app)
      .post('/api/promo-codes/validate')
      .set('Authorization', 'Bearer customer-token')
      .send({ code: 'SAVE10', rentalFee: 5000, itemCategory: 'Gown' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ finalFee: 4500 });
  });
});

describe('staff bookings: promo codes + PIN-verified counter discount', () => {
  const bookAsStaff = (body: Record<string, unknown>) =>
    request(app)
      .post('/api/transactions')
      .set('Authorization', 'Bearer admin-token')
      .send({
        customerId: 'customer-id-111', itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 1000,
        ...body,
      });

  it('applies a voucher code on the staff route', async () => {
    const { prisma } = await mockDb();
    prisma.inventoryItem.findUnique.mockResolvedValue(availableItem());
    prisma.promoCode.findUnique.mockResolvedValue(promoRow());

    const res = await bookAsStaff({ promoCode: 'SAVE10' });

    expect(res.status).toBe(201);
    expect(res.body.rentalFee).toBe(4500);
    expect(res.body.promoCodeId).toBe('promo-1');
  });

  it('applies a PIN-verified staff discount and persists who approved it', async () => {
    const { prisma } = await mockDb();
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    prisma.inventoryItem.findUnique.mockResolvedValue(availableItem());
    prisma.profile.findMany.mockResolvedValue([
      { userId: 'auth-admin-id-789', name: 'Admin User', email: 'admin@example.com' },
    ]);
    const { salt, hash } = hashAdminPin('1234');
    vi.mocked(supabaseAdmin.auth.admin.getUserById).mockResolvedValue({
      data: { user: { id: 'auth-admin-id-789', user_metadata: { adminPin: { salt, hash } } } },
      error: null,
    } as never);

    const res = await bookAsStaff({ staffDiscountPct: 20, staffDiscountPin: '1234' });

    expect(res.status).toBe(201);
    expect(res.body.rentalFee).toBe(4000);
    expect(res.body.staffDiscountPct).toBe(20);
    expect(res.body.staffDiscountBy).toBe('Admin User');
  });

  it('rejects a wrong admin PIN without creating the booking', async () => {
    const { prisma } = await mockDb();
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    prisma.inventoryItem.findUnique.mockResolvedValue(availableItem());
    prisma.profile.findMany.mockResolvedValue([
      { userId: 'auth-admin-id-789', name: 'Admin User', email: 'admin@example.com' },
    ]);
    const { salt, hash } = hashAdminPin('1234');
    vi.mocked(supabaseAdmin.auth.admin.getUserById).mockResolvedValue({
      data: { user: { id: 'auth-admin-id-789', user_metadata: { adminPin: { salt, hash } } } },
      error: null,
    } as never);

    const res = await bookAsStaff({ staffDiscountPct: 20, staffDiscountPin: '0000' });

    expect(res.status).toBe(401);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('ignores staff discount fields on the customer route', async () => {
    const { prisma } = await mockDb();
    prisma.inventoryItem.findUnique.mockResolvedValue(availableItem());

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', 'Bearer customer-token')
      .send({ itemId: 1, rentalDate: PICKUP, dueDate: DUE, downpayment: 1000, paymentProof: { data: Buffer.from('fake-image').toString('base64'), contentType: 'image/jpeg', reference: 'REF-123456' } });

    expect(res.status).toBe(201);
    expect(res.body.rentalFee).toBe(5000);
    expect(res.body.staffDiscountPct ?? null).toBeNull();
  });
});

describe('PUT /api/transactions/:id/swap-item — promo carry-over', () => {
  const existingTx = () => ({
    id: 'tx-swap', itemId: 1, customerId: 'customer-id-111',
    rentalDate: new Date(PICKUP), dueDate: new Date(DUE),
    rentalFee: 4500, downpayment: 1000, totalPaid: 1000, balance: 3500,
    promoCodeId: 'promo-1', size: 'L', measurements: null,
    releasePhoto: null, releasedById: null, notes: null,
    status: 'Reserved', updatedAt: new Date('2026-01-01T00:00:00Z'),
    item: { id: 1, name: 'Old Gown', status: 'Reserved', price: 5000 },
    customer: { id: 'customer-id-111', name: 'Swap Customer', email: 'swap@test.local' },
  });
  const replacement = { id: 2, name: 'New Gown', category: 'Gown', price: 6000, status: 'Available' };

  it('carries a still-valid promo onto the replacement (no use handed back)', async () => {
    const { prisma } = await mockDb();
    const existing = existingTx();
    prisma.transaction.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({
        ...existing, itemId: 2, rentalFee: 5400, balance: 4400, promoCodeId: 'promo-1',
        item: { id: 2, name: 'New Gown', category: 'Gown' },
      });
    prisma.inventoryItem.findUnique.mockResolvedValueOnce(replacement);
    prisma.promoCode.findUnique.mockResolvedValue(promoRow());

    const res = await request(app)
      .put('/api/transactions/tx-swap/swap-item')
      .set('Authorization', 'Bearer admin-token')
      .send({ newItemId: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ promoCodeId: 'promo-1', promoVoided: false, promoKept: true });
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ itemId: 2, rentalFee: 5400, promoCodeId: 'promo-1' }),
      })
    );
    // No hand-back: the use transfers with the row.
    expect(prisma.promoCode.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentUses: expect.objectContaining({ decrement: 1 }) }) })
    );
  });

  it('voids a promo that no longer validates (category mismatch) and hands the use back', async () => {
    const { prisma } = await mockDb();
    const existing = existingTx();
    prisma.transaction.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({
        ...existing, itemId: 2, rentalFee: 5500, balance: 4500, promoCodeId: null,
        item: { id: 2, name: 'New Barong', category: 'Barong' },
      });
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({ ...replacement, name: 'New Barong', category: 'Barong' });
    prisma.promoCode.findUnique.mockResolvedValue(
      promoRow({ code: 'GOWN10', appliesToCategories: ['Gown'] })
    );

    const res = await request(app)
      .put('/api/transactions/tx-swap/swap-item')
      .set('Authorization', 'Bearer admin-token')
      .send({ newItemId: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ promoCodeId: null, promoVoided: true });
    expect(prisma.promoCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentUses: expect.objectContaining({ decrement: 1 }) }) })
    );
  });
});

describe('POST /api/promo-codes/eligible — checkout voucher picker', () => {
  it('ranks eligible vouchers by savings, explains the rest, and picks the best', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findMany.mockResolvedValue([
      promoRow({ id: 'p1', code: 'TEN', discountPct: 10 }),                        // ₱500
      promoRow({ id: 'p2', code: 'FLAT800', discountPct: null, discountAmount: 800 }), // ₱800
      promoRow({ id: 'p3', code: 'BIGSPEND', minSpend: 8000 }),                     // short ₱3,000
      promoRow({ id: 'p4', code: 'SUITS', appliesToCategories: ['Suit'] }),
      promoRow({ id: 'p5', code: 'CAPPED', maxUses: 10, currentUses: 7 }),          // ₱500, 70% used
    ]);
    prisma.transaction.groupBy.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/promo-codes/eligible')
      .set('Authorization', 'Bearer customer-token')
      .send({ rentalFee: 5000, itemCategory: 'Gown' });

    expect(res.status).toBe(200);
    expect(res.body.bestCode).toBe('FLAT800');
    const byCode = Object.fromEntries(res.body.vouchers.map((v: any) => [v.code, v]));
    expect(res.body.vouchers.map((v: any) => v.code).slice(0, 3)).toEqual(['FLAT800', 'TEN', 'CAPPED']);
    expect(byCode.FLAT800).toMatchObject({ eligible: true, savings: 800, finalFee: 4200 });
    expect(byCode.BIGSPEND).toMatchObject({ eligible: false, shortfall: 3000, savings: null });
    expect(byCode.BIGSPEND.reason).toMatch(/Spend ₱3,000 more/);
    expect(byCode.SUITS).toMatchObject({ eligible: false, reason: 'For Suit only' });
    expect(byCode.CAPPED.usagePct).toBe(70);
    // Ineligible ones sort after every eligible one.
    expect(res.body.vouchers.slice(-2).map((v: any) => v.eligible)).toEqual([false, false]);
  });

  it('marks first-booking vouchers ineligible for returning customers', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findMany.mockResolvedValue([promoRow({ code: 'WELCOME', firstBookingOnly: true })]);
    prisma.transaction.groupBy.mockResolvedValue([]);
    prisma.transaction.count.mockResolvedValue(2);

    const res = await request(app)
      .post('/api/promo-codes/eligible')
      .set('Authorization', 'Bearer customer-token')
      .send({ rentalFee: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.bestCode).toBeNull();
    expect(res.body.vouchers[0]).toMatchObject({ code: 'WELCOME', eligible: false, reason: 'First booking only' });
  });

  it('returns an empty list when there are no live vouchers', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findMany.mockResolvedValue([]);
    const res = await request(app)
      .post('/api/promo-codes/eligible')
      .set('Authorization', 'Bearer customer-token')
      .send({ rentalFee: 1000 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ vouchers: [], bestCode: null });
  });
});

describe('percent voucher cap ("up to ₱X")', () => {
  it('caps a percent discount at maxDiscount', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findUnique.mockResolvedValue(promoRow({ discountPct: 20, maxDiscount: 500 }));
    const r = await checkPromo('SAVE10', 5000); // 20% = 1,000 → capped 500
    expect(r.discountAmount).toBe(500);
    expect(r.finalFee).toBe(4500);
  });

  it('leaves discounts under the cap untouched', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findUnique.mockResolvedValue(promoRow({ discountPct: 20, maxDiscount: 500 }));
    const r = await checkPromo('SAVE10', 2000); // 20% = 400 < 500
    expect(r.discountAmount).toBe(400);
  });

  it('ranks capped vouchers by their real (capped) saving in the picker', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findMany.mockResolvedValue([
      promoRow({ id: 'a', code: 'BIGPCT', discountPct: 30, maxDiscount: 300 }), // 30% of 5,000 = 1,500 → 300
      promoRow({ id: 'b', code: 'FLAT400', discountPct: null, discountAmount: 400 }),
    ]);
    prisma.transaction.groupBy.mockResolvedValue([]);
    const res = await request(app)
      .post('/api/promo-codes/eligible')
      .set('Authorization', 'Bearer customer-token')
      .send({ rentalFee: 5000 });
    expect(res.body.bestCode).toBe('FLAT400');
    expect(res.body.vouchers.find((v: any) => v.code === 'BIGPCT').savings).toBe(300);
  });

  it('admin can set a cap on create; a fixed-amount code never stores one', async () => {
    const { prisma } = await mockDb();
    await request(app).post('/api/promo-codes').set('Authorization', 'Bearer admin-token')
      .send({ code: 'CAPPED', discountPct: 15, maxDiscount: 500 });
    expect(prisma.promoCode.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ maxDiscount: 500 }) }),
    );
    await request(app).post('/api/promo-codes').set('Authorization', 'Bearer admin-token')
      .send({ code: 'FLATCAP', discountAmount: 200, maxDiscount: 500 });
    expect(prisma.promoCode.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ maxDiscount: null }) }),
    );
  });
});

describe('My Vouchers wallet (claim)', () => {
  it('claims a live voucher idempotently and marks it claimed in the public list', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findMany.mockResolvedValue([promoRow({ id: 'promo-1', code: 'SAVE10' })]);
    prisma.promoCode.findUnique.mockResolvedValue(promoRow({ id: 'promo-1', code: 'SAVE10' }));
    prisma.transaction.groupBy.mockResolvedValue([]);

    const res = await request(app).post('/api/promo-codes/claim')
      .set('Authorization', 'Bearer customer-token').send({ code: 'save10' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ code: 'SAVE10', claimed: true });
    expect(prisma.promoClaim.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ promoCodeId: 'promo-1' }),
      update: {},
    }));

    prisma.promoClaim.findMany.mockResolvedValue([{ promoCodeId: 'promo-1' }]);
    const pub = await request(app).get('/api/promo-codes/public').set('Authorization', 'Bearer customer-token');
    expect(pub.body[0]).toMatchObject({ code: 'SAVE10', claimed: true });
  });

  it('refuses to claim an expired or unknown voucher', async () => {
    const { prisma } = await mockDb();
    prisma.promoCode.findMany.mockResolvedValue([]); // not offered any more
    prisma.promoCode.findUnique.mockResolvedValue(promoRow({ code: 'OLD' }));
    const gone = await request(app).post('/api/promo-codes/claim')
      .set('Authorization', 'Bearer customer-token').send({ code: 'OLD' });
    expect(gone.status).toBe(400);

    prisma.promoCode.findUnique.mockResolvedValue(null);
    const missing = await request(app).post('/api/promo-codes/claim')
      .set('Authorization', 'Bearer customer-token').send({ code: 'NOPE' });
    expect(missing.status).toBe(404);
    expect(prisma.promoClaim.upsert).not.toHaveBeenCalled();
  });

  it('is customer-only', async () => {
    await mockDb();
    const res = await request(app).post('/api/promo-codes/claim')
      .set('Authorization', 'Bearer admin-token').send({ code: 'SAVE10' });
    expect(res.status).toBe(403);
  });

  it('lists claimed vouchers with active / used / expired status', async () => {
    const { prisma } = await mockDb();
    const past = new Date(Date.now() - 86_400_000);
    prisma.promoClaim.findMany.mockResolvedValue([
      { claimedAt: new Date(), promoCodeId: 'a', promoCode: promoRow({ id: 'a', code: 'LIVE' }) },
      { claimedAt: new Date(), promoCodeId: 'b', promoCode: promoRow({ id: 'b', code: 'SPENT' }) },
      { claimedAt: new Date(), promoCodeId: 'c', promoCode: promoRow({ id: 'c', code: 'GONE', expiresAt: past }) },
    ]);
    prisma.transaction.groupBy.mockResolvedValue([{ promoCodeId: 'b', _count: { promoCodeId: 1 } }]);
    const res = await request(app).get('/api/promo-codes/mine').set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.body.map((v: any) => [v.code, v.status])))
      .toEqual({ LIVE: 'active', SPENT: 'used', GONE: 'expired' });
  });
});
