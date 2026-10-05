// Demand forecast card: average-trend chart (monthly/weekly toggle) with
// expected-range band and spike flags, summary tiles, 3-period outlook
// table. Pure presentational — series math stays in parent.
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
  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm lg:col-span-2">
      <div className="flex items-center justify-between gap-3 px-5 md:px-7 pt-5 md:pt-7 pb-2">
        <h3 className="font-bold text-gray-900 text-base md:text-lg">Demand Forecast</h3>
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
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={countChart} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} angle={countChart.length > 7 ? -35 : 0} textAnchor={countChart.length > 7 ? 'end' : 'middle'} height={countChart.length > 7 ? 52 : 30} interval={0} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Rentals" radius={[4, 4, 0, 0]} maxBarSize={56} fill="#1f2937" />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-400 text-center pb-4 px-7">At least {3 - validSmaCount} more {showingWeekly ? 'weeks' : 'months'} of data needed for SMA trend.</p>
        </div>
      ) : (
        <div>
          <ResponsiveContainer width="100%" height={270}>
            <ComposedChart data={forecastData} margin={{ top: 16, right: 16, bottom: 8, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} angle={forecastData.length > 8 ? -35 : 0} textAnchor={forecastData.length > 8 ? 'end' : 'middle'} height={forecastData.length > 8 ? 52 : 30} interval={0} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const month = forecastData.find(d => d.label === label);
                  // The expected-range band areas share the tooltip payload —
                  // hide them so hover shows only real series, never raw
                  // band math.
                  const rows = payload.filter((p) => p.name === 'Rentals' || p.name === smaName);
                  if (rows.length === 0) return null;
                  return (
                    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm space-y-1">
                      <p className="font-bold text-gray-900">{month?.full || label}</p>
                      {rows.map((p, i) => (
                        <p key={i} className="text-gray-600" style={{ color: p.color }}>
                          {p.name}: {p.name === smaName ? Number(p.value).toFixed(1) : p.value}
                        </p>
                      ))}
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
              {seasonDots.map((d) => (
                <ReferenceDot key={d.full} x={d.label} y={d.count} r={5} fill="#bf4a53" stroke="#fff" strokeWidth={2} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>

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

          {/* SMA Summary */}
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
          <p className="text-[11px] text-gray-400 italic px-5 md:px-7 pb-5 md:pb-6">
            Counts are actual rentals; the trend line averages them
            {forecastErrorPct !== null && forecastErrorPct !== undefined ? ` — shaded band shows the expected range (±${forecastErrorPct}%, backtested)` : ''}.
          </p>
        </div>
      )}
    </div>
  );
}
