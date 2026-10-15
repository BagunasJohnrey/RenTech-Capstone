import { useState, useEffect } from 'react';
import { TrendingUp, RotateCcw, DollarSign } from 'lucide-react';
import { api } from '../utils/api';
import { useToast } from '../components/Toast';
import { Skeleton } from '../components/Skeleton';
import { itemPill } from '../utils/statusColors';

const PAGE_SIZE = 10;

const SORT_OPTIONS = [
  { key: 'revenueGenerated', label: 'Revenue' },
  { key: 'totalRentals', label: 'Rentals' },
  { key: 'utilizationPct', label: 'Utilization' },
  { key: 'avgRevenuePerRental', label: 'Avg / Rental' },
  { key: 'price', label: 'Price' },
  { key: 'daysIdle', label: 'Days Idle' },
  { key: 'name', label: 'Item Name' },
  { key: 'category', label: 'Category' },
];

export default function InventoryAnalyticsView({ noHeader, period, initialData, onViewItemTransactions }) {
  const [data, setData] = useState(initialData ?? null);
  const [sortKey, setSortKey] = useState('revenueGenerated');
  const [sortDesc, setSortDesc] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [txStatusFilter, setTxStatusFilter] = useState('All');
  const [page, setPage] = useState(0);
  const { error: toastError } = useToast();

  useEffect(() => {
    // When embedded in AI Insights, the parent already fetched (and cached)
    // /inventory/analytics for this period — skip the duplicate request.
    if (initialData) {
      setData(initialData);
      setPage(0);
      return;
    }
    const params = period && period !== 'Overall' ? `?period=${period.toLowerCase()}` : '';
    api.get(`/inventory/analytics${params}`).then(setData).catch((err) => {
      toastError(err?.message || 'Failed to load inventory analytics');
    });
  }, [period, initialData]);

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

  const { items, topByRevenue, topByUtilization, topByFrequency, topCategories } = data;

  // Top cards rank LINES (categories), not pieces — clicking one filters the
  // Item Performance table below to that line. Older backends omit
  // topCategories, so fall back to deriving from the item tops.
  const deriveCats = (list, metric) => {
    const m = new Map();
    for (const it of list) {
      const e = m.get(it.category) || { category: it.category, revenue: 0, utilization: 0, rentals: 0, units: 0, historyRentals: 0, _u: 0 };
      e.revenue += it.revenueGenerated || 0;
      e._u += it.utilizationPct || 0;
      e.rentals += it.totalRentals || 0;
      e.units += 1;
      m.set(it.category, e);
    }
    return [...m.values()].map(e => ({ ...e, utilization: e.units ? Math.round(e._u / e.units) : 0 }));
  };
  const cats = topCategories ?? {
    byRevenue: deriveCats(topByRevenue, 'revenue'),
    byUtilization: deriveCats(topByUtilization, 'utilization'),
    byFrequency: deriveCats(topByFrequency, 'rentals'),
  };

  const categories = [...new Set(items.map(i => i.category))].sort();
  // Canonical lifecycle order; only statuses present in the data get a pill.
  const STATUS_ORDER = ['Available', 'Rented', 'Reserved', 'Cleaning', 'OutOfService', 'Deleted'];
  const statuses = STATUS_ORDER.filter(s => items.some(i => i.status === s));
  // Transaction-status order mirrors the History tabs (Released = any handover
  // with photo proof). Counts items ever involved in such a transaction.
  // Older backends omit txStatuses — guard so the row hides until redeployed.
  const TX_STATUS_ORDER = ['Active', 'Overdue', 'Returned', 'Cancelled', 'Reserved', 'Released'];
  const matchesTx = (item, st) => st === 'Released' ? !!item.hasReleased : (item.txStatuses ?? []).includes(st);
  const txStatuses = TX_STATUS_ORDER.filter(s => items.some(i => matchesTx(i, s)));
  const filteredItems = items.filter(i =>
    (categoryFilter === 'All' || i.category === categoryFilter) &&
    (statusFilter === 'All' || i.status === statusFilter) &&
    (txStatusFilter === 'All' || matchesTx(i, txStatusFilter))
  );
  const resetFilters = () => { setCategoryFilter('All'); setStatusFilter('All'); setTxStatusFilter('All'); setPage(0); };
  const filtersActive = categoryFilter !== 'All' || statusFilter !== 'All' || txStatusFilter !== 'All';

  const sortedItems = [...filteredItems].sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey];
    // Nulls always last; strings compare alphabetically (was a broken
    // numeric subtraction → NaN → random order for name/category).
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const val = (typeof va === 'string' ? va.localeCompare(vb) : va - vb);
    return sortDesc ? -val : val;
  });

  const totalPages = Math.ceil(sortedItems.length / PAGE_SIZE);
  const paginatedItems = sortedItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const pageCount = Math.max(totalPages, 1);
  const visiblePages = pageCount <= 7
    ? Array.from({ length: pageCount }, (_, i) => i)
    : [...new Set([
        0, 1, 2,
        page - 1, page, page + 1,
        pageCount - 3, pageCount - 2, pageCount - 1,
      ])].filter(i => i >= 0 && i < pageCount).sort((x, y) => x - y);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDesc(!sortDesc);
    else { setSortKey(key); setSortDesc(true); }
    setPage(0);
  };

  // Tied values share the same rank (competition ranking:
  // rank = 1 + number of items strictly ahead). Lists arrive sorted desc
  // by their metric, so the first index holding the value is the rank.
  const rankOf = (list, item, key) => list.findIndex((t) => t[key] === item[key]) + 1;

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

      {/* Top Performers (by CATEGORY line) — 1-up on phones, 2-up on tablet (3rd spans full),
          3-up on desktop. Tapping a line filters the Item Performance table below. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        <div className="bg-white rounded-2xl p-5 border border-gray-100/80 shadow-sm">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <DollarSign size={20} className="text-emerald-500" /> Top by Revenue
          </h3>
          <div className="space-y-2">
            {cats.byRevenue.map((cat) => (
              <button key={cat.category} type="button" onClick={() => { setCategoryFilter(cat.category); setPage(0); }}
                title={`Show ${cat.category} items below`}
                className="w-full flex items-center justify-between gap-2 p-2 bg-gray-50 rounded-xl text-left hover:bg-gray-100 hover:ring-1 hover:ring-gray-200 transition-all">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-bold text-gray-400 w-4">{rankOf(cats.byRevenue, cat, 'revenue')}. </span>
                  <span className="text-xs font-semibold text-gray-900 truncate capitalize">{cat.category}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">{cat.units} pc{cat.units === 1 ? '' : 's'}</span>
                </div>
                <span className="text-xs font-bold text-emerald-600 shrink-0">₱{cat.revenue.toLocaleString()}</span>
              </button>
            ))}
            {cats.byRevenue.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No data yet</p>}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100/80 shadow-sm">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp size={20} className="text-blue-500" /> Top by Utilization
          </h3>
          <div className="space-y-2">
            {cats.byUtilization.map((cat) => (
              <button key={cat.category} type="button" onClick={() => { setCategoryFilter(cat.category); setPage(0); }}
                title={`Show ${cat.category} items below`}
                className="w-full flex items-center justify-between gap-2 p-2 bg-gray-50 rounded-xl text-left hover:bg-gray-100 hover:ring-1 hover:ring-gray-200 transition-all">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-bold text-gray-400 w-4">{rankOf(cats.byUtilization, cat, 'utilization')}.</span>
                  <span className="text-xs font-semibold text-gray-900 truncate capitalize">{cat.category}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">{cat.units} pc{cat.units === 1 ? '' : 's'}</span>
                </div>
                <span className="text-xs font-bold text-blue-600 shrink-0">{cat.utilization}%</span>
              </button>
            ))}
            {cats.byUtilization.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No data yet</p>}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100/80 shadow-sm md:col-span-2 xl:col-span-1">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <RotateCcw size={20} className="text-orange-500" /> Top by Frequency
          </h3>
          <div className="space-y-2">
            {cats.byFrequency.map((cat) => (
              <button key={cat.category} type="button" onClick={() => { setCategoryFilter(cat.category); setPage(0); }}
                title={`Show ${cat.category} items below`}
                className="w-full flex items-center justify-between gap-2 p-2 bg-gray-50 rounded-xl text-left hover:bg-gray-100 hover:ring-1 hover:ring-gray-200 transition-all">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-bold text-gray-400 w-4">{rankOf(cats.byFrequency, cat, 'rentals')}.</span>
                  <span className="text-xs font-semibold text-gray-900 truncate capitalize">{cat.category}</span>
                  {cat.historyRentals > 0 && (
                    <span className="text-[10px] font-bold text-violet-600 bg-violet-50 rounded-full px-1.5 py-0.5 shrink-0">+{cat.historyRentals}</span>
                  )}
                </div>
                <span className="text-xs font-bold text-orange-600 shrink-0">{cat.rentals}x</span>
              </button>
            ))}
            {cats.byFrequency.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No data yet</p>}
          </div>
        </div>
      </div>

      {/* Item list: sortable cards on mobile/tablet, full table on desktop (lg+) */}
      <div className="bg-white border border-gray-100/80 shadow-sm rounded-3xl overflow-hidden">

        {/* Section title + filters + result count */}
        <div className="px-4 md:px-5 pt-4 md:pt-5 pb-4 border-b border-gray-100/80 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 text-base md:text-lg">Item Performance</h3>
              <p className="text-xs text-gray-400 mt-0.5">Revenue, rentals and utilization per piece</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {filtersActive && (
                <button type="button"
                  onClick={resetFilters}
                  className="text-[11px] font-bold text-[#bf4a53] hover:text-red-700 transition-colors">
                  Reset
                </button>
              )}
              <span className="text-xs font-semibold text-gray-500 tabular-nums">
                {!filtersActive
                  ? `${items.length} items`
                  : `${filteredItems.length} of ${items.length}`}
              </span>
            </div>
          </div>
          {/* Filters — three compact dropdowns in one row */}
          <div className="grid grid-cols-3 gap-1.5">
            <label className="block min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Category</span>
              <select
                value={categoryFilter}
                onChange={e => { setCategoryFilter(e.target.value); setPage(0); }}
                className="w-full min-w-0 bg-gray-50 border border-gray-200/70 rounded-xl px-2 py-1.5 text-[11px] font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/10 capitalize truncate"
              >
                {['All', ...categories].map(cat => (
                  <option key={cat} value={cat}>
                    {cat === 'All' ? `All (${items.length})` : `${cat} (${items.filter(i => i.category === cat).length})`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Status</span>
              <select
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
                className="w-full min-w-0 bg-gray-50 border border-gray-200/70 rounded-xl px-2 py-1.5 text-[11px] font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#bf4a53]/20 truncate"
              >
                {['All', ...statuses].map(st => (
                  <option key={st} value={st}>
                    {st === 'All' ? `All (${items.length})` : `${st} (${items.filter(i => i.status === st).length})`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Transact.</span>
              <select
                value={txStatusFilter}
                onChange={e => { setTxStatusFilter(e.target.value); setPage(0); }}
                className="w-full min-w-0 bg-gray-50 border border-gray-200/70 rounded-xl px-2 py-1.5 text-[11px] font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-sky-600/20 truncate"
              >
                {['All', ...txStatuses].map(st => (
                  <option key={st} value={st}>
                    {st === 'All' ? `All (${items.length})` : `${st} (${items.filter(i => matchesTx(i, st)).length})`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Mobile + tablet sort bar */}
        <div className="flex lg:hidden items-center gap-2 px-4 py-3 border-b border-gray-100/80 bg-gray-50/50">
          <label htmlFor="inv-sort" className="text-xs font-semibold text-gray-500 shrink-0">Sort by</label>
          <select
            id="inv-sort"
            value={sortKey}
            onChange={e => { setSortKey(e.target.value); setSortDesc(true); setPage(0); }}
            className="flex-1 min-w-0 bg-white border border-gray-200 rounded-full px-3 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#bf4a53]/30"
          >
            {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <button
            onClick={() => setSortDesc(d => !d)}
            className="shrink-0 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors"
            title={sortDesc ? 'Sort ascending' : 'Sort descending'}
          >
            {sortDesc ? '↓' : '↑'}
          </button>
        </div>

        {/* Mobile / tablet cards */}
        <div className="lg:hidden">
          {paginatedItems.map(item => (
            <button key={item.id} type="button" onClick={() => onViewItemTransactions?.(item)}
              title={onViewItemTransactions ? `View transactions for ${item.name}` : undefined}
              className="w-full text-left p-4 border-b border-gray-100/60 last:border-0 space-y-3 hover:bg-gray-50/60 active:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-gray-900 truncate">{item.name}</p>
                  <p className="text-[11px] text-gray-400 capitalize">{item.category} · ₱{item.price.toLocaleString()}</p>
                </div>
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${itemPill(item.status).bg} ${itemPill(item.status).text}`}>{item.status}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-xs text-gray-500">Revenue</span>
                  <span className="font-bold text-emerald-600">₱{item.revenueGenerated.toLocaleString()}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-xs text-gray-500">Rentals</span>
                  <span className="font-bold text-gray-900">{item.totalRentals}x</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-xs text-gray-500">Avg / Rental</span>
                  <span className="font-semibold text-gray-700">₱{item.avgRevenuePerRental.toLocaleString()}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-xs text-gray-500">Days Idle</span>
                  <span className="font-semibold text-gray-700">{item.daysIdle !== null ? `${item.daysIdle}d` : '—'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 shrink-0">Utilization</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${item.utilizationPct > 75 ? 'bg-emerald-500' : item.utilizationPct > 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${item.utilizationPct}%` }} />
                </div>
                <span className="text-[11px] font-semibold text-gray-600 shrink-0">{item.utilizationPct}%</span>
              </div>
            </button>
          ))}
          {paginatedItems.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-10">
              {items.length === 0
                ? 'No items yet.'
                : `No ${[categoryFilter !== 'All' ? categoryFilter : null, statusFilter !== 'All' ? statusFilter : null, txStatusFilter !== 'All' ? txStatusFilter : null].filter(Boolean).join(' · ') || 'matching'} items.`}
            </p>
          )}
        </div>

        {/* Desktop table — unchanged from lg up */}
        <div className="hidden lg:block overflow-x-auto">
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
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    <button type="button" onClick={() => onViewItemTransactions?.(item)}
                      title={onViewItemTransactions ? `View transactions for ${item.name}` : undefined}
                      className="hover:text-[#bf4a53] hover:underline text-left transition-colors">
                      {item.name}
                    </button>
                  </td>
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
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${itemPill(item.status).bg} ${itemPill(item.status).text}`}>{item.status}</span>
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
              {visiblePages.map((idx, i) => (
                <span key={i} className="flex items-center">
                  {i > 0 && visiblePages[i - 1] !== idx - 1 && (
                    <span className="px-0.5 text-xs text-gray-300 select-none">…</span>
                  )}
                  <button onClick={() => setPage(idx)}
                    className={`w-7 h-7 md:w-8 md:h-8 text-xs font-bold rounded-full transition-colors ${idx === page ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                    {idx + 1}
                  </button>
                </span>
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

