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

export async function getSmsHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const history = await smsService.getSmsHistory({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });

    res.json(history);
  } catch (err) {
    next(err);
  }
}
