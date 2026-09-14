import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as geminiService from '../services/gemini.service.js';
import * as dashboardService from '../services/dashboard.service.js';
import * as inventoryService from '../services/inventory.service.js';
import { getInventoryAnalytics } from '../services/inventoryAnalytics.service.js';
import * as optimization from '../services/optimization.service.js';
import * as aiReportService from '../services/aiReport.service.js';
import type { CategoryProjection, AnalyticsItemShape } from '../services/optimization.service.js';
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
    const [kpis, insights, forecast, analytics] = await Promise.all([
      dashboardService.getKpis(),
      dashboardService.getInsights(),
      dashboardService.getForecast(3),
      getInventoryAnalytics(),
    ]);

    // Deterministic rules (same math as the frontend Smart-actions row) go
    // into the prompt as pre-computed facts: the model explains and ranks
    // them instead of freelancing contradictory advice.
    const forecastCats = (forecast as unknown as { byCategory?: CategoryProjection[] })?.byCategory;
    const breakdown = (insights as unknown as { categoryBreakdown?: Record<string, { total: number; rented: number }> })?.categoryBreakdown;
    const analyticsItems = (analytics as unknown as { items?: AnalyticsItemShape[] })?.items;
    const rules = {
      restock: optimization.reorderSuggestions(forecastCats, breakdown),
      clearance: optimization.clearanceSuggestions(analyticsItems),
      cleaning: optimization.cleaningPriority(analyticsItems, forecastCats).slice(0, 5),
    };

    const result = await geminiService.generateReport({ kpis, insights, forecast, rules });
    // Best-effort history: successful/failed-but-readable reports are saved so
    // the admin "last saved AI reports" list can reopen them. A save failure
    // must never fail the generation itself.
    if (result && typeof (result as { report?: unknown }).report === 'string') {
      try {
        const saved = await aiReportService.saveAiReport({
          report: (result as { report: string }).report,
          source: (result as { source?: string }).source ?? 'ai',
          provider: (result as { provider?: string }).provider ?? null,
          model: (result as { model?: string }).model ?? null,
          createdBy: req.user?.id ?? null,
        });
        return res.json({ ...result, reportId: saved.id });
      } catch {
        // fall through — return the report without history
      }
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listReports(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    res.json(await aiReportService.listAiReports());
  } catch (err) {
    next(err);
  }
}

export async function getReport(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    res.json(await aiReportService.getAiReport(String(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export const reportSchema = z.object({
  body: z.object({}).optional(),
});
