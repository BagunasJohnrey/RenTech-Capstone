// Turns the server forecast payload into what the card draws. Pure.
//
// Chart rows: actual bars + the average line on COMPLETE periods; the period
// in progress keeps its bar (hatched, "so far") but no average point; the
// dashed projection starts at the last average point, runs through the
// in-progress period's estimate and on through every outlook row, carrying
// its expected range (projLo + projSpan, stacked into the shaded band).
import { SHORT_MONTHS, SEASON_MARKERS } from '../shared';

// "Oct 2026" → "Oct ’26": every monthly tick must be unique (recharts matches
// duplicate categories by label, so two bare "Apr"s resolved to the first).
const shortMonthYear = (l) => {
  const [m, y] = String(l || '').split(' ');
  return y ? `${m} ’${y.slice(2)}` : m || '';
};

const rangeOf = (lo, hi) => (lo == null || hi == null
  ? { projLo: null, projSpan: null }
  : { projLo: lo, projSpan: Math.max(0, Math.round((hi - lo) * 100) / 100) });

export function deriveForecast(f, weekly) {
  const labels = f?.labels || [];
  const counts = f?.counts || [];
  const sma = f?.sma || [];
  const cur = f?.current || null;
  const tick = (l) => (weekly ? l : shortMonthYear(l));

  const allRows = labels.map((l, i) => ({
    label: tick(l),
    full: l,
    count: counts[i] || 0,
    sma: sma[i] ?? null,
    proj: null,
    projLo: null,
    projSpan: null,
    ...(i === f?.partialIndex
      ? { partial: true, pace: cur?.pace ?? null, proj: cur?.projected ?? null, ...rangeOf(cur?.low, cur?.high) }
      : {}),
  }));
  // Weekly: start at the first week that has an average. The opening weeks
  // only fill the moving-average window — bars without a line are noise.
  const firstAvg = allRows.findIndex((d) => d.sma !== null);
  const rows = weekly && firstAvg > 0 ? allRows.slice(firstAvg) : allRows;
  let lastAvg = -1;
  rows.forEach((d, i) => { if (d.sma !== null && !d.partial) lastAvg = i; });
  if (lastAvg >= 0) rows[lastAvg].proj = rows[lastAvg].sma; // dashed line joins the average
  for (const p of f?.projections || []) {
    rows.push({
      label: tick(p.label),
      full: p.label,
      count: null,
      sma: null,
      proj: p.value,
      lastYear: p.seasonal ? p.lastYear : null,
      forecast: true,
      ...rangeOf(p.low, p.high),
    });
  }

  const avgs = sma.filter((v) => v !== null && v !== undefined);
  const latest = avgs.length ? avgs[avgs.length - 1] : 0;
  const prev = avgs.length >= 2 ? avgs[avgs.length - 2] : 0;
  const seasonal = !weekly && f?.projectionMethod === 'seasonal';
  // Error of the method actually projecting (seasonal backtest when it won).
  const errPct = seasonal ? f?.seasonality?.seasonalErrorPct : f?.errorPct;

  return {
    rows,
    latest,
    prev,
    trend: latest > prev ? 'up' : latest < prev ? 'down' : 'stable',
    trendPct: prev > 0 ? Math.round(((latest - prev) / prev) * 100) : null,
    hasTrend: avgs.length >= 2,
    completeCount: avgs.length,
    projections: (f?.projections || []).filter((p) => p.value !== null && p.value !== undefined),
    current: cur,
    seasonal,
    errPct: errPct ?? null,
    rangeReliable: errPct !== null && errPct !== undefined && errPct <= 100,
    // Season markers: last 12 months of observed points only.
    seasonDots: weekly ? [] : rows
      .filter((d) => !d.forecast && SEASON_MARKERS[SHORT_MONTHS.indexOf(d.full.split(' ')[0])])
      .slice(-6),
    spikeNotes: (f?.flags || []).map((x) => labels[x.index]).filter(Boolean),
  };
}
