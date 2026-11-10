import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

export async function listPromoCodes() {
  return prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
}

// Public, read-only view of currently-usable codes (active, started, not
// expired, not exhausted). Used by the customer dashboard so shoppers can
// discover real promotions created by the admin. Exposes only shareable
// fields (no usage internals). When customerId is known, codes that customer
// has already exhausted (per-customer cap reached) are left out — offering a
// code they can no longer use is a dead end.
export async function listPublicPromoCodes(customerId?: string) {
  const now = new Date();
  const codes = await prisma.promoCode.findMany({
    where: {
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }],
    },
    orderBy: { createdAt: 'desc' },
  });
  const usable = codes.filter((c) => c.maxUses === null || c.currentUses < c.maxUses);
  let exhausted = new Set<string>();
  let claimed = new Set<string>();
  if (customerId && usable.length > 0) {
    const claims = await prisma.promoClaim.findMany({
      where: { profileId: customerId, promoCodeId: { in: usable.map((c) => c.id) } },
      select: { promoCodeId: true },
    });
    claimed = new Set(claims.map((c) => c.promoCodeId));
    const useCounts = await prisma.transaction.groupBy({
      by: ['promoCodeId'],
      where: { customerId, promoCodeId: { not: null } },
      _count: { promoCodeId: true },
    });
    exhausted = new Set(
      useCounts
        .filter((g) => {
          const code = usable.find((c) => c.id === g.promoCodeId);
          if (!code) return false;
          return (g._count?.promoCodeId ?? 0) >= (code.maxUsesPerCustomer ?? 1);
        })
        .map((g) => String(g.promoCodeId))
    );
  }
  return usable
    .filter((c) => !exhausted.has(c.id))
    .map((c) => ({
      code: c.code,
      discountPct: c.discountPct,
      discountAmount: c.discountAmount,
      maxDiscount: c.maxDiscount,
      minSpend: c.minSpend,
      startsAt: c.startsAt,
      expiresAt: c.expiresAt,
      appliesToCategories: c.appliesToCategories,
      firstBookingOnly: c.firstBookingOnly,
      usagePct: usagePct(c),
      claimed: claimed.has(c.id),
    }));
}

// Claim a voucher into the customer's "My Vouchers" wallet. Only vouchers
// the public list would offer them can be claimed (active, started, not
// expired, pool not exhausted, personal cap not reached). Idempotent:
// claiming twice is a no-op. Claiming never consumes a use.
export async function claimPromoCode(customerId: string, code: string) {
  const wanted = String(code || '').trim().toUpperCase();
  const offer = (await listPublicPromoCodes(customerId)).find((c) => c.code === wanted);
  const promo = await prisma.promoCode.findUnique({ where: { code: wanted } });
  if (!promo) throw new AppError(404, 'Voucher not found');
  if (!offer) throw new AppError(400, 'This voucher can no longer be claimed');
  await prisma.promoClaim.upsert({
    where: { profileId_promoCodeId: { profileId: customerId, promoCodeId: promo.id } },
    create: { profileId: customerId, promoCodeId: promo.id },
    update: {},
  });
  return { ...offer, claimed: true };
}

// "My Vouchers" wallet: everything the customer claimed, each with a status —
// usable now, already used up (personal cap reached), not started yet, or no
// longer valid (expired / deactivated / pool exhausted). Newest claim first.
export async function listMyVouchers(customerId: string) {
  const claims = await prisma.promoClaim.findMany({
    where: { profileId: customerId },
    include: { promoCode: true },
    orderBy: { claimedAt: 'desc' },
  });
  if (claims.length === 0) return [];
  const useCounts = await prisma.transaction.groupBy({
    by: ['promoCodeId'],
    where: { customerId, promoCodeId: { in: claims.map((c) => c.promoCodeId) } },
    _count: { promoCodeId: true },
  });
  const usedBy = new Map(useCounts.map((g) => [String(g.promoCodeId), g._count?.promoCodeId ?? 0]));
  const now = new Date();
  return claims.map(({ promoCode: c, claimedAt }) => {
    const used = (usedBy.get(c.id) ?? 0) >= (c.maxUsesPerCustomer ?? 1);
    const invalid = !c.isActive || (c.expiresAt != null && c.expiresAt <= now) ||
      (c.maxUses != null && c.currentUses >= c.maxUses);
    const notStarted = c.startsAt != null && c.startsAt > now;
    return {
      code: c.code,
      discountPct: c.discountPct,
      discountAmount: c.discountAmount,
      maxDiscount: c.maxDiscount,
      minSpend: c.minSpend,
      startsAt: c.startsAt,
      expiresAt: c.expiresAt,
      appliesToCategories: c.appliesToCategories,
      firstBookingOnly: c.firstBookingOnly,
      usagePct: usagePct(c),
      claimed: true,
      claimedAt,
      status: used ? 'used' : invalid ? 'expired' : notStarted ? 'upcoming' : 'active',
    };
  });
}

