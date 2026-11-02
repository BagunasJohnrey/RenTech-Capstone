// Demand forecast — rule-based (no AI, no ML): a moving average over COMPLETE
// periods, blended 50/50 with the same month last year when that beat the
// plain average on past months (server backtest).
//
// Card (on the page): next period + this period so far, the chart, and the
// outlook table. Full view (⤢): adds trend, accuracy, seasonal pattern, the
// categories driving demand, and the plain-words "Explain" view.
// The pieces live in ./forecast/; this file only lays them out.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Maximize2, X, CalendarClock, ChevronRight } from 'lucide-react';
import { CONFIDENCE_STYLES } from './shared';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { deriveForecast } from './forecast/forecastData';
import ForecastChart from './forecast/ForecastChart';
import ForecastTiles from './forecast/ForecastTiles';
import { OutlookTable, OutlookCards, SeasonalPattern, DemandDrivers } from './forecast/ForecastDetails';
import ForecastExplainer from './forecast/ForecastExplainer';
import { ForecastBodySkeleton } from './forecast/ForecastSkeleton';

const ICON_BTN = 'w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60';

export default function DemandForecast(props) {
  const [expanded, setExpanded] = useState(false);
  const close = useCallback(() => setExpanded(false), []);
  useEscapeClose(close, expanded);
  useEffect(() => {
    if (!expanded) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [expanded]);

  return (
    <>
      <ForecastPanel {...props} onExpand={() => setExpanded(true)} />
      {expanded && createPortal(
        <div className="fixed inset-0 z-[250] flex items-stretch justify-center md:justify-end"
          role="dialog" aria-modal="true" aria-label="Demand forecast, full view">
          <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={close} />
          <div className="relative w-full max-w-[1400px] h-full overflow-y-auto overscroll-contain bg-white md:w-[min(1100px,94vw)] md:rounded-l-3xl shadow-2xl animate-in fade-in zoom-in-95 md:zoom-in-100 md:slide-in-from-right duration-200">
            <ForecastPanel {...props} full onClose={close} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function ForecastPanel({
  full = false, onExpand, onClose,
  granularity, setGranularity, loadWeeklyForecast, weeklyLoading,
  activeForecast, monthlyForecast, avgPriceKnown, avgPrice,
}) {
  const [explaining, setExplaining] = useState(false);
  const weekly = granularity === 'weekly';
  const fc = useMemo(() => deriveForecast(activeForecast, weekly), [activeForecast, weekly]);
  const period = activeForecast?.period || 3;
  const unit = weekly ? 'week' : 'month';
  const profile = weekly ? [] : (monthlyForecast?.seasonalProfile || []);
  const drivers = weekly ? [] : (monthlyForecast?.byCategory || []).filter((c) => c.projection !== null);
  const isPhone = typeof window !== 'undefined' && window.innerWidth < 768;
  const chartHeight = full ? (isPhone ? 300 : 420) : 260;
  // Until weekly buckets arrive, activeForecast is still the monthly series:
  // skeleton the whole body (tiles + chart + table) instead of showing monthly
  // numbers under "Next week" labels and then jumping.
  const pendingWeekly = weekly && weeklyLoading;
  // One key per series, so the body fades in as a unit while the chart draws.
  const seriesKey = `${weekly}-${fc.rows.length}-${fc.rows[0]?.full ?? ''}`;

  return (
    <div className={full ? 'bg-white' : 'bg-white rounded-3xl border border-gray-100/80 shadow-sm lg:col-span-2 overflow-hidden'}>
      {/* Header (sticky in the full view so close + toggles stay reachable) */}
      <div className={`px-5 md:px-7 pt-5 md:pt-7 pb-3 space-y-3 ${full ? 'sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-100' : ''}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className={`font-bold text-gray-900 ${full ? 'text-lg md:text-2xl' : 'text-base md:text-lg'}`}>Demand Forecast</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {weeklyLoading ? 'Loading weekly buckets…'
                : `Rule-based · ${fc.seasonal ? `last ${period} months + same month last year` : `${period}-${unit} moving average`}`}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {full && (
              <button type="button" onClick={() => setExplaining((v) => !v)} aria-pressed={explaining}
                className="inline-flex items-center gap-1.5 px-3.5 min-h-[32px] rounded-full text-[11px] font-bold bg-gray-900 text-white hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
                <Sparkles size={13} /> {explaining ? 'Show numbers' : 'Explain'}
              </button>
            )}
            <div role="tablist" aria-label="Forecast granularity" className="flex gap-1 bg-gray-100 rounded-xl p-1">
              {['monthly', 'weekly'].map((g) => (
                <button key={g} type="button" role="tab" aria-selected={granularity === g}
                  onClick={() => { setGranularity(g); if (g === 'weekly') loadWeeklyForecast(); }}
                  className={`px-3 min-h-[28px] rounded-lg text-[11px] font-bold capitalize transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60 ${
                    granularity === g ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {g}
                </button>
              ))}
            </div>
            {full
              ? <button type="button" onClick={onClose} aria-label="Close full view" title="Close (Esc)" className={ICON_BTN}><X size={18} /></button>
              : <button type="button" onClick={onExpand} aria-label="Open demand forecast in full view" title="Full view" className={ICON_BTN}><Maximize2 size={15} /></button>}
          </div>
        </div>
        {full && (
          <div className="flex flex-wrap gap-1.5">
            {activeForecast?.confidenceNote && (
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${CONFIDENCE_STYLES[activeForecast.confidence] || 'bg-gray-100 text-gray-500'}`}>
                {activeForecast.confidenceNote}
              </span>
            )}
            {activeForecast?.historyPoints > 0 && (
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-violet-50 text-violet-700">
                incl. {activeForecast.historyPoints.toLocaleString()} logbook record{activeForecast.historyPoints === 1 ? '' : 's'}
              </span>
            )}
            {activeForecast?.provisional && (
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700">Early forecast — still learning</span>
            )}
          </div>
        )}
      </div>

      {pendingWeekly ? (
        <ForecastBodySkeleton chartHeight={chartHeight} table={!full} />
      ) : !fc.hasTrend ? (
        <div className="px-5 md:px-7 pb-6">
          <div className="rounded-2xl bg-gray-50 py-10 text-center">
            <CalendarClock size={22} className="mx-auto text-gray-300" />
            <p className="text-sm font-bold text-gray-700 mt-2">Not enough history yet</p>
            <p className="text-xs text-gray-400 mt-1">
              At least {Math.max(1, 2 - fc.completeCount)} more complete {unit}{2 - fc.completeCount === 1 ? '' : 's'} of bookings needed for a trend.
            </p>
          </div>
        </div>
      ) : (
        <div key={seriesKey} className="animate-in fade-in duration-500 ease-out">
          <div className={full ? 'pt-4' : ''}>
            <ForecastTiles fc={fc} weekly={weekly} full={full} avgPriceKnown={avgPriceKnown} avgPrice={avgPrice} />
          </div>
          <ForecastChart rows={fc.rows} weekly={weekly} rangeReliable={fc.rangeReliable} seasonDots={fc.seasonDots}
            height={chartHeight} minBarWidth={full ? 40 : 46} showCurrent={!!fc.current} />

          {!full ? (
            <div className="px-5 md:px-7 pb-5 space-y-3">
              <OutlookTable projections={fc.projections} weekly={weekly} avgPriceKnown={avgPriceKnown} avgPrice={avgPrice} />
              <button type="button" onClick={onExpand}
                className="w-full inline-flex items-center justify-center gap-1 py-2 rounded-xl text-xs font-bold text-[#bf4a53] hover:bg-[#bf4a53]/5 transition-colors">
                See full forecast — trend, accuracy, seasons <ChevronRight size={14} />
              </button>
            </div>
          ) : (
            <div key={explaining ? 'explain' : 'numbers'} className="animate-in fade-in duration-300">
              {explaining ? (
                <ForecastExplainer fc={fc} weekly={weekly} period={period} seasonality={activeForecast?.seasonality}
                  profile={profile} drivers={drivers} avgPriceKnown={avgPriceKnown} avgPrice={avgPrice} />
              ) : weekly ? (
                <div className="px-5 md:px-7 pb-5">
                  <OutlookCards projections={fc.projections} />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-5 md:px-7 pb-5">
                  <OutlookTable projections={fc.projections} weekly={weekly} avgPriceKnown={avgPriceKnown} avgPrice={avgPrice}
                    seasonality={activeForecast?.seasonality} showMethodNote={fc.seasonal} />
                  <SeasonalPattern profile={profile} projections={fc.projections} />
                  <DemandDrivers drivers={drivers} />
                </div>
              )}
              <p className="text-[11px] text-gray-400 px-5 md:px-7 pb-6 leading-relaxed">
                How it works: average of the last {period} complete {unit}s
                {fc.seasonal ? ', blended 50/50 with the same month last year (adjusted for growth)' : ''}.
                One-off spikes are capped; regular yearly peaks are kept. Cancelled bookings count, since they still show demand.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
