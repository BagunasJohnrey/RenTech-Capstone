// Forecast chart: actual bars (in-progress period hatched), average line,
// dashed projection with its expected range, season dots. A fixed Y axis sits
// beside a horizontal scroller that parks at the latest period.
import { useRef, useEffect } from 'react';
import {
  ComposedChart, Line, Bar, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceDot, Cell,
} from 'recharts';

const BRAND = '#bf4a53';
const X_AXIS_H = 36;
const r1 = (n) => Math.round(n * 10) / 10;

// Two-line month tick: "Oct", with the year underneath only on January and
// the first tick (one-line "Oct ’24" labels collided on laptop widths).
function MonthTick({ x, y, payload, index, weekly }) {
  const [m, yy] = String(payload?.value ?? '').split(' ');
  const showYear = !weekly && yy && (m === 'Jan' || index === 0);
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fontSize={11} fill="#9ca3af">{weekly ? payload?.value : m}</text>
      {showYear && <text dy={26} textAnchor="middle" fontSize={10} fontWeight={700} fill="#6b7280">{`20${yy.replace(/\D/g, '')}`}</text>}
    </g>
  );
}

function ChartTooltip({ active, payload, rangeReliable }) {
  const d = active && payload?.[0]?.payload;
  if (!d) return null;
  const range = rangeReliable && d.projLo != null && d.projSpan != null ? `${r1(d.projLo)}–${r1(d.projLo + d.projSpan)}` : null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm space-y-1 min-w-[170px]">
      <p className="font-bold text-gray-900">{d.full}</p>
      {d.partial && <p className="text-[11px] font-semibold text-amber-600">In progress</p>}
      {d.count != null && <p className="text-gray-700">{d.partial ? 'So far' : 'Rentals'}: <strong>{d.count}</strong></p>}
      {d.partial && d.pace != null && <p className="text-gray-500 text-xs">On pace for ~{Math.round(d.pace)}</p>}
      {d.sma != null && <p style={{ color: BRAND }}>Average: {d.sma.toFixed(1)}</p>}
      {(d.forecast || d.partial) && d.proj != null && (
        <p style={{ color: BRAND }}>Projected: <strong>{d.proj.toFixed(1)}</strong>{range ? ` (${range})` : ''}</p>
      )}
      {d.lastYear != null && <p className="text-gray-400 text-xs">Same month last year: {d.lastYear}</p>}
    </div>
  );
}

// Y scale: the smallest "nice" whole-number step that covers the data in at
// most 5 intervals, so the top tick hugs the peak (a 540 peak → 0–600 by
// 200; a weekly peak of 4.5 → 0–5 by 1, not 0–8).
const NICE = [1, 2, 2.5, 3, 4, 5];
function yScale(rows, rangeReliable) {
  const peak = Math.max(0, ...rows.flatMap((d) => [
    d.count ?? 0, d.sma ?? 0, d.proj ?? 0, rangeReliable ? (d.projLo ?? 0) + (d.projSpan ?? 0) : 0,
  ]));
  const target = Math.max(4, peak * 1.08);
  let step = 1;
  outer: for (let mag = 1; mag <= 1e7; mag *= 10) {
    for (const n of NICE) {
      const s = n * mag;
      if (!Number.isInteger(s)) continue;
      if (Math.ceil(target / s) <= 5) { step = s; break outer; }
    }
  }
  const n = Math.ceil(target / step);
  return { domain: [0, step * n], ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
}
const yTick = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : v);

