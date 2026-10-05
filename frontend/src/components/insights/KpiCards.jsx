// KPI Cards — 2-up on phones, 3-up on tablets/iPads, 6-up on desktop.
// Pure presentational; every figure is computed by the parent.
import { DollarSign, BarChart3, TrendingUp, RotateCcw } from 'lucide-react';
import { fmt } from './shared';

export default function KpiCards({
  thisMonthRev, prevMonthRev, revChange,
  revLabel = 'Monthly Revenue', revSub = 'Collected this month', revVsLabel = null,
  rentedCount, totalItems,
  smaVals, latestSmaVal, forecastRev, avgPriceKnown,
  analyticsSummary,
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100/80 shadow-sm">
        <div className="p-2 bg-emerald-50 rounded-xl inline-block text-emerald-500 mb-2">
          <DollarSign size={16} />
        </div>
        <p className="text-[10px] md:text-xs text-gray-500 font-medium">{revLabel}</p>
        <h4 className="text-base md:text-xl font-bold text-gray-900 mt-0.5">{fmt(thisMonthRev)}</h4>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {prevMonthRev > 0 && revVsLabel && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] md:text-xs font-bold ${revChange >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
              {revChange >= 0 ? '+' : ''}{Math.abs(revChange).toFixed(0)}%
            </span>
          )}
          {prevMonthRev > 0 && revVsLabel && (
            <span className="text-[10px] md:text-xs font-medium text-gray-400">{revVsLabel}</span>
          )}
        </div>
        <p className="text-[10px] md:text-xs font-medium text-gray-400 mt-0.5">{revSub}</p>
      </div>
      <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100/80 shadow-sm">
        <div className="p-2 bg-orange-50 rounded-xl inline-block text-orange-500 mb-2">
          <BarChart3 size={16} />
        </div>
        <p className="text-[10px] md:text-xs text-gray-500 font-medium">Pieces Rented</p>
        <h4 className="text-base md:text-xl font-bold text-gray-900 mt-0.5">{rentedCount}<span className="text-xs md:text-sm font-medium text-gray-400">/{totalItems}</span></h4>
        <span className="text-[10px] md:text-xs font-semibold text-gray-500">{totalItems > 0 ? Math.round((rentedCount / totalItems) * 100) : 0}%</span>
      </div>
      <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100/80 shadow-sm">
        <div className="p-2 bg-purple-50 rounded-xl inline-block text-purple-500 mb-2">
          <TrendingUp size={16} />
        </div>
        <p className="text-[10px] md:text-xs text-gray-500 font-medium">Forecast</p>
        <h4 className="text-base md:text-xl font-bold text-gray-900 mt-0.5">
          {smaVals.length >= 2 ? `${Math.round(latestSmaVal)}` : '—'}
        </h4>
        {smaVals.length >= 2 && (
          <span className="text-[10px] md:text-xs font-semibold text-gray-500">
            {avgPriceKnown ? fmt(forecastRev) : 'price data maturing'}
          </span>
        )}
      </div>
      {analyticsSummary && (
        <>
          <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100/80 shadow-sm">
            <div className="p-2 bg-emerald-50 rounded-xl inline-block text-emerald-500 mb-2">
              <DollarSign size={16} />
            </div>
            <p className="text-[10px] md:text-xs text-gray-500 font-medium">Inventory Revenue</p>
            <h4 className="text-base md:text-xl font-bold text-gray-900 mt-0.5">₱{analyticsSummary.totalRevenue.toLocaleString()}</h4>
          </div>
          <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100/80 shadow-sm">
            <div className="p-2 bg-orange-50 rounded-xl inline-block text-orange-500 mb-2">
              <RotateCcw size={16} />
            </div>
            <p className="text-[10px] md:text-xs text-gray-500 font-medium">Total Rentals</p>
            <h4 className="text-base md:text-xl font-bold text-gray-900 mt-0.5">{analyticsSummary.totalRentals}</h4>
          </div>
          <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100/80 shadow-sm">
            <div className="p-2 bg-purple-50 rounded-xl inline-block text-purple-500 mb-2">
              <TrendingUp size={16} />
            </div>
            <p className="text-[10px] md:text-xs text-gray-500 font-medium">Avg Utilization</p>
            <h4 className="text-base md:text-xl font-bold text-gray-900 mt-0.5">{analyticsSummary.avgUtilization}%</h4>
          </div>
        </>
      )}
    </div>
  );
}
