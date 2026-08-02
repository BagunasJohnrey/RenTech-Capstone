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

export async function validateAndApply(code: string, rentalFee: number) {
  const promo = await prisma.promoCode.findUnique({ where: { code: code.toUpperCase() } });
  if (!promo) throw new AppError(404, 'Invalid promo code');
  if (!promo.isActive) throw new AppError(400, 'Promo code is no longer active');
  if (promo.expiresAt && new Date() > promo.expiresAt) throw new AppError(400, 'Promo code has expired');
  if (promo.maxUses !== null && promo.currentUses >= promo.maxUses) throw new AppError(400, 'Promo code has reached its usage limit');

  const discountAmount = Math.round(rentalFee * (promo.discountPct / 100) * 100) / 100;

  // FIX B: validation now consumes a use (previously currentUses never incremented).
  await incrementUses(promo.id);

  return {
    promoCodeId: promo.id,
    code: promo.code,
    discountPct: promo.discountPct,
    discountAmount,
    finalFee: Math.max(0, rentalFee - discountAmount),
  };
}

export async function incrementUses(id: string) {
  return prisma.promoCode.update({
    where: { id },
    data: { currentUses: { increment: 1 } },
  });
}
