import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as promoCodesService from '../services/promoCodes.service.js';
import { AuthenticatedRequest } from '../types/index.js';

export const createPromoCodeSchema = z.object({
  body: z.object({
    code: z.string().min(1).max(50),
    discountPct: z.number().min(1).max(100),
    maxUses: z.number().int().positive().optional(),
    expiresAt: z.string().optional(),
  }),
});

export const updatePromoCodeSchema = z.object({
  body: z.object({
    code: z.string().min(1).max(50).optional(),
    discountPct: z.number().min(1).max(100).optional(),
    maxUses: z.number().int().positive().optional(),
    expiresAt: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const validatePromoCodeSchema = z.object({
  body: z.object({
    code: z.string().min(1),
    rentalFee: z.number().positive(),
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
    res.status(201).json(code);
  } catch (err) { next(err); }
}

export async function updatePromoCode(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const code = await promoCodesService.updatePromoCode(String(req.params.id), req.body);
    res.json(code);
  } catch (err) { next(err); }
}

export async function deletePromoCode(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const result = await promoCodesService.deletePromoCode(String(req.params.id));
    res.json(result);
  } catch (err) { next(err); }
}

export async function validatePromoCode(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    // Read-only check — does NOT consume a use (see promoCodes.service.checkPromo).
    const result = await promoCodesService.checkPromo(req.body.code, req.body.rentalFee);
    res.json(result);
  } catch (err) { next(err); }
}

// Customer-facing: only currently-usable codes, minimal fields (no usage internals).
export async function listPublicPromoCodes(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const codes = await promoCodesService.listPublicPromoCodes();
    res.json(codes);
  } catch (err) { next(err); }
}
