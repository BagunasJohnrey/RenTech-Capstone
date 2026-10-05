// Revenue chart card: weekly series in Monthly view, monthly otherwise,
// with the projection bar appended. Week-over-week deltas + best-week star
// cover finished weeks only (in-progress and projection bars excluded).
// Pure presentational.
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine, ErrorBar, LabelList,
} from 'recharts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { RevenueTooltip } from './shared';

// Per-bar annotations computed from the series: { [index]: { delta, up, best } }.
function annotationsFor(revChart) {
  const out = {};
  const done = revChart
    .map((e, i) => ({ ...e, i }))
    .filter((e) => !e.forecast && !e.wip && e.rev > 0);
  if (done.length === 0) return out;
  const best = done.reduce((a, b) => (b.rev > a.rev ? b : a));
  for (let k = 1; k < done.length; k++) {
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

function DeltaLabel({ x, y, width, index, info }) {
  const a = info?.[index];
  if (!a || (!a.delta && !a.best)) return null;
  const cx = x + width / 2;
  return (
    <g>
      {a.delta && (
        <text x={cx} y={y - 8} textAnchor="middle" fontSize={11} fontWeight={800} fill={a.up ? '#059669' : '#ef4444'}>
          {a.delta}
        </text>
      )}
      {a.best && (
        <text x={cx} y={(a.delta ? y - 24 : y - 8)} textAnchor="middle" fontSize={11} fontWeight={700} fill="#b45309">
          ★ best
        </text>
      )}
    </g>
  );
}

export default function RevenueChart({
  isMonthlyView, monthName, appliedYear, appliedMonth,
  viewingCurrentMonth, revChart, revChartEmptyLabel, revFootnote,
  stepMonth, goCurrentMonth,
}) {
  const labels = annotationsFor(revChart);
  const hasWip = revChart.some((e) => e.wip);
  const hasForecast = revChart.some((e) => e.forecast);
  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm lg:col-span-2 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-5 md:px-7 pt-5 md:pt-7 pb-2">
        <h3 className="font-bold text-gray-900 text-base md:text-lg">
          {isMonthlyView ? `${monthName} ${appliedYear} · Weekly Revenue` : 'Monthly Revenue'}
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
          ? (viewingCurrentMonth ? 'Week-by-week revenue with next week projection' : 'Week-by-week revenue for the selected month')
          : 'Revenue trend with next month projection'}
      </p>
      {revChart.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">{revChartEmptyLabel}</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={revChart} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval={0} angle={revChart.length > 7 ? -35 : 0} textAnchor={revChart.length > 7 ? 'end' : 'middle'} height={revChart.length > 7 ? 56 : 30} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `₱${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={52} />
            <Tooltip content={<RevenueTooltip />} cursor={{ fill: '#f9fafb' }} />
            <Bar dataKey="rev" name="Revenue" radius={[6, 6, 0, 0]} maxBarSize={56} minPointSize={4}>
              {revChart.map((e, i) => (
                <Cell key={i}
                  fill={e.rev <= 0 ? '#e5e7eb' : e.forecast ? '#bf4a53' : e.wip ? '#d1d5db' : '#1f2937'}
                  fillOpacity={e.forecast ? 0.22 : e.rev <= 0 || e.wip ? 0.5 : 1}
                  stroke={e.forecast ? '#bf4a53' : 'none'}
                  strokeWidth={e.forecast ? 2 : 0}
                  strokeDasharray={e.forecast ? '4 3' : 'none'}
                />
              ))}
              <LabelList dataKey="rev" content={(props) => <DeltaLabel {...props} info={labels} />} />
              <ErrorBar dataKey="whisker" width={10} strokeWidth={2} stroke="#bf4a53" />
            </Bar>
            <ReferenceLine y={0} stroke="#e5e7eb" />
          </BarChart>
        </ResponsiveContainer>
      )}
      <div className="flex items-center justify-center gap-4 pt-1 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-gray-800" aria-hidden="true" /> Finished week
        </span>
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
          The current week is still ongoing, so it will naturally look lower.
        </p>
      )}
    </div>
  );
}
