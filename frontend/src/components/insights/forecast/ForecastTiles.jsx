// Headline tiles. The card shows the two that answer "what's coming":
// next period and this period so far. The full view adds trend + accuracy.
import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus, CalendarClock, Target, Gauge, ArrowRight } from 'lucide-react';
import { fmt } from '../shared';

function Tile({ icon: Icon, tint, label, value, sub, children }) {
  return (
    <div className="bg-gray-50/80 rounded-2xl p-3.5 md:p-4 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
        <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${tint}`}><Icon size={13} /></span>
        <span className="truncate">{label}</span>
      </div>
      <p className="text-xl md:text-2xl font-bold text-gray-900 mt-2 tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">{sub}</p>}
      {children}
    </div>
  );
}

// On track / behind / ahead: the full-period pace against the forecast's
// expected range (±10% when no range is known). Too early before ~a week.
export function paceStatus(current, weekly) {
  if (!current || current.projected == null) return null;
  if (current.daysElapsed < (weekly ? 3 : 7)) return { early: true };
  const lo = current.low ?? current.projected * 0.9;
  const hi = current.high ?? current.projected * 1.1;
  if (current.pace > hi) return { label: 'Ahead of forecast', cls: 'bg-emerald-50 text-emerald-700' };
  if (current.pace < lo) return { label: 'Behind forecast', cls: 'bg-amber-50 text-amber-700' };
  return { label: 'On track', cls: 'bg-sky-50 text-sky-700' };
}

export default function ForecastTiles({ fc, weekly, full, avgPriceKnown, avgPrice }) {
  const unit = weekly ? 'week' : 'month';
  const next = fc.projections[0];
  const cur = fc.current;
  const status = paceStatus(cur, weekly);
  const progress = cur?.projected > 0 ? Math.min(100, Math.round((cur.count / cur.projected) * 100)) : 0;
  const timePct = cur ? Math.round((cur.daysElapsed / cur.daysInMonth) * 100) : 0;
  const TrendIcon = fc.trend === 'up' ? TrendingUp : fc.trend === 'down' ? TrendingDown : Minus;
  // Start the progress bar empty and let it grow in after the first frame.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`grid grid-cols-2 ${full ? 'lg:grid-cols-4' : ''} gap-2.5 px-5 md:px-7 pb-4`}>
      <Tile icon={ArrowRight} tint="bg-[#bf4a53]/10 text-[#bf4a53]"
        label={next ? `Next ${unit} · ${next.label}` : `Next ${unit}`}
        value={next ? next.value.toFixed(1) : '—'}
        sub={next
          ? [next.low != null ? `usually ${Math.round(next.low)}–${Math.round(next.high)}` : null,
              !weekly && avgPriceKnown ? `≈ ${fmt(next.value * avgPrice)}` : null].filter(Boolean).join(' · ') || null
          : 'needs more history'} />

      <Tile icon={CalendarClock} tint="bg-amber-50 text-amber-600"
        label={cur ? (weekly ? 'This week so far' : `${String(cur.label).split(' ')[0]} so far`) : `This ${unit}`}
        value={cur ? cur.count : '—'}
        sub={cur && (status?.early
          ? `Day ${cur.daysElapsed} of ${cur.daysInMonth} · too early to call`
          : `On pace for ~${Math.round(cur.pace)}${cur.projected != null ? ` · forecast ~${Math.round(cur.projected)}` : ''}`)}>
        {cur?.projected > 0 && (
          <div className="mt-2 space-y-1">
            <div className="relative h-1.5 bg-gray-200/80 rounded-full overflow-hidden" title={`${progress}% of the forecast with ${timePct}% of the ${unit} gone`}>
              <div className="h-full rounded-full bg-amber-500 transition-[width] duration-700 ease-out" style={{ width: grown ? `${progress}%` : 0 }} />
              <div className="absolute top-0 h-full w-0.5 bg-gray-500/60" style={{ left: `${timePct}%` }} />
            </div>
            {status?.label && <span className={`inline-block text-[10px] font-bold rounded-full px-2 py-0.5 ${status.cls}`}>{status.label}</span>}
          </div>
        )}
      </Tile>

      {full && (
        <Tile icon={TrendIcon}
          tint={fc.trend === 'up' ? 'bg-emerald-50 text-emerald-600' : fc.trend === 'down' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}
          label="Trend"
          value={fc.trend === 'stable' ? 'Flat' : fc.trendPct !== null ? `${fc.trendPct > 0 ? '+' : '−'}${Math.abs(fc.trendPct)}%` : (fc.latest - fc.prev).toFixed(1)}
          sub={`Average ${fc.latest.toFixed(1)}/${unit} vs ${fc.prev.toFixed(1)} before`} />
      )}
      {full && (
        <Tile icon={fc.rangeReliable ? Target : Gauge}
          tint={fc.rangeReliable ? 'bg-sky-50 text-sky-600' : 'bg-gray-100 text-gray-500'}
          label="Accuracy"
          value={fc.rangeReliable ? `±${fc.errPct}%` : 'Varies'}
          sub={fc.rangeReliable ? `typical miss on past ${unit}s` : `past ${unit}s swing too much — read it as a direction`} />
      )}
    </div>
  );
}
