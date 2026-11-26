// Page header: title left, filter + export controls top-right on desktop,
// stacked on mobile. Pure presentational — all state lives in the parent.
import { useRef } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Download, RefreshCw } from 'lucide-react';
import { TIME_OPTIONS, SHORT_MONTHS } from './shared';
import { formatWeekRange, toIsoDay, parseIsoDay, weekStartOf, addDays } from '../../utils/week';

// Weekly filter pill: ‹ January 19 – January 25 ›. Tapping the label opens
// the native date picker — any day picked snaps to its Monday–Sunday week.
// Future weeks can't be picked (next arrow + picker max stop at this week).
function WeekPicker({ weekStart, currentWeekStart, setSelWeek, now0 }) {
  const dateRef = useRef(null);
  const isCurrentWeek = weekStart.getTime() === currentWeekStart.getTime();
  const step = (dir) => {
    const next = addDays(weekStart, dir * 7);
    if (next > currentWeekStart || next.getFullYear() < 2000) return;
    setSelWeek(toIsoDay(next));
  };
  const openPicker = () => {
    const el = dateRef.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };
  const showYear = weekStart.getFullYear() !== now0.getFullYear();
  const arrow = 'p-1 sm:p-0.5 rounded-full text-gray-500 hover:text-gray-800 hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50';
  return (
    <div className="relative flex items-center gap-0.5 bg-gray-100 rounded-full px-1.5 py-1.5 sm:px-1 sm:py-1 shrink-0">
      <button type="button" onClick={() => step(-1)} aria-label="Previous week" title="Previous week" className={arrow}>
        <ChevronLeft size={14} />
      </button>
      <button type="button" onClick={openPicker}
        title={`${formatWeekRange(weekStart, { long: true, year: true })} · tap to pick a week`}
        aria-label={`Week of ${formatWeekRange(weekStart, { long: true, year: true })}. Pick a week`}
        className="px-1 text-sm sm:text-xs font-bold text-gray-700 whitespace-nowrap tabular-nums rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50">
        <span className="lg:hidden">{formatWeekRange(weekStart)}</span>
        <span className="hidden lg:inline">{formatWeekRange(weekStart, { long: true, year: showYear })}</span>
      </button>
      <input ref={dateRef} type="date" tabIndex={-1} aria-hidden="true"
        min="2000-01-01" max={toIsoDay(now0)} value={toIsoDay(weekStart)}
        onChange={(e) => {
          const d = parseIsoDay(e.target.value);
          if (!d) return;
          const ws = weekStartOf(d);
          setSelWeek(toIsoDay(ws > currentWeekStart ? currentWeekStart : ws));
        }}
        className="absolute inset-0 w-full h-full opacity-0 pointer-events-none" />
      <button type="button" onClick={() => step(1)} disabled={isCurrentWeek} aria-label="Next week" title="Next week" className={arrow}>
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

export default function InsightsHeader({
  timeRange, setTimeRange,
  appliedMonth, appliedYear, setSelMonth, setSelYear, now0,
  appliedWeekStart, currentWeekStart, setSelWeek,
  availableYears,
  refreshState = 'idle', onRefresh, statusText = '',
  workbookScopeLabel, handleWorkbookExport,
}) {
  // Year picker offers only years with bookings (newest first); the applied
  // year is always selectable even before the list loads.
  const yearOptions = [...new Set([appliedYear, ...(availableYears ?? [])])]
    .filter((y) => Number.isInteger(y))
    .sort((a, b) => b - a);
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Business Intelligence</h2>
        <p className="text-sm text-gray-500 mt-1">Real-time analytics powered by your transaction and inventory data.</p>
      </div>

      {/* Controls — single one-line row on all screens: range pills,
          optional month/year or week, Excel. Compact on phones, roomier on sm+. */}
      <div className="flex items-center justify-center lg:justify-end gap-2 sm:gap-3 shrink-0 w-full lg:w-auto">

        {/* Data freshness + manual refresh — one button left of the filter:
            the label IS the button (tap to refresh). Spins while loading,
            red on failure — tap retries. */}
        <button onClick={onRefresh}
          disabled={refreshState === 'loading'}
          aria-label={refreshState === 'error' ? 'Retry loading dashboard data' : 'Refresh dashboard data'}
          title={statusText || 'Refresh dashboard data'}
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-full pl-2 pr-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50 disabled:cursor-wait ${refreshState === 'error' ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <RefreshCw size={13} className={refreshState === 'loading' ? 'animate-spin' : ''} />
          {statusText && (
            <span className={`hidden md:block text-[11px] font-semibold tabular-nums whitespace-nowrap ${refreshState === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
              {statusText}
            </span>
          )}
        </button>

        {/* Range dropdown */}
        <div className="relative shrink-0">
          <select
            aria-label="Time range"
            value={timeRange}
            onChange={e => setTimeRange(e.target.value)}
            className="appearance-none bg-gray-100 hover:bg-gray-200 rounded-full pl-4 pr-9 py-2.5 text-sm sm:pl-3 sm:pr-7 sm:py-1.5 sm:text-xs font-bold text-gray-900 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50"
          >
            {TIME_OPTIONS.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute right-3 sm:right-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
        </div>

        {/* Week — ‹ Jan 19 – Jan 25 › stepper + date picker */}
        {timeRange === 'Weekly' && appliedWeekStart && (
          <WeekPicker weekStart={appliedWeekStart} currentWeekStart={currentWeekStart}
            setSelWeek={setSelWeek} now0={now0} />
        )}

        {/* Month + Year — compact pill, hidden on Overall / Weekly */}
        {timeRange !== 'Overall' && timeRange !== 'Weekly' && (
          <div className="flex items-center gap-1 sm:gap-0.5 bg-gray-100 rounded-full px-3 py-2 sm:px-1.5 sm:py-1 shrink-0">
            {timeRange === 'Monthly' && (
              <select
                aria-label="Month"
                value={appliedMonth}
                onChange={e => setSelMonth(Number(e.target.value))}
                className="bg-transparent text-sm sm:text-xs font-bold text-gray-700 focus:outline-none cursor-pointer pl-0.5"
              >
                {SHORT_MONTHS.map((name, i) => {
                  const m = i + 1;
                  const disabledFuture = appliedYear === now0.getFullYear() && m > now0.getMonth() + 1;
                  return <option key={m} value={m} disabled={disabledFuture}>{name}</option>;
                })}
              </select>
            )}
            <select
              aria-label="Year"
              value={appliedYear}
              onChange={e => setSelYear(Number(e.target.value))}
              className="bg-transparent text-sm sm:text-xs font-bold text-gray-700 focus:outline-none cursor-pointer"
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        )}

        <div className="hidden sm:block w-px h-6 bg-gray-200 shrink-0" />
        <button onClick={handleWorkbookExport}
          className="shrink-0 inline-flex items-center gap-1 sm:gap-1.5 p-2 sm:px-3.5 sm:py-1.5 text-xs font-bold rounded-full bg-gray-900 text-white hover:bg-gray-700 active:scale-[0.98] transition-all"
          title={`Download Excel workbook (${workbookScopeLabel}) — Transactions, Revenue & Inventory sheets`}>
          <Download size={13} />
          <span className="hidden sm:inline">Excel</span>
        </button>
      </div>
    </div>
  );
}
