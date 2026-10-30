// Revenue chart card: weekly series in Monthly view, monthly otherwise,
// with the projection bar appended. Week-over-week deltas + best-week star
// cover finished weeks only (in-progress and projection bars excluded).
// Pure presentational.
import { useRef, useEffect } from 'react';
import {
  BarChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { RevenueTooltip } from './shared';

// Above this many bars (Overall's multi-year history) a % pill on every bar
// is unreadable noise — and the first month's tiny base produced "+4800%".
// Long series keep only the ★ best marker.
const MAX_DELTA_BARS = 12;

// Per-bar annotations computed from the series: { [index]: { delta, up, best } }.
function annotationsFor(revChart) {
  const showDeltas = revChart.length <= MAX_DELTA_BARS;
  const out = {};
  const done = revChart
    .map((e, i) => ({ ...e, i }))
    .filter((e) => !e.forecast && !e.wip && e.rev > 0 && !e.tailMerged);
  if (done.length === 0) return out;
  const best = done.reduce((a, b) => (b.rev > a.rev ? b : a));
  for (let k = 1; showDeltas && k < done.length; k++) {
    const prev = done[k - 1].rev;
    const cur = done[k].rev;
    if (!(prev > 0)) continue;
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) continue;
    out[done[k].i] = { delta: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`, up: pct > 0, best: done[k].i === best.i };
  }
  if (out[best.i]) out[best.i].best = true;
  else out[best.i] = { delta: null, up: true, best: true };
  return out;
}

// Invisible Line layer whose custom dots draw the delta labels. Line dots
// live outside the bar layer, so hovering a bar no longer dims them (the
// old LabelList lived inside the bars and vanished on every hover).
// NOTE: Line dots receive cx/cy (not x/y like Bar labels) — read both.
function DeltaDot({ x, y, cx, cy, index, info }) {
  const px = cx ?? x;
  const py = cy ?? y;
  const a = info?.[index];
  if (px == null || py == null || !a || (!a.delta && !a.best)) return <g />;
  return (
    <g>
      {a.delta && (
        <text x={px} y={py - 8} textAnchor="middle" fontSize={11} fontWeight={800} fill={a.up ? '#059669' : '#ef4444'}>
          {a.delta}
        </text>
      )}
      {a.best && (
        <text x={px} y={a.delta ? py - 24 : py - 8} textAnchor="middle" fontSize={11} fontWeight={700} fill="#b45309">
          ★ best
        </text>
      )}
    </g>
  );
}

// Long monthly series (Overall) scroll sideways at a fixed width per month,
// so every month gets a label: "Oct" with the year under each January and
// under the first bar (same tick as the Demand Forecast chart).
const DENSE_BAR_W = 44;
const DENSE_X_H = 36;
function MonthTick({ x, y, payload, index }) {
  const [m, yr] = String(payload?.value ?? '').split(' ');
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fontSize={11} fill="#9ca3af">{m}</text>
      {yr && (m === 'Jan' || index === 0) && <text dy={26} textAnchor="middle" fontSize={10} fontWeight={700} fill="#6b7280">{yr}</text>}
    </g>
  );
}

// Peso Y scale: the smallest nice step covering the data in ≤5 intervals
// (₱0 · ₱200k · … · ₱800k), never an odd top tick like "₱742k". `headroom`
// leaves space for the labels above the bars.
function pesoScale(revChart, headroom) {
  const peak = Math.max(1000, ...revChart.map((e) => (e.whisker ? Math.max(e.rev, e.whisker[1]) : e.rev) || 0));
  const target = peak * headroom;
  let step = 1000;
  outer: for (let mag = 1000; mag <= 1e9; mag *= 10) {
    for (const n of [1, 2, 2.5, 5]) {
      if (Math.ceil(target / (n * mag)) <= 5) { step = n * mag; break outer; }
    }
  }
  const n = Math.ceil(target / step);
  return { domain: [0, n * step], ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
}
const peso = (v) => {
  const unit = v >= 1e6 ? 1e6 : 1000;
  const n = v / unit;
  return `₱${Number.isInteger(n) ? n : n.toFixed(1)}${unit === 1e6 ? 'M' : 'k'}`;
};

export default function RevenueChart({
  isMonthlyView, isOverall = false, monthName, appliedYear, appliedMonth,
  viewingCurrentMonth, revChart, revChartEmptyLabel, revFootnote,
  stepMonth, goCurrentMonth,
}) {
  const labels = annotationsFor(revChart);
  // Delta labels sit above the bars (up to ~32px for a stacked ★ best +
  // percent). When any exist, grow the top margin and extend the Y domain
  // so the tallest bar's labels never clip against the card edge.
  const hasLabels = Object.keys(labels).length > 0;
  const chartTop = hasLabels ? 40 : 8;
  const hasWip = revChart.some((e) => e.wip);
  const hasForecast = revChart.some((e) => e.forecast);
  const hasLogbook = revChart.some((e) => (e.logbook || 0) > 0);
  const unit = isMonthlyView ? 'week' : 'month';
  // Dense = a long multi-year series (Overall). Yearly's bare month names
  // ("Jan") and weekly "Wk 1" labels fit the card as-is.
  const dense = revChart.length > MAX_DELTA_BARS && String(revChart[0]?.label ?? '').length > 4;
  // Dense charts carry only the ★ best label above the bars, so they need
  // less headroom — and get a taller plot so bars have real height.
  const { domain, ticks } = pesoScale(revChart, dense ? 1.08 : hasLabels ? 1.18 : 1.05);
  const chartH = dense ? 360 : 280;
  const plotTop = dense ? 24 : chartTop;

  // Dense charts scroll sideways, parked at the latest month.
  const scrollRef = useRef(null);
  const seriesKey = `${revChart.length}-${revChart[0]?.full ?? ''}`;
  useEffect(() => {
    if (dense && scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [dense, seriesKey]);

  const yAxisProps = {
    domain, ticks, interval: 0, tickFormatter: peso, tickLine: false, axisLine: false, width: 52,
    tick: { fontSize: 11, fill: '#9ca3af' },
  };
  const renderChart = (hideY) => (
    <ResponsiveContainer width="100%" height={chartH}>
      <BarChart data={revChart} margin={{ top: plotTop, right: 16, bottom: 8, left: hideY ? 0 : 4 }}
        barCategoryGap={dense ? '24%' : '10%'}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis dataKey="label" tick={dense ? <MonthTick /> : { fontSize: 11, fill: '#9ca3af' }}
          tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval={0} height={dense ? DENSE_X_H : 30} />
        <YAxis {...yAxisProps} hide={hideY} width={hideY ? 0 : 52} />
        <Tooltip content={<RevenueTooltip />} cursor={{ fill: '#f3f4f6', radius: 4 }} />
        {/* Dense bars: small corner radius, more gap so bars stay distinct,
            the ★ best month in brand red, a lighter projection outline. */}
        <Bar dataKey="rev" name="Revenue" radius={dense ? [4, 4, 0, 0] : [6, 6, 0, 0]} maxBarSize={56} minPointSize={dense ? 2 : 4}>
          {revChart.map((e, i) => {
            const best = dense && labels[i]?.best;
            return (
              <Cell key={i}
                fill={e.rev <= 0 ? '#e5e7eb' : e.forecast || best ? '#bf4a53' : e.wip ? '#d1d5db' : '#1f2937'}
                fillOpacity={e.forecast ? 0.22 : e.rev <= 0 || e.wip ? 0.5 : dense && !best ? 0.85 : 1}
                stroke={e.forecast ? '#bf4a53' : 'none'}
                strokeWidth={e.forecast ? (dense ? 1.5 : 2) : 0}
                strokeDasharray={e.forecast ? (dense ? '3 2' : '4 3') : 'none'}
              />
            );
          })}
        </Bar>
        <Line type="monotone" dataKey="rev" stroke="none" dot={(p) => <DeltaDot {...p} info={labels} />} activeDot={false} legendType="none" isAnimationActive={false} />
        <ReferenceLine y={0} stroke="#e5e7eb" />
      </BarChart>
    </ResponsiveContainer>
  );

  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm lg:col-span-2 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-5 md:px-7 pt-5 md:pt-7 pb-2">
        <h3 className="font-bold text-gray-900 text-base md:text-lg">
          {isMonthlyView ? `${monthName} ${appliedYear} · Weekly Revenue` : isOverall ? 'Overall Revenue' : `${appliedYear} · Monthly Revenue`}
        </h3>
        {isMonthlyView && (
          <div className="flex items-center gap-0.5 shrink-0">
            {!viewingCurrentMonth && (
              <button onClick={goCurrentMonth}
                className="px-2.5 min-h-[32px] rounded-lg text-[11px] font-bold text-[#bf4a53] hover:bg-[#bf4a53]/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
                This month
              </button>
            )}
            <button onClick={() => stepMonth(-1)} aria-label="Previous month" title="Previous month"
              className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => stepMonth(1)} disabled={viewingCurrentMonth} aria-label="Next month" title="Next month"
              className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
      <p className="text-xs md:text-sm text-gray-400 px-5 md:px-7 pb-4">
        {isMonthlyView
          ? (viewingCurrentMonth && hasForecast
            ? 'Week-by-week revenue with the final week projected'
            : hasLogbook
              ? 'Week-by-week revenue · collected + imported logbook'
              : 'Week-by-week revenue for the selected month')
          : [`${isOverall ? 'All-time revenue' : 'Revenue'} by month${hasLogbook ? ' · collected + imported logbook' : ''}`,
              hasForecast ? 'next month projected' : null].filter(Boolean).join(' · ')}
      </p>
      {revChart.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">{revChartEmptyLabel}</p>
      ) : dense ? (
        // Fixed ₱ axis beside a horizontal scroller (same layout as the Demand
        // Forecast chart). The axis chart repeats the plot's height, margins,
        // ticks and an invisible same-height X axis so its labels line up.
        <div className="flex pl-1">
          <div style={{ width: 56 }} className="shrink-0">
            <ResponsiveContainer width="100%" height={chartH}>
              <BarChart data={revChart} margin={{ top: plotTop, right: 0, bottom: 8, left: 4 }}>
                <XAxis dataKey="label" height={DENSE_X_H} tick={false} tickLine={false} axisLine={false} />
                <YAxis {...yAxisProps} />
                <Bar dataKey="rev" fill="transparent" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto overscroll-x-contain">
            <div style={{ minWidth: revChart.length * DENSE_BAR_W }}>{renderChart(true)}</div>
          </div>
        </div>
      ) : renderChart(false)}
      <div className="flex items-center justify-center gap-4 pt-1 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-gray-800" aria-hidden="true" /> Finished {unit}
        </span>
        {dense && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-[#bf4a53]" aria-hidden="true" /> Best month
          </span>
        )}
        {hasWip && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-gray-300" aria-hidden="true" /> Still ongoing
          </span>
        )}
        {hasForecast && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded border-2 border-dashed border-[#bf4a53] bg-[#bf4a53]/20" aria-hidden="true" /> Projection
          </span>
        )}
      </div>
      {revFootnote && (
        <p className="text-[11px] text-gray-400 italic px-5 md:px-7 pt-2 pb-5">{revFootnote}</p>
      )}
      {hasWip && (
        <p className={`text-[11px] text-gray-400 italic px-5 md:px-7 ${revFootnote ? 'pt-1' : 'pt-2'} pb-5`}>
          The current {unit} is still ongoing, so it will naturally look lower.
        </p>
      )}
    </div>
  );
}
