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
// Cadence is CALENDAR-WEEK anchored (Manila Monday, `auto_report_last_week`
// BusinessRule holding the YYYY-MM-DD of the last completed week) instead of
// a rolling 7-day window, so every week gets exactly one report no matter
// when in the week the backend restarts. Weeks missed entirely while the
// system was down are NOT backfilled — the first tick after boot generates
// for the current week only (one catch-up, then normal cadence).
//
// Unread re-notify: when a new week runs while earlier `ai_report`
// notifications are still unread, each affected admin also gets ONE reminder
// pointing at their newest unread report (no new report row, no spam —
// reminders only fire inside the weekly run). Never throws — failures log.

export const AUTO_REPORT_WEEK_RULE = 'auto_report_last_week';
// Legacy rolling-timestamp key (pre-week-anchoring). Read once for migration
// (a recent timestamp adopts the current week so deploys don't double-run)
// and still stamped for observability; cadence no longer depends on it.
export const AUTO_REPORT_RULE = 'auto_report_last_run';
const LEGACY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const AUTO_REPORT_TYPE = 'ai_report';

// YYYY-MM-DD (Manila time) of the Monday starting the week containing `now`.
// Pure + exported for unit tests.
export function manilaWeekKey(nowMs = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(nowMs));
  const [y, m, d] = parts.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const monday = new Date(Date.UTC(y, m - 1, d - ((dow + 6) % 7)));
  return monday.toISOString().slice(0, 10);
}

function reportIdFromMessage(message: unknown): string | null {
  const m = String(message ?? '').match(/report:([A-Za-z0-9][A-Za-z0-9-_]*)/);
  return m ? m[1] : null;
}

export async function runAutoReport(now = Date.now()): Promise<{
  skipped: boolean; id?: string; deduped?: boolean; reminded?: boolean;
}> {
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
        findMany?: (args: unknown) => Promise<{ id: string; profileId: string; createdAt: Date | string; message: string }[]>;
        createMany?: (args: unknown) => Promise<unknown>;
      };
    };
    const week = manilaWeekKey(now);

    // Same calendar week already handled → nothing to do. Unread reminders
    // wait for next week's run (bounded: at most one reminder per week).
    const lastWeek = await db.businessRule?.findUnique?.({ where: { key: AUTO_REPORT_WEEK_RULE } });
    if (lastWeek?.value === week) {
      return { skipped: true };
    }
    if (!lastWeek?.value) {
      // One-time migration from the old rolling timestamp: a run within the
      // last 7 days adopts the current week instead of generating again
      // immediately after the upgrade deploy.
      const lastRun = await db.businessRule?.findUnique?.({ where: { key: AUTO_REPORT_RULE } });
      const lastAt = lastRun?.value ? Date.parse(lastRun.value) : NaN;
      if (Number.isFinite(lastAt) && now - lastAt < LEGACY_WINDOW_MS) {
        await db.businessRule?.upsert?.({
          where: { key: AUTO_REPORT_WEEK_RULE },
          update: { value: week },
          create: { key: AUTO_REPORT_WEEK_RULE, value: week, description: 'Manila-Monday week key of the last automatic weekly AI report' },
        });
        return { skipped: true };
      }
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
    // truncated) must never file history rows or ping admins. No stamp on
    // this path, so the next tick retries (saveAiReport dedupes by hash, so
    // a retry after a partial failure can't double-save).
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

    const admins = await db.profile?.findMany?.({ where: { role: 'Admin' }, select: { id: true } }) ?? [];
    // Unread snapshot BEFORE creating this week's rows, so the new
    // notification never reminds about itself.
    const unread = (await db.notification?.findMany?.({
      where: { type: AUTO_REPORT_TYPE, isRead: false },
    }) ?? []).filter((n) => admins.some((a) => a.id === n.profileId));
    const unreadByAdmin = new Map<string, typeof unread>();
    for (const n of unread) {
      const list = unreadByAdmin.get(n.profileId) ?? [];
      list.push(n);
      unreadByAdmin.set(n.profileId, list);
    }
    const newestFirst = (rows: typeof unread) =>
      [...rows].sort((a, b) => (String(a.createdAt) < String(b.createdAt) ? 1 : -1));

    const stampWeek = () => Promise.all([
      db.businessRule?.upsert?.({
        where: { key: AUTO_REPORT_WEEK_RULE },
        update: { value: week },
        create: { key: AUTO_REPORT_WEEK_RULE, value: week, description: 'Manila-Monday week key of the last automatic weekly AI report' },
      }),
      db.businessRule?.upsert?.({
        where: { key: AUTO_REPORT_RULE },
        update: { value: new Date(now).toISOString() },
        create: { key: AUTO_REPORT_RULE, value: new Date(now).toISOString(), description: 'Last successful automatic weekly AI report' },
      }),
    ]);

    // One reminder per admin with older unread report(s): points at their
    // newest unread report so the tap deep-links straight into it. Returns
    // whether any reminder went out. Exported for unit tests.
    const remindUnread = async (): Promise<boolean> => {
      if (!unreadByAdmin.size) return false;
      const rows: { profileId: string; type: string; transactionId: null; title: string; message: string }[] = [];
      for (const [profileId, notes] of unreadByAdmin) {
        const ordered = newestFirst(notes);
        const latestId = reportIdFromMessage(ordered[0]?.message);
        const count = ordered.length;
        rows.push({
          profileId,
          transactionId: null,
          type: AUTO_REPORT_TYPE,
          title: `Reminder: ${count} unread weekly report${count === 1 ? '' : 's'}`,
          message: `You still have ${count} unread weekly report${count === 1 ? '' : 's'} from earlier.` +
            (latestId ? `\nreport:${latestId}` : ''),
        });
      }
      if (!rows.length) return false;
      await db.notification?.createMany?.({ data: rows });
      return true;
    };

    // Identical content to the latest saved report → no new row and no fresh
    // "ready" ping. Admins with older unread reports still get their weekly
    // reminder (a notification, not a save — the dedupe only skips files).
    if (saved.skipped) {
      const reminded = await remindUnread();
      await stampWeek();
      try {
        const { createAuditLog } = await import('../utils/audit.js');
        await createAuditLog({
          action: 'report.auto', entity: 'ai_report', entityId: saved.id, performedById: null,
          newValue: { week, source: saved.source, deduped: true, reminded },
        });
      } catch {
        // audit is best-effort
      }
      console.log(`[AutoReport] week ${week} unchanged since ${saved.id} — reusing it${reminded ? ' + reminded unread admins' : ''}`);
      return { skipped: false, id: saved.id, deduped: true, reminded };
    }

    // Fresh report: notify every Admin in-app. The report id rides in the
    // message body as `report:<id>` (parsed by the frontend redirect); the
    // title carries the human-readable date.
    if (admins.length) {
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
    const reminded = await remindUnread();
    await stampWeek();
    try {
      const { createAuditLog } = await import('../utils/audit.js');
      await createAuditLog({
        action: 'report.auto', entity: 'ai_report', entityId: saved.id, performedById: null,
        newValue: { week, source: saved.source, provider: saved.provider, model: saved.model, reminded },
      });
    } catch {
      // audit is best-effort
    }
    console.log(`[AutoReport] week ${week} saved ${saved.id} + notified ${admins.length} admin(s)${reminded ? ' + reminded unread admins' : ''}`);
    return { skipped: false, id: saved.id, reminded };
  } catch (err) {
    console.error('[AutoReport] failed:', (err as Error)?.message ?? err);
    return { skipped: true };
  }
}
