import { prisma } from '../config/database.js';
import * as dashboardService from './dashboard.service.js';
import * as geminiService from './gemini.service.js';
import * as aiPromoSuggestionService from './aiPromoSuggestion.service.js';
import { manilaWeekKey } from './autoReport.service.js';

// Promotion ideas — the ONE generation path shared by the manual
// POST /api/ai/suggest-promos button and the weekly scheduler, so both see
// the same inventory/KPI context and save into the same history.
//
// Weekly cadence mirrors autoReport.service: calendar-week anchored (Manila
// Monday, `auto_promo_last_week` BusinessRule), no backfill of missed weeks.
// Unlike the report, a failed AI run is retried at most AUTO_PROMO_MAX_ATTEMPTS
// times per week (one per hourly tick) and then the week is given up — so a
// rate-limited provider costs a handful of calls, not one every hour all week.
// The manual button is unaffected and always works.

export const AUTO_PROMO_WEEK_RULE = 'auto_promo_last_week';
export const AUTO_PROMO_TYPE = 'promo_ideas';
export const AUTO_PROMO_MAX_ATTEMPTS = 3;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export async function buildPromoSuggestions(now = new Date()) {
  const { retrievePromoContext } = await import('./rag.service.js');
  // Structured RAG: top-20 by rental-count signal (dead stock first) instead
  // of an arbitrary slice(0, 80) of newest rows. Numbers stay exact — no vectors.
  const [inventory, activePromos, kpis, insights] = await Promise.all([
    retrievePromoContext(20),
    import('./promoCodes.service.js').then(m => m.listPromoCodes()),
    dashboardService.getKpis().catch(() => ({})),
    dashboardService.getInsights().catch(() => ({})),
  ]);

  const promos = (Array.isArray(activePromos) ? activePromos : [])
    .filter((p: { isActive?: boolean }) => p.isActive !== false)
    .map((p: { code: string; discountPct: number | null; discountAmount: number | null }) => ({
      code: p.code, discountPct: p.discountPct, discountAmount: p.discountAmount,
    }));

  const currentMonth = MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear();

  // Enhanced context: KPIs + insights for smarter suggestions
  const revenueByCategory = (insights as Record<string, unknown>)?.revenueByCategory as Record<string, number> | undefined;
  const underperforming = (insights as Record<string, unknown>)?.underperforming as { name: string; category: string; rentals: number }[] | undefined;
  const topRented = (insights as Record<string, unknown>)?.topRented as { name: string; category: string; rentals: number }[] | undefined;

  const result = await geminiService.suggestPromos({
    inventory,
    activePromos: promos,
    currentMonth,
    kpis: kpis as Record<string, number | { label: string; revenue: number }[]> || {},
    revenueByCategory,
    underperforming,
    topRented,
  });
  return { result, currentMonth };
}

// Non-error results with at least one idea are worth keeping in history.
export function isSaveable(result: { source: string; suggestions: geminiService.PromoSuggestion }): boolean {
  return result.source !== 'error'
    && Boolean(result.suggestions.itemSuggestions?.length || result.suggestions.voucherSuggestions?.length);
}

// In-process attempt counter for the current week. Resets on restart, which
// at worst grants a few more tries after a deploy.
const attempts = { week: '', count: 0 };

export function resetAutoPromoAttempts() {
  attempts.week = '';
  attempts.count = 0;
}

export async function runAutoPromoSuggestions(now = Date.now()): Promise<{
  skipped: boolean; id?: string; deduped?: boolean; gaveUp?: boolean;
}> {
  try {
    const db = prisma as unknown as {
      businessRule?: {
        findUnique?: (args: unknown) => Promise<{ value?: string } | null>;
        upsert?: (args: unknown) => Promise<unknown>;
      };
      profile?: { findMany?: (args: unknown) => Promise<{ id: string }[]> };
      notification?: { createMany?: (args: unknown) => Promise<unknown> };
    };
    const week = manilaWeekKey(now);
    const last = await db.businessRule?.findUnique?.({ where: { key: AUTO_PROMO_WEEK_RULE } });
    if (last?.value === week) return { skipped: true };

    const stampWeek = () => db.businessRule?.upsert?.({
      where: { key: AUTO_PROMO_WEEK_RULE },
      update: { value: week },
      create: { key: AUTO_PROMO_WEEK_RULE, value: week, description: 'Manila-Monday week key of the last automatic weekly promotion ideas run' },
    });

    if (attempts.week !== week) { attempts.week = week; attempts.count = 0; }
    attempts.count += 1;

    let built: Awaited<ReturnType<typeof buildPromoSuggestions>> | null = null;
    try {
      built = await buildPromoSuggestions(new Date(now));
    } catch (err) {
      console.error('[AutoPromo] generation threw:', (err as Error)?.message ?? err);
    }
    if (!built || !isSaveable(built.result)) {
      if (attempts.count >= AUTO_PROMO_MAX_ATTEMPTS) {
        await stampWeek();
        console.warn(`[AutoPromo] week ${week}: no usable ideas after ${attempts.count} attempt(s) — skipping until next week`);
        return { skipped: true, gaveUp: true };
      }
      console.warn(`[AutoPromo] week ${week}: no usable ideas (attempt ${attempts.count}/${AUTO_PROMO_MAX_ATTEMPTS}) — will retry next tick`);
      return { skipped: true };
    }

    const { result, currentMonth } = built;
    const saved = await aiPromoSuggestionService.savePromoSuggestion({
      suggestions: result.suggestions,
      source: result.source,
      provider: result.provider ?? null,
      model: result.model ?? null,
      createdBy: null,
      currentMonth,
    });

    // Same ideas as last time → keep the existing history row and stay quiet.
    if (!saved.skipped) {
      const admins = await db.profile?.findMany?.({ where: { role: 'Admin' }, select: { id: true } }) ?? [];
      if (admins.length) {
        const n = (result.suggestions.itemSuggestions?.length ?? 0) + (result.suggestions.voucherSuggestions?.length ?? 0);
        await db.notification?.createMany?.({
          data: admins.map((a) => ({
            profileId: a.id,
            transactionId: null,
            type: AUTO_PROMO_TYPE,
            title: 'New promotion ideas this week',
            message: `${n} idea${n === 1 ? '' : 's'} ready: ${saved.excerpt}. Open Promotions to review.`,
          })),
        });
      }
    }
    await stampWeek();
    try {
      const { createAuditLog } = await import('../utils/audit.js');
      await createAuditLog({
        action: 'promo_ideas.auto', entity: 'promo_suggestion', entityId: saved.id, performedById: null,
        newValue: { week, source: saved.source, provider: saved.provider, model: saved.model, deduped: !!saved.skipped },
      });
    } catch {
      // audit is best-effort
    }
    console.log(`[AutoPromo] week ${week} ${saved.skipped ? `unchanged — reusing ${saved.id}` : `saved ${saved.id}`}`);
    return { skipped: false, id: saved.id, ...(saved.skipped ? { deduped: true } : {}) };
  } catch (err) {
    console.error('[AutoPromo] failed:', (err as Error)?.message ?? err);
    return { skipped: true };
  }
}
