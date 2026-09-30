// Deterministic inventory-optimization rules (no AI, no new libraries).
// Same math everywhere it's shown, explainable line-by-line:
//
// - reorder point: a category whose projected demand outruns the units
//   currently free needs more pieces before peak hits.
// - clearance: idle 60+ days (or never rented at all) → put on sale / clear.
// - cleaning priority: clean the categories with the highest projected
//   demand first so ready stock meets the forecast.

export const LEAD_TIME_MONTHS = 1;
export const CLEARANCE_IDLE_DAYS = 60;
export const REORDER_UTIL_THRESHOLD = 80;

// byCategory: [{ category, projection, trend }], catBreakdown:
// { [category]: { total, rented } } from the insights payload.
export function reorderSuggestions(byCategory = [], catBreakdown = {}) {
  const out = [];
  for (const c of byCategory) {
    if (c.projection === null || c.projection === undefined) continue;
    const b = catBreakdown[c.category] || { total: 0, rented: 0 };
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

// analyticsItems: inventory-analytics rows
// ({ id, name, category, status, totalRentals, daysIdle }).
export function clearanceSuggestions(analyticsItems = [], maxResults = 5) {
  const cands = [];
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
// the pieces most likely to rent next get ready first. Items whose category
// has no projection sink to the bottom, never dropped.
export function cleaningPriority(analyticsItems = [], byCategory = []) {
  const proj = new Map((byCategory || []).map((c) => [c.category, c.projection ?? -1]));
  return (analyticsItems || [])
    .filter((it) => it.status === 'Cleaning')
    .map((it) => ({ ...it, demand: proj.has(it.category) ? proj.get(it.category) : -1 }))
    .sort((a, b) => b.demand - a.demand);
}
