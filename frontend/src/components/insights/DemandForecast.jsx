// Demand forecast card: average-trend chart (monthly/weekly toggle) with
// expected-range band and spike flags, summary tiles, 3-period outlook
// table, and a deterministic plain-words explainer (no AI — every sentence
// is templated from numbers already on screen). Pure presentational — series
// math stays in parent.
import { useState, useRef, useEffect } from 'react';
import {
  ComposedChart, BarChart, Line, Bar, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceDot,
} from 'recharts';
import { CustomTooltip, CONFIDENCE_STYLES, SEASON_MARKERS, SHORT_MONTHS, fmt } from './shared';

export default function DemandForecast({
  granularity, setGranularity, loadWeeklyForecast, weeklyLoading, showingWeekly,
  activeForecast, hasSma, countChart, validSmaCount,
  forecastData, latestSmaVal, prevSmaVal, smaTrend, smaName,
  seasonDots, projections, avgPriceKnown, avgPrice,
  spikeNotes, forecastProvisional, forecastErrorPct,
}) {
  // Explainer toggle: swaps tiles + outlook table for plain words. The graph,
  // legend, and flags stay put — only the numbers get translated.
  const [explaining, setExplaining] = useState(false);
  const histMonths = activeForecast?.historyMonths ?? null;
  const projRows = (projections || []).filter((p) => p.value !== null && p.value !== undefined);
  // Weekly view: show only points where the average trend line exists (plus
  // the forecast projection). The first period-1 weeks have null SMA while
  // the window fills — their bars without a line are noise, so they are cut.
  const displayForecastData = showingWeekly && forecastData.some((d) => d.sma !== null && !d.forecast)
    ? forecastData.filter((d) => d.sma !== null || d.forecast)
    : forecastData;
  // Long series (25+ months) never squeeze: the chart keeps a readable
  // per-bar width inside a horizontal scroller, always parked at the latest
  // months. Ticks stay horizontal — no angled text.
  const scrollRef = useRef(null);
  const seriesKey = `${showingWeekly}-${displayForecastData.length}-${displayForecastData[0]?.label ?? ''}-${displayForecastData[displayForecastData.length - 1]?.label ?? ''}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [seriesKey]);
  const chartMinWidth = Math.max(560, displayForecastData.length * 48);

  // Fixed Y-axis beside the horizontal scroller: same data (invisible bars),
  // height, margins, and explicit domain as the scrolling chart, so ticks
  // always compute identically while the axis itself never scrolls away.
  const yPeak = Math.max(
    0,
    ...displayForecastData.flatMap((d) => [d.count ?? 0, d.sma ?? 0, (d.bandLo ?? 0) + (d.bandSpan ?? 0)])
  );
  const yDomain = [0, Math.max(10, Math.ceil(yPeak / 10) * 10)];
  const FixedYAxis = ({ height, top, data }) => (
    <div style={{ width: 42 }} className="shrink-0">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top, right: 0, bottom: 8, left: 4 }}>
          <YAxis domain={yDomain} tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
          <Bar dataKey="count" fill="transparent" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
  const maxProj = projRows.length > 0 ? Math.max(...projRows.map((p) => p.value)) : 0;
  const trendWord = smaTrend === 'up' ? 'rising' : smaTrend === 'down' ? 'slowing a little' : 'steady';
  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm lg:col-span-2">
      <div className="flex items-center justify-between gap-3 px-5 md:px-7 pt-5 md:pt-7 pb-2">
        <h3 className="font-bold text-gray-900 text-base md:text-lg">Demand Forecast</h3>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setExplaining((v) => !v)}
            aria-pressed={explaining}
            className={`inline-flex items-center gap-1 px-3 min-h-[32px] rounded-full text-[11px] font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60 ${
              explaining ? 'bg-gray-900 text-white' : 'bg-[#bf4a53]/10 text-[#bf4a53] hover:bg-[#bf4a53]/15'
            }`}
          >
            ✨ {explaining ? 'Show details' : 'Explain'}
          </button>
          <div role="tablist" aria-label="Forecast granularity" className="flex gap-1 bg-gray-100 rounded-xl p-1 shrink-0">
            {['monthly', 'weekly'].map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={granularity === g}
                onClick={() => { setGranularity(g); if (g === 'weekly') loadWeeklyForecast(); }}
                className={`px-3 min-h-[32px] rounded-lg text-[11px] font-bold capitalize transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60 ${
                  granularity === g ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="text-xs md:text-sm text-gray-400 px-5 md:px-7 pb-1">
        {weeklyLoading
          ? 'Loading weekly buckets…'
          : showingWeekly
            ? 'Average rental trend with weekly counts'
            : 'Average rental trend with monthly counts'}
      </p>
      {(activeForecast?.confidenceNote || forecastProvisional) && (
        <p className="px-5 md:px-7 pb-4 flex flex-wrap gap-1.5">
          {activeForecast?.confidenceNote && (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${CONFIDENCE_STYLES[activeForecast.confidence] || 'bg-gray-100 text-gray-500'}`}>
              {activeForecast.confidenceNote}
            </span>
          )}
          {forecastProvisional && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700">
              Early forecast — still learning
            </span>
          )}
        </p>
      )}
      {spikeNotes?.length > 0 && (
        <div className="px-5 md:px-7 pb-3 space-y-1">
          {spikeNotes.map((s) => (
            <p key={s.label} className="text-[11px] font-semibold text-amber-700">
              ⚠ {s.label} had a one-time spike — excluded from the average so it doesn’t inflate the forecast.
            </p>
          ))}
        </div>
      )}
      {!hasSma ? (
        <div>
          <div className="flex">
          <FixedYAxis height={230} top={8} data={countChart} />
          <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto overscroll-x-contain">
          <div style={{ minWidth: chartMinWidth }}>
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={countChart} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval={0} />
              <YAxis hide domain={yDomain} tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={0} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Rentals" radius={[4, 4, 0, 0]} maxBarSize={56} fill="#1f2937" />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
          </div>
          </div>
          <p className="text-xs text-gray-400 text-center pb-4 px-7">At least {3 - validSmaCount} more {showingWeekly ? 'weeks' : 'months'} of data needed for SMA trend.</p>
        </div>
      ) : (
        <div>
          <div className="flex">
          <FixedYAxis height={270} top={16} data={displayForecastData} />
          <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto overscroll-x-contain">
          <div style={{ minWidth: chartMinWidth }}>
          <ResponsiveContainer width="100%" height={270}>
            <ComposedChart data={displayForecastData} margin={{ top: 16, right: 16, bottom: 8, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval={0} />
              <YAxis hide domain={yDomain} tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={0} allowDecimals={false} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  // The datum straight from the hovered point — never looked
                  // up by label: month abbreviations repeat across years
                  // ("Apr" 2025 vs "Apr" 2026) and a label search always
                  // lands on the first match, showing last year's data.
                  const month = payload[0]?.payload;
                  if (!month) return null;
                  // Band areas share the payload — hide their raw math rows,
                  // but surface the range itself in plain words.
                  const rows = payload.filter((p) => p.name === 'Rentals' || p.name === smaName);
                  if (rows.length === 0) return null;
                  const hi = month && month.bandLo != null && month.bandSpan != null
                    ? Math.round((month.bandLo + month.bandSpan) * 10) / 10
                    : null;
                  return (
                    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm space-y-1">
                      <p className="font-bold text-gray-900">{month?.full || month?.label}</p>
                      {rows.map((p, i) => (
                        <p key={i} className="text-gray-600" style={{ color: p.color }}>
                          {p.name}: {p.name === smaName ? Number(p.value).toFixed(1) : p.value}
                        </p>
                      ))}
                      {hi !== null && (
                        <p className="text-gray-600">Expected range: {Number(month.bandLo).toFixed(1)}–{hi.toFixed(1)}</p>
                      )}
                      {month?.forecast && <p className="text-[11px] text-gray-400 italic">Projected</p>}
                    </div>
                  );
                }}
              />
              <Bar dataKey="count" name="Rentals" radius={[4, 4, 0, 0]} maxBarSize={48} fill="#1f2937" fillOpacity={0.35} />
              {/* Expected-range band: invisible base + visible span stack into
                  the shaded polygon behind the trend line. Zero-span when the
                  error is unknown, so nothing renders then. */}
              <Area dataKey="bandLo" stackId="band" stroke="none" fill="none" legendType="none" />
              <Area dataKey="bandSpan" name="Expected range" stackId="band" stroke="none" fill="rgba(191,74,83,.18)" legendType="none" />
              <Line type="monotone" dataKey="sma" name={smaName} stroke="#bf4a53" strokeWidth={3}
                dot={{ r: 5, fill: '#bf4a53', strokeWidth: 0 }}
                activeDot={{ r: 8, fill: '#bf4a53', stroke: '#fff', strokeWidth: 2 }}
                connectNulls={false}
              />
              {/* Season markers sit ON the trend line (sma), falling back to
                  the bar top only where the line has no point yet. */}
              {seasonDots.map((d) => (
                <ReferenceDot key={d.full} x={d.label} y={d.sma ?? d.count} r={5} fill="#bf4a53" stroke="#fff" strokeWidth={2} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          </div>
          </div>
          </div>

          <div className="flex items-center justify-center gap-4 pb-1 text-xs text-gray-700 font-semibold">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-gray-800/60" aria-hidden="true" /> Rentals
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-[3px] rounded-full bg-[#bf4a53]" aria-hidden="true" /> Average trend
            </span>
            {forecastErrorPct !== null && forecastErrorPct !== undefined && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-2.5 rounded-sm border border-[#bf4a53] bg-[#bf4a53]/25" aria-hidden="true" /> Expected range
              </span>
            )}
          </div>

          {seasonDots.length > 0 && (
            <p className="text-[11px] text-gray-400 text-center px-7 -mt-1">
              <span className="inline-block w-2 h-2 rounded-full bg-[#bf4a53] mr-1.5" aria-hidden="true" />
              {[...new Set(seasonDots.map((d) => SEASON_MARKERS[SHORT_MONTHS.indexOf(d.full.split(' ')[0])]))].join(' · ')}
            </p>
          )}

          {/* SMA Summary — hidden while explaining (the words below say it) */}
          {!explaining && (
          <>
          <div className="grid grid-cols-3 gap-2 md:gap-3 px-5 md:px-7 pb-5 md:pb-6">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-[11px] text-gray-500 font-medium">Current SMA</p>
              <p className="text-lg font-bold text-gray-900">{latestSmaVal.toFixed(1)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-[11px] text-gray-500 font-medium">Previous</p>
              <p className="text-lg font-bold text-gray-900">{prevSmaVal.toFixed(1)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-[11px] text-gray-500 font-medium">Trend</p>
              <p className={`text-lg font-bold flex items-center justify-center gap-1 ${smaTrend === 'up' ? 'text-emerald-600' : smaTrend === 'down' ? 'text-red-500' : 'text-gray-500'}`}>
                {smaTrend === 'stable' ? 'Flat' : `${Math.abs(latestSmaVal - prevSmaVal).toFixed(1)}`}
              </p>
            </div>
          </div>

          {/* 3-period outlook table (projected rentals + peso estimate) */}
          {projections.length > 0 && (
            <div className="px-5 md:px-7 pb-2 md:pb-3">
              <div className="border border-dashed border-[#bf4a53]/30 rounded-2xl overflow-hidden">
                <p className="text-[11px] font-bold text-[#bf4a53] uppercase tracking-wide px-4 pt-3">Next 3 periods · projected</p>
                <table className="w-full text-sm mt-1">
                  <thead>
                    <tr className="text-[11px] text-gray-400">
                      <th className="text-left font-semibold px-4 py-2">Period</th>
                      <th className="text-right font-semibold px-4 py-2">Rentals</th>
                      <th className="text-right font-semibold px-4 py-2">Est. revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projections.map((p) => (
                      <tr key={p.label} className="border-t border-gray-100">
                        <td className="px-4 py-2 font-semibold text-gray-800">{p.label}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-700">{p.value ?? '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-bold text-gray-900">
                          {p.value === null || p.value === undefined ? '—' : avgPriceKnown ? fmt(p.value * avgPrice) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </>)}
          {/* Plain-words explainer — deterministic template over the numbers
              already on screen (no AI call, nothing to hallucinate). */}
          {explaining && (
            <div className="mx-5 md:mx-7 mb-5 md:mb-6 rounded-2xl bg-blue-50/70 border border-blue-100 p-5 space-y-3">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">In plain words</p>
              <div className="space-y-2.5 text-sm text-gray-700 leading-relaxed">
                <p>
                  <strong className="text-gray-900">Demand is {trendWord}.</strong>{' '}
                  Recent {showingWeekly ? 'weeks' : 'months'} average {latestSmaVal.toFixed(1)} rentals,{' '}
                  {smaTrend === 'stable'
                    ? 'about the same as before.'
                    : `${smaTrend === 'up' ? 'up' : 'down'} from ${prevSmaVal.toFixed(1)} before that.`}
                  {histMonths ? ` Based on ${histMonths} month${histMonths === 1 ? '' : 's'} of history.` : ''}
                </p>
                {projRows.length > 0 && (
                  <p>
                    <strong className="text-gray-900">
                      Expect about {maxProj} rental{maxProj === 1 ? '' : 's'}
                      {projRows.length > 1 ? ` per period (${projRows.map((p) => p.label).join(', ')})` : ` in ${projRows[0].label}`}
                    </strong>
                    {avgPriceKnown && `, worth roughly ${fmt(maxProj * avgPrice)} each`}.
                  </p>
                )}
                {forecastErrorPct !== null && forecastErrorPct !== undefined && (
                  <p>
                    <strong className="text-gray-900">Take the shaded band seriously{forecastErrorPct >= 50 ? ' — it is wide' : ''}.</strong>{' '}
                    Past forecasts were off by ±{forecastErrorPct}%, so the real number could land much higher or lower. Plan stock for the top of the range, not the middle.
                  </p>
                )}
                {spikeNotes?.length > 0 && (
                  <p>
                    <strong className="text-gray-900">{spikeNotes.length === 1 ? 'That spike doesn’t count.' : 'Those spikes don’t count.'}</strong>{' '}
                    {spikeNotes.map((s) => s.label).join(', ')} {spikeNotes.length === 1 ? 'was' : 'were'} one-time bulk
                    booking{spikeNotes.length === 1 ? '' : 's'}, left out of the average — otherwise every future month would look bigger than it really is.
                  </p>
                )}
              </div>
              <div className="bg-white rounded-xl px-4 py-3 text-sm text-gray-700">
                <strong className="text-gray-900">Suggested action:</strong>{' '}
                {projRows.length > 0
                  ? `keep at least ${Math.max(1, Math.ceil(maxProj) + 2)} pieces ready per period${smaTrend === 'down' ? ', and push a promo if weekly bookings dip' : ''}.`
                  : 'collect a few more periods of bookings first — the forecast is still learning.'}
              </div>
            </div>
          )}
          <p className="text-[11px] text-gray-400 italic px-5 md:px-7 pb-5 md:pb-6">
            Counts are actual rentals; the trend line averages them
            {forecastErrorPct !== null && forecastErrorPct !== undefined ? ` — shaded band shows the expected range (±${forecastErrorPct}%, backtested)` : ''}.
          </p>
        </div>
      )}
    </div>
  );
}