export async function getPromoCode(id: string) {
  const pc = await prisma.promoCode.findUnique({ where: { id } });
  if (!pc) throw new AppError(404, 'Promo code not found');
  return pc;
}

export async function createPromoCode(data: {
  code: string;
  discountPct?: number | null;
  discountAmount?: number | null;
  maxDiscount?: number | null;
  minSpend?: number | null;
  startsAt?: string | null;
  maxUsesPerCustomer?: number | null;
  firstBookingOnly?: boolean;
  appliesToCategories?: string[];
  maxUses?: number;
  expiresAt?: string;
}) {
  const existing = await prisma.promoCode.findUnique({ where: { code: data.code } });
  if (existing) throw new AppError(409, 'Promo code already exists');
  assertSingleDiscount(data.discountPct ?? null, data.discountAmount ?? null);

  return prisma.promoCode.create({
    data: {
      code: data.code.toUpperCase(),
      discountPct: data.discountPct ?? null,
      discountAmount: data.discountAmount ?? null,
      // A cap only means something on a percent code.
      maxDiscount: data.discountPct != null ? (data.maxDiscount ?? null) : null,
      minSpend: data.minSpend ?? null,
      startsAt: data.startsAt ? new Date(data.startsAt) : null,
      maxUsesPerCustomer: data.maxUsesPerCustomer ?? null,
      firstBookingOnly: data.firstBookingOnly ?? false,
      appliesToCategories: (data.appliesToCategories ?? []).map((c) => String(c).trim()).filter(Boolean),
      maxUses: data.maxUses ?? null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    },
  });
}

