import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as paymentProofsService from '../services/paymentProofs.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const submitProofSchema = z.object({
  body: z.object({
    // ~7.1M chars ≈ 5MB decoded; the exact byte cap is enforced on the buffer.
    data: z.string().min(1).max(7_100_000),
    contentType: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
    reference: z.string().max(40).optional(),
    channel: z.string().max(40).optional(),
  }),
});

export async function submitProof(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const proof = await paymentProofsService.submitProof(String(req.params.id), req.user.id, req.body);
    res.status(201).json({ proof });
  } catch (err) {
    next(err);
  }
}

export const approveProofSchema = z.object({
  body: z.object({ amount: z.coerce.number().positive().optional() }),
});

export const rejectProofSchema = z.object({
  body: z.object({ reason: z.string().min(5).max(300) }),
});

export async function listProofs(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    res.json(await paymentProofsService.listProofQueue(Number(req.query.limit) || 50));
  } catch (err) {
    next(err);
  }
}

export async function approveProof(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    res.json(await paymentProofsService.approveProof(String(req.params.id), req.user.id, req.body.amount));
  } catch (err) {
    next(err);
  }
}

export async function rejectProof(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    res.json(await paymentProofsService.rejectProof(String(req.params.id), req.user.id, req.body.reason));
  } catch (err) {
    next(err);
  }
}
