// Page header: title left, filter + export controls top-right on desktop,
// stacked on mobile. Pure presentational — all state lives in the parent.
import { Download } from 'lucide-react';
import { TIME_OPTIONS, SHORT_MONTHS } from './shared';

export default function InsightsHeader({
  timeRange, setTimeRange,
  appliedMonth, appliedYear, setSelMonth, setSelYear, now0,
  workbookScopeLabel, handleWorkbookExport,
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Business Intelligence</h2>
        <p className="text-sm text-gray-500 mt-1">Real-time analytics powered by your transaction and inventory data.</p>
      </div>

      {/* Controls — single one-line row on all screens: range pills,
          optional month/year, Excel. Compact on phones, roomier on sm+. */}
      <div className="flex items-center justify-center lg:justify-end gap-2 sm:gap-3 shrink-0 w-full lg:w-auto">

        {/* Range pills — segmented control */}
        <div className="flex bg-gray-100 rounded-full p-0.5 shrink-0">
          {TIME_OPTIONS.map(t => (
            <button key={t} onClick={() => setTimeRange(t)}
              className={`px-2 sm:px-3 py-1.5 text-[10px] sm:text-xs font-bold rounded-full transition-colors text-center whitespace-nowrap ${timeRange === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t}
            </button>
          ))}
        </div>

        {/* Month + Year — compact pill, hidden on Overall */}
        {timeRange !== 'Overall' && (
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-full px-1.5 py-1 shrink-0">
            {timeRange === 'Monthly' && (
              <select
                aria-label="Month"
                value={appliedMonth}
                onChange={e => setSelMonth(Number(e.target.value))}
                className="bg-transparent text-[11px] sm:text-xs font-bold text-gray-700 focus:outline-none cursor-pointer pl-0.5"
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
              className="bg-transparent text-[11px] sm:text-xs font-bold text-gray-700 focus:outline-none cursor-pointer"
            >
              {Array.from({ length: now0.getFullYear() - 2000 + 1 }, (_, i) => 2000 + i).map(y => (
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