export default function ForecastChart({ rows, weekly, rangeReliable, seasonDots, height, minBarWidth, showCurrent }) {
  // Draw-in animation once per series (first paint, monthly↔weekly), never on
  // background refreshes — the page refetches on every data change.
  const seriesKey = `${weekly}-${rows.length}-${rows[0]?.full ?? ''}`;
  const seen = useRef(null);
  const animate = seen.current !== seriesKey;
  useEffect(() => { seen.current = seriesKey; }, [seriesKey]);

  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [seriesKey]);

  const { domain, ticks } = yScale(rows, rangeReliable);
  const margin = { top: 12, right: 16, bottom: 8, left: 4 };

  return (
    <>
      <div className="flex">
        {/* Fixed Y axis: same data, height, margins, ticks and an invisible
            same-height X axis, so its labels line up with the gridlines. */}
        <div style={{ width: 42 }} className="shrink-0">
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={rows} margin={{ ...margin, right: 0 }}>
              <XAxis dataKey="label" height={X_AXIS_H} tick={false} tickLine={false} axisLine={false} />
              <YAxis domain={domain} ticks={ticks} interval={0} tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={34} allowDecimals={false} tickFormatter={yTick} />
              <Bar dataKey="count" fill="transparent" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto overscroll-x-contain">
          <div style={{ minWidth: rows.length * minBarWidth }}>
            <ResponsiveContainer width="100%" height={height}>
              <ComposedChart data={rows} margin={margin}>
                <defs>
                  <pattern id="df-partial" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill="#f59e0b" fillOpacity="0.18" />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#f59e0b" strokeWidth="2" strokeOpacity="0.55" />
                  </pattern>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="label" height={X_AXIS_H} tick={<MonthTick weekly={weekly} />} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval={0} />
                <YAxis hide domain={domain} ticks={ticks} width={0} />
                <Tooltip content={<ChartTooltip rangeReliable={rangeReliable} />} cursor={{ fill: 'rgba(17,24,39,0.04)' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={animate} animationDuration={600}>
                  {rows.map((d) => (
                    <Cell key={d.full} fill={d.partial ? 'url(#df-partial)' : '#1f2937'} fillOpacity={d.partial ? 1 : 0.3} />
                  ))}
                </Bar>
                {rangeReliable && <Area dataKey="projLo" stackId="band" stroke="none" fill="none" isAnimationActive={false} />}
                {rangeReliable && <Area dataKey="projSpan" stackId="band" stroke="none" fill={BRAND} fillOpacity={0.12} isAnimationActive={animate} animationDuration={700} />}
                <Line type="monotone" dataKey="sma" stroke={BRAND} strokeWidth={3}
                  dot={{ r: 3.5, fill: BRAND, strokeWidth: 0 }} activeDot={{ r: 6, fill: BRAND, stroke: '#fff', strokeWidth: 2 }}
                  connectNulls={false} isAnimationActive={animate} animationDuration={800} />
                <Line type="monotone" dataKey="proj" stroke={BRAND} strokeWidth={2.5} strokeDasharray="6 5"
                  // Hollow dots on projected points only; the joining point is
                  // the last real average and keeps its own dot.
                  dot={(p) => ((p.payload?.forecast || p.payload?.partial) && p.cy != null
                    ? <circle key={p.key} cx={p.cx} cy={p.cy} r={4} fill="#fff" stroke={BRAND} strokeWidth={2} />
                    : <g key={p.key} />)}
                  activeDot={{ r: 6, fill: '#fff', stroke: BRAND, strokeWidth: 2 }}
                  connectNulls isAnimationActive={animate} animationBegin={500} animationDuration={600} />
                {seasonDots.map((d) => (
                  <ReferenceDot key={d.full} x={d.label} y={d.sma ?? d.count} r={5} fill="#f59e0b" stroke="#fff" strokeWidth={2} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 pt-1 pb-4 text-[11px] text-gray-600 font-semibold">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-gray-800/40" />Rentals</span>
        {showCurrent && <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400/60" />In progress</span>}
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-[3px] rounded-full bg-[#bf4a53]" />Average</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 border-t-2 border-dashed border-[#bf4a53]" />Projected</span>
        {rangeReliable && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm bg-[#bf4a53]/15" />Expected range</span>}
        {seasonDots.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" />Season</span>}
      </div>
    </>
  );
}
