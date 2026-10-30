// Placeholders shaped like the forecast card, so swapping in the real content
// doesn't shift the layout: two tiles, the chart + legend, the outlook table.
import { Skeleton } from '../../Skeleton';

export function ForecastBodySkeleton({ chartHeight = 260, table = true }) {
  return (
    <div aria-busy="true" aria-label="Loading forecast">
      <div className="grid grid-cols-2 gap-2.5 px-5 md:px-7 pb-4">
        {[0, 1].map((i) => (
          <div key={i} className="bg-gray-50/80 rounded-2xl p-3.5 md:p-4 space-y-2.5">
            <div className="flex items-center gap-1.5">
              <Skeleton className="w-6 h-6 rounded-lg" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
      <div className="flex pl-1 pr-5 md:pr-7">
        <div className="w-[42px] shrink-0 flex flex-col justify-between py-3 pb-12 items-end pr-2" style={{ height: chartHeight }}>
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-2.5 w-5" />)}
        </div>
        <div className="flex-1 min-w-0 flex items-end gap-2 pb-12 pt-3" style={{ height: chartHeight }}>
          {[38, 52, 30, 64, 46, 72, 58, 40, 66, 50, 34, 44].map((h, i) => (
            <Skeleton key={i} className="flex-1 rounded-t-md rounded-b-none" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
      {/* Legend row */}
      <div className="flex justify-center gap-4 pt-1 pb-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-3 w-16" />)}
      </div>
      {table && (
        <div className="px-5 md:px-7 pb-5 space-y-3">
          <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
            <Skeleton className="h-3 w-24" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-3.5 w-8" />
              </div>
            ))}
          </div>
          <Skeleton className="h-8 w-full rounded-xl" />
        </div>
      )}
    </div>
  );
}

// Whole card (header + body) for the page-level skeleton.
export default function ForecastCardSkeleton() {
  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm lg:col-span-2 overflow-hidden">
      <div className="px-5 md:px-7 pt-5 md:pt-7 pb-3 flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-52" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-9 w-36 rounded-xl" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>
      <ForecastBodySkeleton />
    </div>
  );
}
