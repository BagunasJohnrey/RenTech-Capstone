// Deterministic inventory-optimization rules (no AI, no new libraries).
// Backend twin of frontend/src/utils/optimization.js — keep the constants
// and semantics identical so the Smart-actions row and the AI report (which
// receives these as pre-computed facts) can never disagree. Rule outputs
// contain NO peso amounts on purpose: the AI amount-guard only accepts ₱
// figures present in the Data JSON, and these are unit/day counts.

export const LEAD_TIME_MONTHS = 1;
export const CLEARANCE_IDLE_DAYS = 60;
export const REORDER_UTIL_THRESHOLD = 80;

export interface CategoryProjection {
  category: string;
  projection: number | null;
  trend: 'up' | 'down' | 'flat';
}

export interface AnalyticsItemShape {
  id: number;
  name: string;
  category: string;
  status: string;
  totalRentals: number;
  daysIdle: number | null;
}

// Statuses that make a piece unavailable for the next rental right now.
// Cleaning counts as free: it is back on the rack within the lead time.
const NOT_FREE_STATUSES = new Set(['Rented', 'Reserved', 'OutOfService']);

// Live per-category stock from the analytics rows ({ total, out }). This is
// the honest "free units" source: `catBreakdown.rented` counts pieces rented
// at least once in the selected window, which is history, not availability.
export function liveStockByCategory(analyticsItems: AnalyticsItemShape[] = []) {
  const out: Record<string, { total: number; out: number }> = {};
  for (const it of analyticsItems || []) {
    if (it.status === 'Deleted') continue;
    const s = (out[it.category] ||= { total: 0, out: 0 });
    s.total++;
    if (NOT_FREE_STATUSES.has(it.status)) s.out++;
  }
  return out;
}

// A category whose projected demand outruns the units currently free needs
// more pieces before peak hits. `analyticsItems` (optional) supplies live
// stock; without it the window breakdown is used as before.
export function reorderSuggestions(
  byCategory: CategoryProjection[] = [],
  catBreakdown: Record<string, { total: number; rented: number }> = {},
  analyticsItems?: AnalyticsItemShape[]
) {
  const live = analyticsItems && analyticsItems.length ? liveStockByCategory(analyticsItems) : null;
  const out: {
    category: string;
    projection: number;
    freeUnits: number;
    shortfall: number;
    util: number;
    reason: string;
  }[] = [];
  for (const c of byCategory) {
    if (c.projection === null || c.projection === undefined) continue;
    const l = live?.[c.category];
    const b = l ? { total: l.total, rented: l.out } : (catBreakdown[c.category] || { total: 0, rented: 0 });
    const freeUnits = Math.max(0, (b.total || 0) - (b.rented || 0));
    const shortfall = Math.ceil(c.projection * LEAD_TIME_MONTHS - freeUnits);
    const util = b.total > 0 ? Math.round(((b.rented || 0) / b.total) * 100) : 0;
    if (shortfall > 0 && (util >= REORDER_UTIL_THRESHOLD || c.trend === 'up')) {
      out.push({
        category: c.category,
        projection: c.projection,
        freeUnits,
        shortfall,
        util,
        reason: util >= REORDER_UTIL_THRESHOLD
          ? `${util}% of units already out`
          : 'demand trending up',
      });
    }
  }
  return out.sort((a, b) => b.shortfall - a.shortfall);
}

// Idle 60+ days (or never rented at all) → put on sale / clear.
export function clearanceSuggestions(
  analyticsItems: AnalyticsItemShape[] = [],
  maxResults = 5
) {
  const cands: (AnalyticsItemShape & { idleDays: number | null; reason: string })[] = [];
  for (const it of analyticsItems) {
    if (it.status === 'Deleted' || it.status === 'OutOfService') continue;
    if ((it.totalRentals || 0) === 0) {
      cands.push({ ...it, idleDays: null, reason: 'never rented' });
    } else if (it.daysIdle !== null && it.daysIdle !== undefined && it.daysIdle >= CLEARANCE_IDLE_DAYS) {
      cands.push({ ...it, idleDays: it.daysIdle, reason: `idle ${it.daysIdle}d` });
    }
  }
  cands.sort((a, b) => {
    if (a.idleDays === null && b.idleDays === null) return 0;
    if (a.idleDays === null) return -1;
    if (b.idleDays === null) return 1;
    return b.idleDays - a.idleDays;
  });
  return cands.slice(0, maxResults);
}

// Cleaning queue ordered by projected category demand (highest first) so
// the pieces most likely to rent next get ready first.
export function cleaningPriority(
  analyticsItems: AnalyticsItemShape[] = [],
  byCategory: CategoryProjection[] = []
) {
  const proj = new Map((byCategory || []).map((c) => [c.category, c.projection ?? -1]));
  return (analyticsItems || [])
    .filter((it) => it.status === 'Cleaning')
    .map((it) => ({ ...it, demand: proj.has(it.category) ? (proj.get(it.category) as number) : -1 }))
    .sort((a, b) => b.demand - a.demand);
}
