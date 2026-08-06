import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as geminiService from '../services/gemini.service.js';
import * as dashboardService from '../services/dashboard.service.js';
import * as inventoryService from '../services/inventory.service.js';
import { AuthenticatedRequest } from '../types/index.js';

// L5: the chat history is reflected into the AI prompt, so the shape must be
// strictly controlled — only 'user'/'assistant' roles, bounded text length,
// and a cap on entries (else an attacker feeds the model infinite context).
// 'model' is accepted for older clients that sent the raw Gemini role name;
// it is normalized to 'assistant' in the service.
export const chatSchema = z.object({
  body: z.object({
    message: z.string().min(1).max(1000),
    history: z.array(z.object({
      role: z.enum(['user', 'assistant', 'model']),
      text: z.string().min(1).max(1000),
    })).max(10).optional(),
  }),
});

export async function chat(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { message, history } = req.body;
    // Ground the stylist in the live catalog so it only references real items.
    const items = await inventoryService.listItems('Available');
    const inventory = items.slice(0, 60).map(i => ({
      name: i.name,
      category: i.category,
      price: i.price,
      onSale: i.onSale,
      salePrice: i.salePrice,
    }));
    const result = await geminiService.chatWithAi(message, history, inventory);
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
