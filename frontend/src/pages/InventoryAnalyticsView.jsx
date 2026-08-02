import { useState, useEffect } from 'react';
import { TrendingUp, RotateCcw, DollarSign } from 'lucide-react';
import { api } from '../utils/api';
import { useToast } from '../components/Toast';
import { Skeleton } from '../components/Skeleton';

const PAGE_SIZE = 10;

export default function InventoryAnalyticsView({ noHeader, period }) {
  const [data, setData] = useState(null);
  const [sortKey, setSortKey] = useState('revenueGenerated');
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(0);
  const { error: toastError } = useToast();

  useEffect(() => {
    const params = period && period !== 'Overall' ? `?period=${period.toLowerCase()}` : '';
    api.get(`/inventory/analytics${params}`).then(setData).catch((err) => {
      toastError(err?.message || 'Failed to load inventory analytics');
    });
  }, [period]);

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const { items, topByRevenue, topByUtilization, topByFrequency } = data;

  const sortedItems = [...items].sort((a, b) => {
    const val = sortDesc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey];
    return val;
  });

  const totalPages = Math.ceil(sortedItems.length / PAGE_SIZE);
  const paginatedItems = sortedItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDesc(!sortDesc);
    else { setSortKey(key); setSortDesc(true); }
    setPage(0);
  };

  const SortHeader = ({ label, sort, className }) => (
    <th className={`px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 ${className || ''}`}
      onClick={() => toggleSort(sort)}>
      <div className="flex items-center gap-1">
        {label}
        {sortKey === sort && <span className="text-[10px]">{sortDesc ? '↓' : '↑'}</span>}
      </div>
    </th>
  );

  return (
    <div className={`${noHeader ? 'p-5 md:p-8 space-y-6' : 'space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-6xl'}`}>
      {!noHeader && (
        <div>
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Inventory Analytics</h2>
          <p className="text-gray-500 font-medium mt-1">Per-item performance, utilization, and profitability.</p>
        </div>
      )}

      {/* Top Performers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-2xl p-5 border border-gray-100/80 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
            <DollarSign size={16} className="text-emerald-500" /> Top by Revenue
          </h3>
          <div className="space-y-2">
            {topByRevenue.map((item, i) => (
              <div key={item.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-bold text-gray-400 w-4">{i + 1}.</span>
                  <span className="text-xs font-semibold text-gray-900 truncate">{item.name}</span>
                </div>
                <span className="text-xs font-bold text-emerald-600 shrink-0">₱{item.revenueGenerated.toLocaleString()}</span>
              </div>
            ))}
            {topByRevenue.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No data yet</p>}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100/80 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
            <TrendingUp size={16} className="text-blue-500" /> Top by Utilization
          </h3>
          <div className="space-y-2">
            {topByUtilization.map((item, i) => (
              <div key={item.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-bold text-gray-400 w-4">{i + 1}.</span>
                  <span className="text-xs font-semibold text-gray-900 truncate">{item.name}</span>
                </div>
                <span className="text-xs font-bold text-blue-600 shrink-0">{item.utilizationPct}%</span>
              </div>
            ))}
            {topByUtilization.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No data yet</p>}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100/80 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
            <RotateCcw size={16} className="text-orange-500" /> Top by Frequency
          </h3>
          <div className="space-y-2">
            {topByFrequency.map((item, i) => (
              <div key={item.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-bold text-gray-400 w-4">{i + 1}.</span>
                  <span className="text-xs font-semibold text-gray-900 truncate">{item.name}</span>
                </div>
                <span className="text-xs font-bold text-orange-600 shrink-0">{item.totalRentals}x</span>
              </div>
            ))}
            {topByFrequency.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No data yet</p>}
          </div>
        </div>
      </div>

      {/* Full Table */}
      <div className="bg-white border border-gray-100/80 shadow-sm rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50/50 border-b border-gray-100/80">
              <tr>
                <SortHeader label="Item" sort="name" className="text-left" />
                <SortHeader label="Category" sort="category" />
                <SortHeader label="Price" sort="price" />
                <SortHeader label="Rentals" sort="totalRentals" />
                <SortHeader label="Revenue" sort="revenueGenerated" />
                <SortHeader label="Avg/Rental" sort="avgRevenuePerRental" />
                <SortHeader label="Utilization" sort="utilizationPct" />
                <SortHeader label="Days Idle" sort="daysIdle" />
                <th className="px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100/50">
              {paginatedItems.map(item => (
                <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-gray-900">{item.name}</td>
                  <td className="px-4 py-3 text-gray-500">{item.category}</td>
                  <td className="px-4 py-3 text-gray-700">₱{item.price.toLocaleString()}</td>
                  <td className="px-4 py-3 font-semibold">{item.totalRentals}</td>
                  <td className="px-4 py-3 font-semibold text-emerald-600">₱{item.revenueGenerated.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">₱{item.avgRevenuePerRental.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${item.utilizationPct > 75 ? 'bg-emerald-500' : item.utilizationPct > 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                          style={{ width: `${item.utilizationPct}%` }} />
                      </div>
                      <span className="text-[11px] font-semibold text-gray-600">{item.utilizationPct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.daysIdle !== null ? `${item.daysIdle}d` : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      item.status === 'Available' ? 'bg-emerald-50 text-emerald-600' :
                      item.status === 'Rented' ? 'bg-blue-50 text-blue-600' :
                      item.status === 'Cleaning' ? 'bg-orange-50 text-orange-600' :
                      item.status === 'Damaged' ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-600'
                    }`}>{item.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-3 border-t border-gray-100/80 bg-gray-50/30">
            <span className="text-xs text-gray-500 font-medium">
              {sortedItems.length} items · Page {page + 1} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-full disabled:opacity-30 transition-colors">
                Prev
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => (
                <button key={i} onClick={() => setPage(i)}
                  className={`w-7 h-7 md:w-8 md:h-8 text-xs font-bold rounded-full transition-colors ${i === page ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                  {i + 1}
                </button>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-full disabled:opacity-30 transition-colors">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

