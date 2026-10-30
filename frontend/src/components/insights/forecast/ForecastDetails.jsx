// Detail blocks under the chart. The card shows only the outlook table; the
// full view adds the seasonal pattern and the categories driving demand.
import { SHORT_MONTHS, fmt } from '../shared';

const BOX = 'rounded-2xl border border-gray-100';
const HEAD = 'text-[11px] font-bold uppercase tracking-wide';

export function OutlookTable({ projections, weekly, avgPriceKnown, avgPrice, seasonality, showMethodNote }) {
  if (projections.length === 0) return null;
  return (
    <div className={`${BOX} overflow-hidden`}>
      <p className={`${HEAD} text-[#bf4a53] px-4 pt-3`}>Next {projections.length} {weekly ? 'weeks' : 'months'}</p>
      <table className="w-full text-sm mt-1">
        <thead>
          <tr className="text-[11px] text-gray-400">
            <th className="text-left font-semibold px-4 py-1.5">Period</th>
            <th className="text-right font-semibold px-4 py-1.5">Rentals</th>
            {!weekly && <th className="text-right font-semibold px-4 py-1.5">Est. revenue</th>}
          </tr>
        </thead>
        <tbody>
          {projections.map((p) => (
            <tr key={p.label} className="border-t border-gray-50">
              <td className="px-4 py-2">
                <span className="font-semibold text-gray-800">{p.label}</span>
                {p.seasonal && p.lastYear != null && <span className="block text-[10px] text-gray-400">last year {p.lastYear}</span>}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                <span className="font-bold text-gray-900">{p.value.toFixed(1)}</span>
                {p.low != null && <span className="block text-[10px] text-gray-400">{Math.round(p.low)}–{Math.round(p.high)}</span>}
              </td>
              {!weekly && (
                <td className="px-4 py-2 text-right tabular-nums font-bold text-gray-900">{avgPriceKnown ? fmt(p.value * avgPrice) : '—'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {showMethodNote && seasonality?.seasonalErrorPct != null && seasonality?.averageErrorPct != null && (
        <p className="text-[11px] text-gray-500 px-4 py-2.5 bg-gray-50/70 border-t border-gray-100 leading-relaxed">
          Seasonal blend chosen: on past months it missed by ~{seasonality.seasonalErrorPct}% vs ~{seasonality.averageErrorPct}% for the plain average
          {seasonality.growth != null && seasonality.growth !== 1 ? ` · last year ×${seasonality.growth} for growth` : ''}.
        </p>
      )}
    </div>
  );
}

// Weekly full view: the next weeks as a row of cards across the full width
// (weeks have no seasonal pattern or category split to sit beside a table).
export function OutlookCards({ projections }) {
  if (projections.length === 0) return null;
  return (
    <div>
      <p className={`${HEAD} text-[#bf4a53] mb-2`}>Next {projections.length} weeks</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {projections.map((p, i) => (
          <div key={p.label} className={`${BOX} p-4`}>
            <p className="text-xs font-semibold text-gray-500">Week of {p.label}{i === 0 ? ' · next' : ''}</p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums mt-1.5">{p.value.toFixed(1)}<span className="text-xs font-medium text-gray-400"> rentals</span></p>
            <p className="text-[11px] text-gray-400 mt-1">
              {p.low != null ? `usually ${Math.round(p.low)}–${Math.round(p.high)}` : 'range varies a lot'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Busiest (≥15% above a typical month) and quietest (≥15% below) months.
export function seasonHighlights(profile) {
  const known = profile.filter((p) => p.samples > 0);
  return {
    peaks: [...known].sort((a, b) => b.index - a.index).slice(0, 2).filter((p) => p.index >= 1.15),
    lulls: [...known].sort((a, b) => a.index - b.index).slice(0, 1).filter((p) => p.index <= 0.85),
  };
}

export function SeasonalPattern({ profile, projections }) {
  if (!profile.some((p) => p.samples > 0)) return null;
  const max = Math.max(1, ...profile.map((p) => p.avg));
  const upcoming = new Set(projections.map((p) => SHORT_MONTHS.indexOf(String(p.label).split(' ')[0]) + 1));
  const { peaks, lulls } = seasonHighlights(profile);
  const name = (p) => SHORT_MONTHS[p.month - 1];
  return (
    <div className={`${BOX} p-4`}>
      <p className={`${HEAD} text-gray-500`}>Seasonal pattern</p>
      <div className="flex items-end gap-1 h-16 mt-3" role="img"
        aria-label={`Average rentals per calendar month.${peaks.length ? ` Busiest: ${peaks.map(name).join(', ')}.` : ''}`}>
        {profile.map((p) => (
          <div key={p.month} className="flex-1 flex flex-col items-center gap-1 min-w-0"
            title={p.samples ? `${name(p)}: avg ${p.avg}/mo (${p.samples} yr${p.samples === 1 ? '' : 's'})` : `${name(p)}: no data`}>
            <div className={`w-full rounded-t ${upcoming.has(p.month) ? 'bg-[#bf4a53]' : 'bg-gray-300'} transition-[height] duration-700`}
              style={{ height: `${Math.max(4, (p.avg / max) * 52)}px`, opacity: p.samples ? 1 : 0.3 }} />
            <span className={`text-[9px] ${upcoming.has(p.month) ? 'font-bold text-[#bf4a53]' : 'text-gray-400'}`}>{name(p)[0]}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-500 mt-2 leading-snug">
        {peaks.length > 0 && <>Busiest: <strong className="text-gray-800">{peaks.map((p) => `${name(p)} (+${Math.round((p.index - 1) * 100)}%)`).join(', ')}</strong>. </>}
        {lulls.length > 0 && <>Quietest: {lulls.map(name).join(', ')}. </>}
        <span className="text-[#bf4a53] font-semibold">Red</span> = months being forecast.
      </p>
    </div>
  );
}

export function DemandDrivers({ drivers }) {
  if (drivers.length === 0) return null;
  return (
    <div className={`${BOX} p-4`}>
      <p className={`${HEAD} text-gray-500 mb-2.5`}>What drives demand</p>
      <div className="space-y-2.5">
        {drivers.slice(0, 5).map((c) => (
          <div key={c.category} className="text-xs">
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0 font-semibold text-gray-800 truncate capitalize">{c.category}</span>
              <span className="text-gray-400 tabular-nums">{c.share ?? 0}%</span>
              <span className="w-16 text-right font-bold text-gray-900 tabular-nums">~{Math.round(c.projection * 10) / 10}/mo</span>
              <span className={`w-3 text-center ${c.trend === 'up' ? 'text-emerald-600' : c.trend === 'down' ? 'text-red-500' : 'text-gray-400'}`} aria-label={`trend ${c.trend}`}>
                {c.trend === 'up' ? '▲' : c.trend === 'down' ? '▼' : '–'}
              </span>
            </div>
            <div className="h-1.5 mt-1 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-gray-800/80 rounded-full transition-[width] duration-700" style={{ width: `${c.share ?? 0}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mt-2">Share of rentals over the last 3 complete months.</p>
    </div>
  );
}
