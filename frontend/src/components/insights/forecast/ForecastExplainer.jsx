// "Explain" view (full view only): the numbers on screen in plain words, plus
// one suggested action. Deterministic templates — no AI, nothing invented.
import { Sparkles } from 'lucide-react';
import { SHORT_MONTHS, fmt, getUpcomingSeason } from '../shared';
import { paceStatus } from './ForecastTiles';
import { seasonHighlights } from './ForecastDetails';

export default function ForecastExplainer({ fc, weekly, period, seasonality, profile, drivers, avgPriceKnown, avgPrice }) {
  const unit = weekly ? 'week' : 'month';
  const { projections: proj, current: cur } = fc;
  const next = proj[0];
  const { peaks } = seasonHighlights(profile);
  const upcoming = getUpcomingSeason();
  const early = paceStatus(cur, weekly)?.early;
  const stock = proj.length ? Math.ceil(Math.max(...proj.map((p) => p.high ?? p.value))) : 0;
  const word = fc.trend === 'up' ? 'rising' : fc.trend === 'down' ? 'easing' : 'steady';
  const b = (t) => <strong className="text-gray-900">{t}</strong>;

  const lines = [
    <>{b(`Demand is ${word}.`)} The last {period} complete {unit}s average {fc.latest.toFixed(1)} rentals
      {fc.trend === 'stable' ? ', about the same as before.' : `, ${fc.trend === 'up' ? 'up' : 'down'} from ${fc.prev.toFixed(1)}.`}{' '}
      The {unit} in progress is shown but not averaged until it ends.</>,
    cur && <>{b(`${weekly ? 'This week' : String(cur.label).split(' ')[0]} so far: ${cur.count} rentals`)} after {cur.daysElapsed} of {cur.daysInMonth} days
      {early ? ' — too early to judge the pace.' : `, on pace for about ${Math.round(cur.pace)}${cur.projected != null ? ` against a forecast of ${Math.round(cur.projected)}` : ''}.`}</>,
    next && (fc.seasonal
      ? <>{b("Expect demand to follow last year's calendar:")} {proj.map((p) => `${p.label} ~${p.value.toFixed(1)}`).join(' · ')}.
          Each month is half the recent average and half the same month last year
          {seasonality?.growth != null && seasonality.growth !== 1 ? ` (×${seasonality.growth} for growth)` : ''}, because that predicted past months better.</>
      : <>{b(`Expect about ${next.value.toFixed(1)} rentals per ${unit}`)} ({proj.map((p) => p.label).join(' · ')})
          {!weekly && avgPriceKnown ? ` — roughly ${fmt(next.value * avgPrice)} in revenue each.` : '.'}</>),
    fc.rangeReliable
      ? <>{b(`Reality usually lands within ±${fc.errPct}%.`)} That comes from replaying the method on past {unit}s.</>
      : <>{b('No reliable range right now.')} Past {unit}s swing too much — treat the forecast as a direction.</>,
    !weekly && peaks.length > 0 && <>{b(`Busiest months: ${peaks.map((p) => SHORT_MONTHS[p.month - 1]).join(' and ')}.`)} Plan stock and staff ahead of them.</>,
    upcoming && <>{b(`Upcoming${upcoming.isNow ? ' this month' : ` (${upcoming.monthName})`}: ${upcoming.label}.`)} Keep matching pieces clean and ready.</>,
    fc.spikeNotes.length > 0 && <>{b(`${fc.spikeNotes.join(', ')} ${fc.spikeNotes.length === 1 ? 'was a one-off' : 'were one-offs'}.`)} Not seen in other years, so capped in the average.</>,
  ].filter(Boolean);

  return (
    <div className="mx-5 md:mx-7 mb-5 rounded-2xl border border-gray-100 bg-gray-50/60 p-5 space-y-4">
      <ol className="space-y-3">
        {lines.map((content, i) => (
          <li key={i} className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
            <p className="text-sm text-gray-700 leading-relaxed">{content}</p>
          </li>
        ))}
      </ol>
      <div className="bg-white border border-[#bf4a53]/20 rounded-xl px-4 py-3 text-sm text-gray-700 flex items-start gap-2.5">
        <span className="w-8 h-8 rounded-xl bg-[#bf4a53]/10 text-[#bf4a53] flex items-center justify-center shrink-0"><Sparkles size={14} /></span>
        <p>
          {b('Suggested action: ')}
          {proj.length > 0
            ? `keep at least ${Math.max(1, stock)} pieces ready per ${unit}${fc.rangeReliable ? ' (top of the expected range)' : ''}${drivers[0] ? `, led by ${drivers[0].category} (${drivers[0].share}% of recent rentals)` : ''}${fc.trend === 'down' ? ', and run a promo if bookings keep easing' : ''}.`
            : 'collect a few more periods of bookings first — the forecast is still learning.'}
        </p>
      </div>
    </div>
  );
}