export async function updatePromoCode(id: string, data: {
  code?: string;
  discountPct?: number | null;
  discountAmount?: number | null;
  maxDiscount?: number | null;
  minSpend?: number | null;
  startsAt?: string | null;
  maxUsesPerCustomer?: number | null;
  firstBookingOnly?: boolean;
  appliesToCategories?: string[];
  maxUses?: number;
  expiresAt?: string | null;
  isActive?: boolean;
}) {
  const existing = await prisma.promoCode.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Promo code not found');
  const nextPct = data.discountPct !== undefined ? data.discountPct : existing.discountPct;
  const nextAmt = data.discountAmount !== undefined ? data.discountAmount : existing.discountAmount;
  assertSingleDiscount(nextPct, nextAmt);

  return prisma.promoCode.update({
    where: { id },
    data: {
      ...(data.code && { code: data.code.toUpperCase() }),
      ...(data.discountPct !== undefined && { discountPct: data.discountPct }),
      ...(data.discountAmount !== undefined && { discountAmount: data.discountAmount }),
      ...(data.maxDiscount !== undefined && { maxDiscount: data.maxDiscount }),
      // Switching a code to a fixed amount drops any leftover percent cap.
      ...(nextAmt != null && { maxDiscount: null }),
      ...(data.minSpend !== undefined && { minSpend: data.minSpend }),
      ...(data.startsAt !== undefined && { startsAt: data.startsAt ? new Date(data.startsAt) : null }),
      ...(data.maxUsesPerCustomer !== undefined && { maxUsesPerCustomer: data.maxUsesPerCustomer }),
      ...(data.firstBookingOnly !== undefined && { firstBookingOnly: data.firstBookingOnly }),
      ...(data.appliesToCategories !== undefined && {
        appliesToCategories: data.appliesToCategories.map((c) => String(c).trim()).filter(Boolean),
      }),
      ...(data.maxUses !== undefined && { maxUses: data.maxUses }),
      ...(data.expiresAt !== undefined && { expiresAt: data.expiresAt ? new Date(data.expiresAt) : null }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });
}

// A code carries exactly one discount shape: percent off XOR fixed pesos off.
function assertSingleDiscount(pct: number | null, amount: number | null) {
  const hasPct = pct !== null && pct !== undefined;
  const hasAmt = amount !== null && amount !== undefined;
  if (hasPct && hasAmt) throw new AppError(400, 'Set either a percent discount or a fixed amount, not both');
  if (!hasPct && !hasAmt) throw new AppError(400, 'Set a percent discount or a fixed amount');
  if (hasPct && (!(pct! > 0) || pct! > 100)) throw new AppError(400, 'Percent discount must be between 1 and 100');
  if (hasAmt && !(amount! > 0)) throw new AppError(400, 'Fixed discount amount must be greater than 0');
}

export async function deletePromoCode(id: string) {
  const existing = await prisma.promoCode.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Promo code not found');
  // Same rule as inventory items with rental history: vouchers stamped on
  // past bookings are audit trail — deactivate instead of deleting.
  const used = await prisma.transaction.count({ where: { promoCodeId: id } });
  if (used > 0) {
    throw new AppError(400, 'Promo code has booking history — deactivate it instead of deleting');
  }

  await prisma.promoCode.delete({ where: { id } });
  return { deleted: true };
}

// Peso discount a code gives on a fee: percent XOR fixed amount (legacy rows
// are percent-only), never more than the fee itself. null = no discount set.
// Percent codes honour the optional maxDiscount cap ("15% off, up to ₱500").
export function computeDiscount(
  promo: { discountPct: number | null; discountAmount: number | null; maxDiscount?: number | null },
  rentalFee: number,
): number | null {
  if (promo.discountAmount != null && promo.discountAmount > 0) {
    return Math.min(promo.discountAmount, rentalFee);
  }
  if (promo.discountPct != null && promo.discountPct > 0) {
    let off = Math.round(rentalFee * (promo.discountPct / 100) * 100) / 100;
    if (promo.maxDiscount != null && promo.maxDiscount > 0) off = Math.min(off, promo.maxDiscount);
    return Math.min(rentalFee, off);
  }
  return null;
}

// Share of a capped code's global pool already used (0–100), or null when
// uncapped. A percentage only — raw counts stay internal.
function usagePct(c: { maxUses: number | null; currentUses: number }) {
  if (c.maxUses == null || c.maxUses <= 0) return null;
  return Math.min(100, Math.round((c.currentUses / c.maxUses) * 100));
}

// Shopee/Lazada-style checkout voucher list: every voucher this customer can
// still use, each evaluated against THIS booking (fee + category). Eligible
// ones carry their savings and come first (biggest saving, then soonest
// expiry); the rest carry a human reason and, for min-spend misses, the
// shortfall. `bestCode` is the one checkout auto-applies. Read-only — the
// booking still re-runs checkPromo authoritatively inside its transaction.
export async function listEligiblePromoCodes(
  customerId: string | undefined,
  rentalFee: number,
  itemCategory?: string,
) {
  const usable = await listPublicPromoCodes(customerId);
  if (usable.length === 0) return { vouchers: [], bestCode: null };

  let hasPriorBookings = false;
  if (customerId && usable.some((c) => c.firstBookingOnly)) {
    const prior = await prisma.transaction.count({
      where: { customerId, status: { not: 'Cancelled' } },
    });
    hasPriorBookings = prior > 0;
  }

  const vouchers = usable.map((c) => {
    let reason: string | null = null;
    let shortfall: number | null = null;
    const savings = computeDiscount(c, rentalFee);
    if (savings === null) {
      reason = 'No discount set';
    } else if (c.appliesToCategories.length > 0 && itemCategory &&
        !c.appliesToCategories.map((x) => x.toLowerCase()).includes(itemCategory.toLowerCase())) {
      reason = `For ${c.appliesToCategories.join(', ')} only`;
    } else if (c.firstBookingOnly && hasPriorBookings) {
      reason = 'First booking only';
    } else if (c.minSpend != null && rentalFee < c.minSpend) {
      shortfall = Math.round((c.minSpend - rentalFee) * 100) / 100;
      reason = `Spend ₱${shortfall.toLocaleString()} more`;
    }
    const eligible = reason === null;
    return {
      ...c,
      eligible,
      reason,
      shortfall,
      savings: eligible ? savings : null,
      finalFee: eligible ? Math.max(0, Math.round((rentalFee - (savings ?? 0)) * 100) / 100) : null,
    };
  });

  const expiry = (v: { expiresAt: Date | null }) => (v.expiresAt ? new Date(v.expiresAt).getTime() : Infinity);
  vouchers.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.eligible) return (b.savings ?? 0) - (a.savings ?? 0) || expiry(a) - expiry(b);
    return (a.shortfall ?? Infinity) - (b.shortfall ?? Infinity) || expiry(a) - expiry(b);
  });
  const best = vouchers.find((v) => v.eligible && (v.savings ?? 0) > 0);
  return { vouchers, bestCode: best?.code ?? null };
}

