import { prisma } from '../config/database.js';
import * as dashboardService from './dashboard.service.js';
import { getInventoryAnalytics } from './inventoryAnalytics.service.js';
import * as optimization from './optimization.service.js';
import type { CategoryProjection, AnalyticsItemShape } from './optimization.service.js';
import * as geminiService from './gemini.service.js';
import * as aiReportService from './aiReport.service.js';

// Weekly automatic AI business report. Same generation path as the manual
// POST /api/ai/generate-report (real KPIs/insights/forecast/analytics +
// deterministic restock/clearance/cleaning rules → generateReport), then a
// fan-out in-app notification to every Admin that deep-links to the saved
// report (frontend redirects into the report modal; see NotificationsView /
// NotificationsDropdown `ai_report` handling + `rentech_open_report` hint).
//
// Cadence is guarded by the `auto_report_last_run` BusinessRule (7-day
// window, persisted so restarts never double-run — same pattern as the
// daily auto-backup). Never throws — failures only log.

export const AUTO_REPORT_RULE = 'auto_report_last_run';
export const AUTO_REPORT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const AUTO_REPORT_TYPE = 'ai_report';

export async function runAutoReport(now = Date.now()): Promise<{ skipped: boolean; id?: string; deduped?: boolean }> {
  try {
    const db = prisma as unknown as {
      businessRule?: {
        findUnique?: (args: unknown) => Promise<{ value?: string } | null>;
        upsert?: (args: unknown) => Promise<unknown>;
      };
      profile?: {
        findMany?: (args: unknown) => Promise<{ id: string }[]>;
      };
      notification?: {
        createMany?: (args: unknown) => Promise<unknown>;
      };
    };
    // Cadence guard: skip while the last successful run is inside the window.
    const last = await db.businessRule?.findUnique?.({ where: { key: AUTO_REPORT_RULE } });
    const lastAt = last?.value ? Date.parse(last.value) : NaN;
    if (Number.isFinite(lastAt) && now - lastAt < AUTO_REPORT_INTERVAL_MS) {
      return { skipped: true };
    }

    const [kpis, insights, forecast, analytics] = await Promise.all([
      dashboardService.getKpis(),
      dashboardService.getInsights(),
      dashboardService.getForecast(3),
      getInventoryAnalytics(),
    ]);

    const forecastCats = (forecast as unknown as { byCategory?: CategoryProjection[] })?.byCategory;
    const breakdown = (insights as unknown as { categoryBreakdown?: Record<string, { total: number; rented: number }> })?.categoryBreakdown;
    const analyticsItems = (analytics as unknown as { items?: AnalyticsItemShape[] })?.items;
    const rules = {
      restock: optimization.reorderSuggestions(forecastCats, breakdown),
      clearance: optimization.clearanceSuggestions(analyticsItems),
      cleaning: optimization.cleaningPriority(analyticsItems, forecastCats).slice(0, 5),
    };

    const result = await geminiService.generateReport({ kpis, insights, forecast, rules });
    // Only real AI output (`source === 'ai'`) is saved + notified. Fallback
    // stubs ("not configured") and error stubs (rate-limited / flagged /
    // truncated) must never file history rows or ping admins — the schedule
    // is for genuine weekly business reports, and a keyless dev backend
    // would otherwise spam both every 7 days.
    if (!result || typeof (result as { report?: unknown }).report !== 'string'
      || (result as { source?: string }).source !== 'ai') {
      console.warn('[AutoReport] no usable AI output (fallback/error stub) — skipping save + notify');
      return { skipped: true };
    }

    const saved = await aiReportService.saveAiReport({
      report: (result as { report: string }).report,
      source: (result as { source?: string }).source ?? 'ai',
      provider: (result as { provider?: string }).provider ?? null,
      model: (result as { model?: string }).model ?? null,
      createdBy: null,
    });

    // Stamp the run BEFORE notifying: even a deduped (unchanged-data) run
    // counts as "checked this week" — the whole point of the schedule is a
    // bounded cadence, not a new file every 7 days.
    await db.businessRule?.upsert?.({
      where: { key: AUTO_REPORT_RULE },
      update: { value: new Date(now).toISOString() },
      create: { key: AUTO_REPORT_RULE, value: new Date(now).toISOString(), description: 'Last successful automatic weekly AI report' },
    });
    try {
      const { createAuditLog } = await import('../utils/audit.js');
      await createAuditLog({
        action: 'report.auto', entity: 'ai_report', entityId: saved.id, performedById: null,
        newValue: { source: saved.source, provider: saved.provider, model: saved.model, deduped: saved.skipped ?? false },
      });
    } catch {
      // audit is best-effort
    }

    // Identical content to the latest saved report → no new row, no ping.
    // The cadence stamp above still prevents another run for 7 days.
    if (saved.skipped) {
      console.log(`[AutoReport] unchanged since ${saved.id} — reusing it, no new notification`);
      return { skipped: false, id: saved.id, deduped: true };
    }

    // Notify every Admin in-app. The report id rides in the message body as
    // `report:<id>` (parsed by the frontend redirect); the title carries the
    // human-readable date.
    const admins = await db.profile?.findMany?.({ where: { role: 'Admin' }, select: { id: true } });
    if (admins?.length) {
      const when = new Date(now).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
      await db.notification?.createMany?.({
        data: admins.map((a) => ({
          profileId: a.id,
          transactionId: null,
          type: AUTO_REPORT_TYPE,
          title: `Weekly business report — ${when}`,
          message: `Your automatic weekly report is ready.\nreport:${saved.id}`,
        })),
      });
    }
    console.log(`[AutoReport] saved ${saved.id} + notified ${admins?.length ?? 0} admin(s)`);
    return { skipped: false, id: saved.id };
  } catch (err) {
    console.error('[AutoReport] failed:', (err as Error)?.message ?? err);
    return { skipped: true };
  }
}
