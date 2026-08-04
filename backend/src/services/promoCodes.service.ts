import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

export async function listPromoCodes() {
  return prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function getPromoCode(id: string) {
  const pc = await prisma.promoCode.findUnique({ where: { id } });
  if (!pc) throw new AppError(404, 'Promo code not found');
  return pc;
}

export async function createPromoCode(data: {
  code: string;
  discountPct: number;
  maxUses?: number;
  expiresAt?: string;
}) {
  const existing = await prisma.promoCode.findUnique({ where: { code: data.code } });
  if (existing) throw new AppError(409, 'Promo code already exists');

  return prisma.promoCode.create({
    data: {
      code: data.code.toUpperCase(),
      discountPct: data.discountPct,
      maxUses: data.maxUses ?? null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    },
  });
}

export async function updatePromoCode(id: string, data: {
  code?: string;
  discountPct?: number;
  maxUses?: number;
  expiresAt?: string | null;
  isActive?: boolean;
}) {
  const existing = await prisma.promoCode.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Promo code not found');

  return prisma.promoCode.update({
    where: { id },
    data: {
      ...(data.code && { code: data.code.toUpperCase() }),
      ...(data.discountPct !== undefined && { discountPct: data.discountPct }),
      ...(data.maxUses !== undefined && { maxUses: data.maxUses }),
      ...(data.expiresAt !== undefined && { expiresAt: data.expiresAt ? new Date(data.expiresAt) : null }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });
}

export async function deletePromoCode(id: string) {
  const existing = await prisma.promoCode.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Promo code not found');

  await prisma.promoCode.delete({ where: { id } });
  return { deleted: true };
}

// Read-only promo check (never consumes a use). Used by the public /validate
// endpoint so probing codes can't drain maxUses or corrupt currentUses.
// Accepts a prisma client so it can run inside a caller-managed transaction.
type PrismaTx = Pick<typeof prisma, 'promoCode' | 'transaction'>;
export async function checkPromo(code: string, rentalFee: number, client: PrismaTx = prisma) {
  const promo = await client.promoCode.findUnique({ where: { code: code.toUpperCase() } });
  if (!promo) throw new AppError(404, 'Invalid promo code');
  if (!promo.isActive) throw new AppError(400, 'Promo code is no longer active');
  if (promo.expiresAt && new Date() > promo.expiresAt) throw new AppError(400, 'Promo code has expired');
  if (promo.maxUses !== null && promo.currentUses >= promo.maxUses) throw new AppError(400, 'Promo code has reached its usage limit');

  const discountAmount = Math.round(rentalFee * (promo.discountPct / 100) * 100) / 100;

  return {
    promoCodeId: promo.id,
    code: promo.code,
    discountPct: promo.discountPct,
    discountAmount,
    finalFee: Math.max(0, rentalFee - discountAmount),
  };
}

// Applies (and consumes) a promo code at booking time. Enforces a per-customer
// cap of one use per promo so one customer can't burn an entire maxUses pool.
// NOTE: consumption is non-atomic here; booking flows should prefer
// checkPromo + consumePromoUse inside their own $transaction (see
// transactions.service.createRental). Kept for any direct callers.
export async function validateAndApply(code: string, rentalFee: number, customerId?: string) {
  const result = await checkPromo(code, rentalFee);

  if (customerId) {
    const priorUses = await prisma.transaction.count({
      where: { customerId, promoCodeId: result.promoCodeId },
    });
    if (priorUses > 0) {
      throw new AppError(400, 'You have already used this promo code');
    }
  }

  await consumePromoUse(result.promoCodeId);

  return result;
}

// Atomically increment currentUses ONLY if still under maxUses. Prevents
// over-consumption when two bookings race the same promo code.
export async function consumePromoUse(id: string, client: PrismaTx = prisma) {
  const updated = await client.promoCode.updateMany({
    where: { id, OR: [{ maxUses: null }, { currentUses: { lt: prisma.promoCode.fields.maxUses } }] },
    data: { currentUses: { increment: 1 } },
  });
  if (updated.count === 0) {
    throw new AppError(400, 'Promo code has reached its usage limit');
  }
  return updated;
}

export async function incrementUses(id: string) {
  return prisma.promoCode.update({
    where: { id },
    data: { currentUses: { increment: 1 } },
  });
}
