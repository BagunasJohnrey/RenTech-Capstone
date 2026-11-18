import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as geminiService from '../services/gemini.service.js';
import * as dashboardService from '../services/dashboard.service.js';
import * as inventoryService from '../services/inventory.service.js';
import { getInventoryAnalytics } from '../services/inventoryAnalytics.service.js';
import * as optimization from '../services/optimization.service.js';
import * as aiReportService from '../services/aiReport.service.js';
import * as aiPromoSuggestionService from '../services/aiPromoSuggestion.service.js';
import * as autoPromoService from '../services/autoPromo.service.js';
import type { CategoryProjection, AnalyticsItemShape } from '../services/optimization.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { extractEventDate, manilaToday, mentionedMonthOnly } from '../utils/stylistDates.js';

const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

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
    const context = { ...(env.RAG_ENABLED
      ? await retrieveStylistContext(message, { preferences })
      : { items: (await inventoryService.listItems('Available')).slice(0, 60).map((i: { name: string; category: string; price: number; onSale: boolean; salePrice: number | null; discountPct: number | null; colors?: string[] | null }) => ({ name: i.name, category: i.category, price: i.price, onSale: i.onSale, salePrice: i.salePrice, discountPct: i.discountPct, colors: i.colors ?? [] })), policies: [], retrieval: 'keyword' as const, groundedIn: 0 }) };
    // Relevance retrieval only returns items whose names/colors match the
    // question, so "any sale items?" got zero sale stock and the stylist said
    // it had no sale info. Always append the ACTIVE sale items (Available,
    // onSale, not past saleEndsAt) so sale questions are answerable.
    try {
      const now = Date.now();
      const have = new Set(context.items.map((i: { name: string }) => i.name));
      const sale = (await inventoryService.listItems('Available') as Array<{ name: string; category: string; price: number; onSale: boolean; salePrice: number | null; discountPct: number | null; saleEndsAt?: Date | string | null; colors?: string[] | null }>)
        .filter((i) => i.onSale && (!i.saleEndsAt || new Date(i.saleEndsAt).getTime() > now) && !have.has(i.name))
        .slice(0, 10)
        .map((i) => ({ name: i.name, category: i.category, price: i.price, onSale: true, salePrice: i.salePrice, discountPct: i.discountPct, colors: i.colors ?? [] }));
      if (sale.length) context.items = [...context.items, ...sale] as typeof context.items;
    } catch { /* sale context is best-effort */ }
    // Date-aware filtering: when the customer mentions an event date (in this
    // message, else their most recent earlier message), drop items that are
    // already booked around that date so the stylist only suggests pieces
    // that are actually free.
    let checkedDate: Date | null = null;
    let removed = 0;
    let bookedNames = new Set<string>();
    let policies = context.policies;
    // "available on dec?" names a month but no day: never fall back to an
    // older date from the conversation — ask which day instead.
    const monthOnly = mentionedMonthOnly(message);
    try {
      const userTexts = [message, ...[...(history ?? [])].reverse().filter((h: { role: string }) => h.role === 'user').map((h: { text: string }) => h.text)];
      for (const t of (monthOnly ? [] : userTexts)) { checkedDate = extractEventDate(t); if (checkedDate) break; }
      if (checkedDate && checkedDate >= manilaToday()) {
        const { names } = await inventoryService.bookedItemNamesForEvent(checkedDate);
        bookedNames = names;
        const before = context.items.length;
        context.items = context.items.filter((i: { name: string }) => !names.has(i.name)) as typeof context.items;
        removed = before - context.items.length;
        policies = [...policies, {
          key: 'event_date_availability',
          value: `The customer's event date is ${fmtDay(checkedDate)}. Every item in the inventory list was checked against existing bookings and is free for that date (pickup the day before, return the day after). Items already booked were removed — do not suggest anything not in the list.`,
        }];
      } else {
        checkedDate = null;
      }
    } catch { checkedDate = null; /* date filtering is best-effort */ }

    // Named-item check: "is the Navy Blue Sequin Gown free on Nov 21?" gets a
    // direct yes/no (same rule as the booking step) plus free alternatives in
    // the same category — answered here, so it works even if the AI is down.
    try {
      const { prisma } = await import('../config/database.js');
      const all = await prisma.inventoryItem.findMany({
        where: { status: { not: 'Deleted' } },
        select: { name: true, category: true, status: true },
      });
      const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const msg = ` ${norm(message)} `;
      let named = all
        .filter((i) => i.name && norm(i.name).length >= 5 && msg.includes(` ${norm(i.name)} `))
        .sort((a, b) => b.name.length - a.name.length)[0];
      // Follow-up to "Which day…? I'll check X": the customer's next message
      // ("december 20") only has the date, so carry the item over from the
      // stylist's last question.
      // Only when that question is the stylist's LATEST reply (the last
      // history turn) — an older one must not hijack later questions like
      // "Outfit for a Christmas party". Matched by text, not role: older chat
      // clients sent every history turn as 'user'.
      const lastTurn = (history ?? [])[(history ?? []).length - 1] as { text: string } | undefined;
      const lastBot = lastTurn && /I'll check|I can check/.test(lastTurn.text) ? lastTurn : undefined;
      const pendingItem = !named && checkedDate && lastBot && /I'll check|I can check/.test(lastBot.text)
        ? all.filter((i) => i.name && ` ${norm(lastBot.text)} `.includes(` ${norm(i.name)} `))
          .sort((a, b) => b.name.length - a.name.length)[0]
        : undefined;
      named = named ?? pendingItem;
      const asksAvailability = /\b(free|available|availability|book(ed)?|reserved|taken|pwede|bakante|meron)\b/i.test(message);
      if (named && (checkedDate || asksAvailability)) {
        let reply: string;
        let booked = false;
        if (!checkedDate) {
          reply = monthOnly
            ? `Which day in ${monthOnly} is your event? Tell me the exact date (e.g. "${monthOnly.slice(0, 3)} 20") and I'll check **${named.name}**.`
            : `I can check **${named.name}** for you. What's your event date? (e.g. "Dec 20")`;
        } else {
          const day = fmtDay(checkedDate);
          const blockedStatus = named.status === 'OutOfService' ? 'out of service right now'
            : named.status === 'Cleaning' ? 'being cleaned and not bookable yet' : null;
          booked = !!blockedStatus || bookedNames.has(named.name);
          const alts = all
            .filter((i) => i.status === 'Available' && i.name !== named.name && !bookedNames.has(i.name))
            .sort((a, b) => Number(b.category === named.category) - Number(a.category === named.category))
            .slice(0, 3);
          reply = booked
            ? `❌ **${named.name}** is not available for ${day} — it's ${blockedStatus ?? 'already booked around that date'}.`
            : `✅ **${named.name}** is free for ${day} (pickup the day before, return the day after). Tap **Book Now** to reserve it.`;
          if (alts.length) {
            reply += `\n\n${booked ? 'These are free on that date instead' : 'Other pieces free on that date'}:\n${alts.map((a) => `- ${a.name} (${a.category})`).join('\n')}`;
          }
          reply += `\n\n_Checked against bookings for ${day}. Final availability is confirmed when you book._`;
        }
        return res.json({
          reply, source: 'availability', groundedIn: 0, retrieval: 'keyword',
          ...(checkedDate ? { checkedDate: checkedDate.toISOString().slice(0, 10) } : {}),
          checkedItem: named.name, ...(booked ? { bookedItem: named.name } : {}),
        });
      }
    } catch { /* fall through to the stylist */ }
    const result = await geminiService.chatWithAi(message, history, { items: context.items, policies });
    // Every real reply says where availability stands: checked against
    // bookings for the mentioned date, or confirmed at booking otherwise.
    const AVAIL_NOTE = checkedDate
      ? `Suggestions checked against bookings for ${fmtDay(checkedDate)}. Final availability is confirmed when you book.`
      : 'Availability for your exact dates is confirmed when you book.';
    const reply = typeof result.reply === 'string' && result.reply
      && !['guardrail', 'error'].includes(result.source) && !result.reply.includes(AVAIL_NOTE)
      ? `${result.reply.trimEnd()}\n\n_${AVAIL_NOTE}_`
      : result.reply;
    res.json({
      ...result, reply, groundedIn: context.groundedIn, retrieval: context.retrieval,
      ...(checkedDate ? { checkedDate: checkedDate.toISOString().slice(0, 10), bookedExcluded: removed } : {}),
    });
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
      restock: optimization.reorderSuggestions(forecastCats, breakdown, analyticsItems),
      clearance: optimization.clearanceSuggestions(analyticsItems),
      cleaning: optimization.cleaningPriority(analyticsItems, forecastCats).slice(0, 5),
    };

    // Total-revenue window: yearly by default, all-time only when asked.
    const scope = req.body?.scope === 'overall' ? 'overall' : 'yearly';
    const year = Math.min(req.body?.year || new Date().getFullYear(), new Date().getFullYear());
    const scoped = await dashboardService.getRevenueTotals(scope, year);
    const result = await geminiService.generateReport({ kpis: { ...kpis, ...scoped }, insights, forecast, rules });
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
        return res.json({ ...result, reportId: saved.id, ...(saved.skipped ? { deduped: true } : {}) });
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
  body: z.object({
    scope: z.enum(['yearly', 'overall']).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  }).optional(),
});

export const suggestPromosSchema = z.object({
  body: z.object({}).optional(),
});

export async function suggestPromos(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    // Same generation path as the weekly scheduler (autoPromo.service).
    const { result, currentMonth } = await autoPromoService.buildPromoSuggestions();

    // Auto-save successful suggestions for history (AI or rule-based fallback)
    if (autoPromoService.isSaveable(result)) {
      try {
        const saved = await aiPromoSuggestionService.savePromoSuggestion({
          suggestions: result.suggestions,
          source: result.source,
          provider: result.provider ?? null,
          model: result.model ?? null,
          createdBy: req.user?.id ?? null,
          currentMonth,
        });
        return res.json({ ...result, suggestionId: saved.id, ...(saved.skipped ? { deduped: true } : {}) });
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
