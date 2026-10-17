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
