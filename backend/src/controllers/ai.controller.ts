import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as geminiService from '../services/gemini.service.js';
import * as dashboardService from '../services/dashboard.service.js';
import { AuthenticatedRequest } from '../types/index.js';

export const chatSchema = z.object({
  body: z.object({
    message: z.string().min(1).max(1000),
    history: z.array(z.object({
      role: z.string(),
      text: z.string(),
    })).optional(),
  }),
});

export async function chat(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { message, history } = req.body;
    const result = await geminiService.chatWithAi(message, history);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function generateReport(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const [kpis, insights, forecast] = await Promise.all([
      dashboardService.getKpis(),
      dashboardService.getInsights(),
      dashboardService.getForecast(3),
    ]);

    const result = await geminiService.generateReport({ kpis, insights, forecast });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export const reportSchema = z.object({
  body: z.object({}).optional(),
});
