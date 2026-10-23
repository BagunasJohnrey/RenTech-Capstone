import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as smsService from '../services/sms.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const sendSmsSchema = z.object({
  body: z.object({
    profileId: z.string(),
    message: z.string().min(1).max(1600),
    templateId: z.string().optional(),
    transactionId: z.string().optional(),
  }),
});

export async function sendManualSms(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    const result = await smsService.sendManualSms({
      profileId: req.body.profileId,
      message: req.body.message,
      sentById: req.user.id,
      templateId: req.body.templateId,
      transactionId: req.body.transactionId,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function resendSmsHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const result = await smsService.resendSms(String(req.params.id), req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function deleteSmsHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const result = await smsService.deleteSmsHistory(String(req.params.id), req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getSmsHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    // L6: clamp pagination (same caps as transactions listing).
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;
    const limit = typeof limitRaw === 'string' && Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0
      ? Math.min(Math.floor(Number(limitRaw)), 200)
      : 50;
    const offset = typeof offsetRaw === 'string' && Number.isFinite(Number(offsetRaw)) && Number(offsetRaw) > 0
      ? Math.floor(Number(offsetRaw))
      : 0;

    const history = await smsService.getSmsHistory({ limit, offset });

    res.json(history);
  } catch (err) {
    next(err);
  }
}
