import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as geminiService from '../services/gemini.service.js';
import * as dashboardService from '../services/dashboard.service.js';
import * as inventoryService from '../services/inventory.service.js';
import { getInventoryAnalytics } from '../services/inventoryAnalytics.service.js';
import * as optimization from '../services/optimization.service.js';
import * as aiReportService from '../services/aiReport.service.js';
import * as aiPromoSuggestionService from '../services/aiPromoSuggestion.service.js';
import type { CategoryProjection, AnalyticsItemShape } from '../services/optimization.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

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
    // Offline-first order (§8): guardrail → FAQ short-circuit BEFORE any
    // retrieval/LLM work, so refusals and policy answers cost zero queries.
    const guard = geminiService.applyGuardrails(message);
    if (guard) return res.json({ reply: guard, source: 'guardrail', groundedIn: 0, retrieval: 'keyword' });
    const faq = geminiService.findFaqAnswerWithAi(message, geminiService.isAiAvailable());
    if (faq) return res.json({ reply: faq, source: 'faq', groundedIn: 0, retrieval: 'keyword' });
    // RAG grounding: retrieve only the top-k Available items relevant to the
    // query (+ top-3 policy facts) instead of stuffing 60 rows into the
    // prompt. Falls back to keyword Tier 1 internally; never throws.
    const { retrieveStylistContext } = await import('../services/rag.service.js');
    const { env } = await import('../config/env.js');
    let preferences: string[] = [];
    try {
      if (req.user?.userId) {
        const { prisma } = await import('../config/database.js');
        const profile = await prisma.profile.findUnique({ where: { userId: req.user.userId } });
        const raw = (profile as { preferences?: string | null } | null)?.preferences;
        if (typeof raw === 'string' && raw.trim()) preferences = raw.split(',').map((p) => p.trim()).filter(Boolean);
      }
    } catch { /* preferences are a ranking hint only — never fail the chat */ }
    const context = env.RAG_ENABLED
      ? await retrieveStylistContext(message, { preferences })
      : { items: (await inventoryService.listItems('Available')).slice(0, 60).map((i: { name: string; category: string; price: number; onSale: boolean; salePrice: number | null; discountPct: number | null }) => ({ name: i.name, category: i.category, price: i.price, onSale: i.onSale, salePrice: i.salePrice, discountPct: i.discountPct })), policies: [], retrieval: 'keyword' as const, groundedIn: 0 };
    const result = await geminiService.chatWithAi(message, history, { items: context.items, policies: context.policies });
    res.json({ ...result, groundedIn: context.groundedIn, retrieval: context.retrieval });
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
    // Best-effort history: complete, readable reports are saved so
    // the admin "last saved AI reports" list can reopen them. Error stubs
    // (rate-limited / flagged / truncated) are NOT saved — they'd pollute
    // the history with one-line "showing static insights" rows. A save
    // failure must never fail the generation itself.
    if (result && typeof (result as { report?: unknown }).report === 'string'
      && (result as { source?: string }).source !== 'error') {
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

export async function retryReportUpload(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    res.json(await aiReportService.uploadExistingReport(String(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function deleteReport(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const removed = await aiReportService.deleteAiReport(String(req.params.id));
    if (!removed) throw new AppError(404, 'Report not found');
    res.json({ message: 'Report deleted' });
  } catch (err) {
    next(err);
  }
}

export const reportSchema = z.object({
  body: z.object({}).optional(),
});

export const suggestPromosSchema = z.object({
  body: z.object({}).optional(),
});

export async function suggestPromos(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { retrievePromoContext } = await import('../services/rag.service.js');
    // Structured RAG: top-20 by rental-count signal (dead stock first) instead
    // of an arbitrary slice(0, 80) of newest rows. Numbers stay exact — no vectors.
    const [inventory, activePromos, kpis, insights] = await Promise.all([
      retrievePromoContext(20),
      import('../services/promoCodes.service.js').then(m => m.listPromoCodes()),
      dashboardService.getKpis().catch(() => ({})),
      dashboardService.getInsights().catch(() => ({})),
    ]);

    const promos = (Array.isArray(activePromos) ? activePromos : [])
      .filter((p: { isActive?: boolean }) => p.isActive !== false)
      .map((p: { code: string; discountPct: number }) => ({ code: p.code, discountPct: p.discountPct }));

    const now = new Date();
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const currentMonth = monthNames[now.getMonth()] + ' ' + now.getFullYear();

    // Enhanced context: KPIs + insights for smarter suggestions
    const revenueByCategory = (insights as Record<string, unknown>)?.revenueByCategory as Record<string, number> | undefined;
    const underperforming = (insights as Record<string, unknown>)?.underperforming as { name: string; category: string; rentals: number }[] | undefined;
    const topRented = (insights as Record<string, unknown>)?.topRented as { name: string; category: string; rentals: number }[] | undefined;

    const result = await geminiService.suggestPromos({
      inventory,
      activePromos: promos,
      currentMonth,
      kpis: kpis as Record<string, number> || {},
      revenueByCategory,
      underperforming,
      topRented,
    });

    // Auto-save successful suggestions for history (AI or rule-based fallback)
    if (result.source !== 'error' && (result.suggestions.itemSuggestions?.length || result.suggestions.voucherSuggestions?.length)) {
      try {
        const saved = await aiPromoSuggestionService.savePromoSuggestion({
          suggestions: result.suggestions,
          source: result.source,
          provider: result.provider ?? null,
          model: result.model ?? null,
          createdBy: req.user?.id ?? null,
          currentMonth,
        });
        return res.json({ ...result, suggestionId: saved.id });
      } catch {
        // fall through — return suggestions without history
      }
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listSavedSuggestions(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    res.json(await aiPromoSuggestionService.listPromoSuggestions());
  } catch (err) {
    next(err);
  }
}

export async function getSavedSuggestion(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    res.json(await aiPromoSuggestionService.getPromoSuggestion(String(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function deleteSavedSuggestion(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const removed = await aiPromoSuggestionService.deletePromoSuggestion(String(req.params.id));
    if (!removed) throw new AppError(404, 'Suggestion not found');
    res.json({ message: 'Suggestion deleted' });
  } catch (err) {
    next(err);
  }
}

// Admin-only: report Tier 2 vector-index health (keyword vs hybrid mode).
export async function ragHealth(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { getRagHealth } = await import('../services/rag.service.js');
    res.json(await getRagHealth());
  } catch (err) {
    next(err);
  }
}

// Admin-only: trigger a knowledge-index rebuild (offline ingestion —
// re-embeds inventory + rules + templates into knowledge_chunks).
// Best-effort: without an embedding key or the Tier 2 DDL it reports skipped.
export async function reindex(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { runReindex } = await import('../services/reindex.service.js');
    const dryRun = String((req.query as Record<string, unknown>)?.dryRun ?? '') === 'true';
    const result = await runReindex({ dryRun });
    try {
      const { createAuditLog } = await import('../utils/audit.js');
      await createAuditLog({
        action: 'ai.reindex', entity: 'ai', entityId: 'knowledge_chunks',
        performedById: req.user?.id ?? null,
        newValue: { ...result, dryRun },
      });
    } catch { /* audit is non-critical */ }
    res.json({ ...result, dryRun });
  } catch (err) {
    next(err);
  }
}