// Read-only promo check (never consumes a use). Used by the public /validate
// endpoint and up-front in booking flows so probing codes can't drain maxUses
// or corrupt currentUses.
// Accepts a prisma client so it can run inside a caller-managed transaction.
// opts.customerId enables the advisory per-customer checks (cap + first-timer)
// so /validate stops lying: a code that would fail at submit fails here too
// (booking re-checks authoritatively with the real customer). opts.itemCategory
// enforces category scoping; opts.excludeTransactionId keeps a swap's own row
// from counting against the per-customer cap when re-validating.
type PrismaTx = Pick<typeof prisma, 'promoCode' | 'transaction'>;
export interface CheckPromoOpts {
  client?: PrismaTx;
  customerId?: string;
  itemCategory?: string;
  excludeTransactionId?: string;
}
export async function checkPromo(code: string, rentalFee: number, opts: CheckPromoOpts = {}) {
  const client = opts.client ?? prisma;
  const promo = await client.promoCode.findUnique({ where: { code: code.toUpperCase() } });
  if (!promo) throw new AppError(404, 'Invalid promo code');
  if (!promo.isActive) throw new AppError(400, 'Promo code is no longer active');
  const now = new Date();
  if (promo.startsAt && now < promo.startsAt) throw new AppError(400, 'Promo code is not valid yet');
  if (promo.expiresAt && now > promo.expiresAt) throw new AppError(400, 'Promo code has expired');
  if (promo.maxUses !== null && promo.currentUses >= promo.maxUses) throw new AppError(400, 'Promo code has reached its usage limit');
  if (promo.minSpend != null && rentalFee < promo.minSpend) {
    throw new AppError(400, `Requires a minimum rental of ₱${Number(promo.minSpend).toLocaleString()}`);
  }
  if (promo.appliesToCategories.length > 0 && opts.itemCategory) {
    const allowed = promo.appliesToCategories.map((c) => c.toLowerCase());
    if (!allowed.includes(opts.itemCategory.toLowerCase())) {
      throw new AppError(400, `Promo code is not valid for ${opts.itemCategory} items`);
    }
  }

  const discountAmount = computeDiscount(promo, rentalFee);
  if (discountAmount === null) throw new AppError(400, 'Promo code has no discount set');

  // Per-customer cap (default: once — the historical behavior).
  if (opts.customerId) {
    const limit = promo.maxUsesPerCustomer ?? 1;
    const priorUses = await client.transaction.count({
      where: {
        customerId: opts.customerId,
        promoCodeId: promo.id,
        ...(opts.excludeTransactionId ? { id: { not: opts.excludeTransactionId } } : {}),
      },
    });
    if (priorUses >= limit) {
      throw new AppError(400, limit > 1
        ? `You have already used this promo code ${limit} time${limit === 1 ? '' : 's'}`
        : 'You have already used this promo code');
    }
    if (promo.firstBookingOnly) {
      const priorBookings = await client.transaction.count({
        where: {
          customerId: opts.customerId,
          status: { not: 'Cancelled' },
          ...(opts.excludeTransactionId ? { id: { not: opts.excludeTransactionId } } : {}),
        },
      });
      if (priorBookings > 0) throw new AppError(400, 'Promo code is for first-time customers only');
    }
  }

  return {
    promoCodeId: promo.id,
    code: promo.code,
    discountPct: promo.discountPct,
    discountAmount,
    finalFee: Math.max(0, Math.round((rentalFee - discountAmount) * 100) / 100),
  };
}

// Applies (and consumes) a promo code at booking time. Enforces the
// per-customer cap so one customer can't burn an entire maxUses pool.
// NOTE: consumption is non-atomic here; booking flows should prefer
// checkPromo + consumePromoUse inside their own $transaction (see
// transactions.service.createRental). Kept for any direct callers.
export async function validateAndApply(code: string, rentalFee: number, customerId?: string) {
  const result = await checkPromo(code, rentalFee, { customerId });

  // checkPromo already enforced the cap above when customerId is known; the
  // count below is a legacy safety net for callers that skip it.
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
