import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as promoCodesService from '../services/promoCodes.service.js';
import { createAuditLog } from '../utils/audit.js';
import { AuthenticatedRequest } from '../types/index.js';

const discountFields = {
  // Exactly one of percent / fixed amount (exclusivity refined on create;
  // update merges with the stored row and the service re-asserts).
  discountPct: z.number().min(1).max(100).nullish(),
  discountAmount: z.number().positive().max(1000000).nullish(),
};

const promoExtras = {
  minSpend: z.number().min(0).max(1000000).nullish(),
  startsAt: z.string().nullish(),
  maxUsesPerCustomer: z.number().int().positive().nullish(),
  firstBookingOnly: z.boolean().optional(),
  appliesToCategories: z.array(z.string().min(1).max(40)).max(20).optional(),
};

export const createPromoCodeSchema = z.object({
  body: z.object({
    code: z.string().min(1).max(50),
    maxUses: z.number().int().positive().optional(),
    expiresAt: z.string().optional(),
    ...discountFields,
    ...promoExtras,
  }).refine(
    (v) => (v.discountPct != null) !== (v.discountAmount != null),
    { message: 'Set either a percent discount or a fixed amount, not both/neither' }
  ),
});

export const updatePromoCodeSchema = z.object({
  body: z.object({
    code: z.string().min(1).max(50).optional(),
    maxUses: z.number().int().positive().optional(),
    expiresAt: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
    ...discountFields,
    ...promoExtras,
  }),
});

export const validatePromoCodeSchema = z.object({
  body: z.object({
    code: z.string().min(1),
    rentalFee: z.number().positive(),
    // Optional context for the advisory checks (category scope); the
    // per-customer cap always runs against the caller's own account, and the
    // booking re-checks authoritatively with the real customer.
    itemCategory: z.string().min(1).max(40).optional(),
  }),
});

export async function listPromoCodes(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const codes = await promoCodesService.listPromoCodes();
    res.json(codes);
  } catch (err) { next(err); }
}

export async function getPromoCode(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const code = await promoCodesService.getPromoCode(String(req.params.id));
    res.json(code);
  } catch (err) { next(err); }
}

export async function createPromoCode(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const code = await promoCodesService.createPromoCode(req.body);
    try {
      await createAuditLog({
        action: 'settings.promo-code.create', entity: 'promo-code',
        entityId: String((code as { id?: unknown })?.id ?? (req.body as { code?: unknown })?.code ?? ''),
        performedById: req.user?.id ?? null,
        newValue: req.body ?? {},
      });
    } catch {
      // audit is best-effort
    }
    res.status(201).json(code);
  } catch (err) { next(err); }
}

export async function updatePromoCode(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const code = await promoCodesService.updatePromoCode(String(req.params.id), req.body);
    try {
      await createAuditLog({
        action: 'settings.promo-code.update', entity: 'promo-code',
        entityId: String(req.params.id),
        performedById: req.user?.id ?? null,
        newValue: req.body ?? {},
      });
    } catch {
      // audit is best-effort
    }
    res.json(code);
  } catch (err) { next(err); }
}

export async function deletePromoCode(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const result = await promoCodesService.deletePromoCode(String(req.params.id));
    try {
      await createAuditLog({
        action: 'settings.promo-code.delete', entity: 'promo-code',
        entityId: String(req.params.id),
        performedById: req.user?.id ?? null,
      });
    } catch {
      // audit is best-effort
    }
    res.json(result);
  } catch (err) { next(err); }
}

export async function validatePromoCode(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    // Read-only check — does NOT consume a use (see promoCodes.service.checkPromo).
    // Runs the per-customer cap against the caller so a code that would fail
    // at submit fails here too (booking re-checks with the real customer).
    const result = await promoCodesService.checkPromo(req.body.code, req.body.rentalFee, {
      customerId: req.user?.id,
      itemCategory: req.body.itemCategory,
    });
    res.json(result);
  } catch (err) { next(err); }
}

// Customer-facing: only currently-usable codes, minimal fields (no usage internals).
export async function listPublicPromoCodes(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const codes = await promoCodesService.listPublicPromoCodes(req.user?.id);
    res.json(codes);
  } catch (err) { next(err); }
}
