import { describe, it, expect } from 'vitest';
import { seasonalProjection } from '../src/services/dashboard.service.js';
import { sma } from '../src/utils/sma.js';

// Jan 2024 → Apr 2026 (28 months); "now" is Apr 15 2026, so April is the
// partial current month and March is the last complete one.
const NOW = new Date(2026, 3, 15);
const months = Array.from({ length: 28 }, (_, i) => ({ year: 2024 + Math.floor(i / 12), month: (i % 12) + 1 }));
const next = [
  { label: 'May 2026', year: 2026, month: 5 },
  { label: 'Jun 2026', year: 2026, month: 6 },
  { label: 'Jul 2026', year: 2026, month: 7 },
];
// Strong calendar pattern: May peak, Dec rush, everything else quiet.
const PATTERN = [10, 10, 20, 10, 30, 10, 10, 10, 10, 10, 20, 40];
const seasonalCounts = months.map((m) => PATTERN[m.month - 1]);

describe('seasonalProjection', () => {
  it('uses the seasonal blend when it backtests better than the flat average', () => {
    const smaVals = sma(seasonalCounts, 3);
    const out = seasonalProjection(seasonalCounts, months, smaVals, new Set(), next, NOW);

    expect(out.used).toBe(true);
    expect(out.growth).toBe(1); // same pattern every year → no growth
    expect(out.backtestPoints).toBeGreaterThanOrEqual(3);
    expect(out.seasonalErrorPct!).toBeLessThan(out.smaErrorPct!);
    // base = last SMA (Feb–Apr 2026 = 13.33); May = 0.5·13.33 + 0.5·30 = 21.7
    expect(out.projections[0]).toMatchObject({ label: 'May 2026', value: 21.7, lastYear: 30, seasonal: true });
    // June is quiet last year → the projection drops below the flat average.
    expect(out.projections[1].value).toBeLessThan(out.projections[0].value!);
  });

  it('stays flat when there is no seasonality to beat the average', () => {
    const flat = months.map(() => 20);
    const out = seasonalProjection(flat, months, sma(flat, 3), new Set(), next, NOW);
    expect(out.used).toBe(false);
    expect(out.projections.map((p) => p.value)).toEqual([20, 20, 20]);
    expect(out.projections.every((p) => !p.seasonal)).toBe(true);
  });

  it('stays flat with under ~15 months of history (no year-ago data to test)', () => {
    const short = months.slice(-10);
    const counts = short.map((m) => PATTERN[m.month - 1]);
    const out = seasonalProjection(counts, short, sma(counts, 3), new Set(), next, NOW);
    expect(out.used).toBe(false);
    expect(out.backtestPoints).toBe(0);
  });

  it('never copies a spike-flagged month forward', () => {
    const smaVals = sma(seasonalCounts, 3);
    const may2025 = months.findIndex((m) => m.year === 2025 && m.month === 5);
    const out = seasonalProjection(seasonalCounts, months, smaVals, new Set([may2025]), next, NOW);
    expect(out.used).toBe(true);
    // May falls back to the flat average; June still blends.
    expect(out.projections[0]).toMatchObject({ value: 13.3, seasonal: false });
    expect(out.projections[1].seasonal).toBe(true);
  });

  it('scales last year by recent growth', () => {
    // Second year runs at 1.5× the first, from Jan 2025 on.
    const grown = months.map((m) => PATTERN[m.month - 1] * (m.year >= 2025 ? 1.5 : 1));
    const out = seasonalProjection(grown, months, sma(grown, 3), new Set(), next, NOW);
    // Jan–Mar 2026 vs Jan–Mar 2025 are both at 1.5× → growth 1 (it's the
    // YEAR-OVER-YEAR change of the latest window, not lifetime growth).
    expect(out.growth).toBe(1);
    const grown2 = months.map((m) => PATTERN[m.month - 1] * (m.year >= 2026 ? 1.5 : 1));
    const out2 = seasonalProjection(grown2, months, sma(grown2, 3), new Set(), next, NOW);
    expect(out2.growth).toBe(1.5);
  });
});
