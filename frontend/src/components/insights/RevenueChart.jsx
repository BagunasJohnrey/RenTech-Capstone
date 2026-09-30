// Revenue chart card: weekly series in Monthly view, monthly otherwise,
// with the projection bar appended. Pure presentational.
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { RevenueTooltip } from './shared';

export default function RevenueChart({
  isMonthlyView, monthName, appliedYear, appliedMonth,
  viewingCurrentMonth, revChart, revChartEmptyLabel,
  stepMonth, goCurrentMonth,
}) {
  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm lg:col-span-2 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-5 md:px-7 pt-5 md:pt-7 pb-2">
        <h3 className="font-bold text-gray-900 text-base md:text-lg">
          {isMonthlyView ? `${monthName} ${appliedYear} · Weekly Revenue` : 'Monthly Revenue'}
        </h3>
        {isMonthlyView && (
          <div className="flex items-center gap-0.5 shrink-0">
            {!viewingCurrentMonth && (
              <button onClick={goCurrentMonth}
                className="px-2.5 min-h-[32px] rounded-lg text-[11px] font-bold text-[#bf4a53] hover:bg-[#bf4a53]/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
                This month
              </button>
            )}
            <button onClick={() => stepMonth(-1)} aria-label="Previous month" title="Previous month"
              className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => stepMonth(1)} disabled={viewingCurrentMonth} aria-label="Next month" title="Next month"
              className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
      <p className="text-xs md:text-sm text-gray-400 px-5 md:px-7 pb-4">
        {isMonthlyView
          ? (viewingCurrentMonth ? 'Week-by-week revenue with next week projection' : 'Week-by-week revenue for the selected month')
          : 'Revenue trend with next month projection'}
      </p>
      {revChart.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">{revChartEmptyLabel}</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={revChart} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval={0} angle={revChart.length > 7 ? -35 : 0} textAnchor={revChart.length > 7 ? 'end' : 'middle'} height={revChart.length > 7 ? 56 : 30} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `₱${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={52} />
            <Tooltip content={<RevenueTooltip />} cursor={{ fill: '#f9fafb' }} />
            <Bar dataKey="rev" name="Revenue" radius={[6, 6, 0, 0]} maxBarSize={56} minPointSize={4}>
              {revChart.map((e, i) => (
                <Cell key={i}
                  fill={e.rev <= 0 ? '#e5e7eb' : e.forecast ? '#bf4a53' : '#1f2937'}
                  fillOpacity={e.forecast ? 0.22 : e.rev <= 0 ? 0.5 : 1}
                  stroke={e.forecast ? '#bf4a53' : 'none'}
                  strokeWidth={e.forecast ? 2 : 0}
                  strokeDasharray={e.forecast ? '4 3' : 'none'}
                />
              ))}
            </Bar>
            <ReferenceLine y={0} stroke="#e5e7eb" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
