import { useState, useMemo } from 'react';
import { Search, X, SlidersHorizontal, ChevronDown, Check, BadgePercent, Trash2 } from 'lucide-react';
import ItemCard, { getSaleInfo } from '../components/ItemCard';
import { SkeletonGrid } from '../components/Skeleton';
import { itemPill } from '../utils/statusColors';

const ADMIN_STATUSES = ['All', 'Available', 'Rented', 'Reserved', 'Cleaning', 'OutOfService', 'Deleted'];
const STAFF_STATUSES = ['All', 'Available', 'Rented', 'Reserved', 'Cleaning', 'OutOfService'];
const CUSTOMER_STATUSES = ['All', 'Available'];

const META_MAP = {
  All: 'bg-gray-900 text-white',
  Available: `${itemPill('Available').dot} text-white`,
  Rented: `${itemPill('Rented').dot} text-white`,
  Reserved: `${itemPill('Reserved').dot} text-white`,
  Cleaning: `${itemPill('Cleaning').dot} text-white`,
  OutOfService: `${itemPill('OutOfService').dot} text-white`,
  Deleted: `${itemPill('Deleted').dot} text-white`,
};

export default function CatalogView({ role, inventory, onCustomerBook, onEdit, onStatusChange, onMarkOutOfService, onStaffBookItem, onCheckAvailability, onRestore, onRequestDelete, loading, guest, onGuestBook, onExitGuest, onViewDetail }) {
  const isStaff = role !== 'Customer';
  const STATUSES = role === 'Admin' ? ADMIN_STATUSES : isStaff ? STAFF_STATUSES : CUSTOMER_STATUSES;
  const [searchQuery, setSearchQuery] = useState('');

  const [showFilters, setShowFilters] = useState(false);

  const [activeStatusFilter, setActiveStatusFilter] = useState('All');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [activeSizeFilter, setActiveSizeFilter] = useState('All');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [onSaleOnly, setOnSaleOnly] = useState(false);

  const allCategories = useMemo(() => {
    const set = new Set(inventory.map(item => item.category));
    return Array.from(set).sort();
  }, [inventory]);

  const allSizes = useMemo(() => {
    const set = new Set(inventory.map(item => item.size).filter(Boolean));
    return ['All', ...Array.from(set).sort()];
  }, [inventory]);

  const deletedCount = useMemo(
    () => inventory.filter(item => item.status === 'Deleted').length,
    [inventory]
  );

  const onSaleCount = useMemo(
    () => inventory.filter(item => getSaleInfo(item).active).length,
    [inventory]
  );

  const activeFilterCount = (activeStatusFilter !== 'All' ? 1 : 0)
    + (selectedCategories.length > 0 ? 1 : 0)
    + (activeSizeFilter !== 'All' ? 1 : 0)
    + (minPrice !== '' || maxPrice !== '' ? 1 : 0)
    + (onSaleOnly ? 1 : 0);

  const filteredInventory = useMemo(() => {
    const filtered = inventory.filter(item => {
      const q = searchQuery.toLowerCase();
      if (q && !item.name.toLowerCase().includes(q) && !item.category.toLowerCase().includes(q)) return false;
      if (activeStatusFilter === 'All' && item.status === 'Deleted') return false;
      if (activeStatusFilter !== 'All' && item.status !== activeStatusFilter) return false;
      if (selectedCategories.length > 0 && !selectedCategories.includes(item.category)) return false;
      if (activeSizeFilter !== 'All' && item.size !== activeSizeFilter) return false;
      if (minPrice !== '' && item.price < Number(minPrice)) return false;
      if (maxPrice !== '' && item.price > Number(maxPrice)) return false;
      if (onSaleOnly && !getSaleInfo(item).active) return false;
      return true;
    });
    if (!isStaff) {
      filtered.sort((a) => (a.status === 'Available' ? -1 : 1));
    }
    return filtered;
  }, [inventory, searchQuery, activeStatusFilter, selectedCategories, activeSizeFilter, minPrice, maxPrice, onSaleOnly, isStaff]);

  const clearFilters = () => {
    setActiveStatusFilter('All');
    setSelectedCategories([]);
    setActiveSizeFilter('All');
    setMinPrice('');
    setMaxPrice('');
    setOnSaleOnly(false);
  };

  const toggleCategory = (cat) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const handleItemAction = (item) => {
    if (guest) {
      onViewDetail?.(item);
      return;
    }
    if (role === 'Customer') {
      onCustomerBook(item);
    } else if (role === 'Staff') {
      onStaffBookItem(item);
    }
  };

  const sizeOptions = allSizes.map(s => ({ value: s, label: s }));

  return (
    <div className="space-y-4">
      {/* Inventory Health KPIs — Admin only */}
      {role === 'Admin' && (
        <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-900">Inventory Health</h3>
            <span className="text-[11px] font-semibold text-gray-500 tabular-nums">{inventory.length} items total</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
            {[
              { label: 'Available', status: 'Available' },
              { label: 'Rented', status: 'Rented' },
              { label: 'Reserved', status: 'Reserved' },
              { label: 'In Cleaning', status: 'Cleaning' },
              { label: 'Out of Service', status: 'OutOfService' },
            ].map(({ label, status }) => {
              const pill = itemPill(status);
              const Icon = pill.icon;
              const count = inventory.filter(i => i.status === status).length;
              const pct = inventory.length > 0 ? Math.round((count / inventory.length) * 100) : 0;
              const active = activeStatusFilter === status;
              return (
                <button
                  key={status}
                  onClick={() => setActiveStatusFilter(active ? 'All' : status)}
                  title={`Filter by ${label}`}
                  className={`group rounded-xl border p-3 text-left transition-all min-w-0 bg-white ${pill.border} ${
                    active ? 'ring-2 ring-gray-900/70 shadow-sm' : 'hover:shadow-sm hover:-translate-y-0.5'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
                    <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${pill.bg} ${pill.text}`}>
                      <Icon size={12} strokeWidth={2.5} />
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 truncate">{label}</span>
                  </div>
                  <p className={`text-xl sm:text-2xl font-bold tabular-nums ${pill.text}`}>{count}</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <div className="flex-1 h-1 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pill.dot}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[9px] font-semibold text-gray-400 tabular-nums shrink-0">{pct}%</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 pt-2.5 border-t border-gray-100 grid grid-cols-2 gap-2.5 sm:gap-3">
            <button
              onClick={() => setOnSaleOnly(!onSaleOnly)}
              title="Filter: On Sale"
              className={`flex items-center justify-between rounded-xl border px-3 py-2 transition-all ${
                onSaleOnly
                  ? 'ring-2 ring-[#bf4a53]/60 bg-[#bf4a53]/5 border-[#bf4a53]/40'
                  : 'bg-white border-gray-200 hover:border-[#bf4a53]/40 hover:bg-[#bf4a53]/5'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <BadgePercent size={14} className="text-[#bf4a53] shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 truncate">On Sale</span>
              </span>
              <span className="text-sm font-bold text-[#bf4a53] tabular-nums">{onSaleCount}</span>
            </button>
            <button
              onClick={() => setActiveStatusFilter(activeStatusFilter === 'Deleted' ? 'All' : 'Deleted')}
              title="Filter: Archived"
              className={`flex items-center justify-between rounded-xl border px-3 py-2 transition-all ${
                activeStatusFilter === 'Deleted'
                  ? 'ring-2 ring-gray-900/70 bg-gray-100 border-gray-300'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <Trash2 size={14} className="text-gray-400 shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 truncate">Archived</span>
              </span>
              <span className="text-sm font-bold text-gray-500 tabular-nums">{deletedCount}</span>
            </button>
          </div>
        </div>
      )}

      {/* Search + Filter toggle row */}
      <div className="flex items-center gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder={isStaff ? 'Search items by name or category...' : 'Search (e.g. Gatsby, Suit)...'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 transition-colors"
          />
        </div>
        <button onClick={() => setShowFilters(!showFilters)}
          className={`relative flex items-center justify-center w-9 h-9 rounded-lg border transition-colors shrink-0 ${
            showFilters || activeFilterCount > 0
              ? 'bg-gray-900 text-white border-gray-900'
              : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'
          }`}>
          <SlidersHorizontal size={16} />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#bf4a53] text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
              {activeFilterCount}
            </span>
          )}
        </button>
        <div className="text-xs text-gray-500 whitespace-nowrap tabular-nums">
          <span className="font-semibold text-gray-900">{filteredInventory.length}</span><span className="text-gray-400">/{inventory.length}</span>
        </div>
      </div>

      {/* Status rail — staff/admin only (persistent, live counts, one-tap filter) */}
      {isStaff && (
        <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar -mx-1 px-1 pb-1">
          {STATUSES.map(s => {
            const active = activeStatusFilter === s;
            const count = s === 'All' ? inventory.filter(i => i.status !== 'Deleted').length : inventory.filter(i => i.status === s).length;
            return (
              <button key={s} type="button" onClick={() => setActiveStatusFilter(s)} aria-pressed={active}
                className={`shrink-0 inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                  active ? `${META_MAP[s] || 'bg-gray-900'} text-white shadow-sm` : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:text-gray-800'
                }`}>
                {s}
                <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center tabular-nums ${active ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Category rail — shown for guests/customers under the search bar */}
      {(!isStaff || guest) && allCategories.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar -mx-1 px-1 pb-1">
          {['All', ...allCategories].map(cat => {
            const active = cat === 'All' ? selectedCategories.length === 0 : selectedCategories.includes(cat);
            return (
              <button key={cat} type="button"
                onClick={() => setSelectedCategories(cat === 'All' ? [] : [cat])}
                aria-pressed={active}
                className={`shrink-0 px-4 py-2 rounded-full text-xs md:text-sm font-bold transition-all whitespace-nowrap ${
                  active
                    ? 'bg-gray-950 text-white shadow-sm'
                    : 'bg-white text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-400'
                }`}>
                {cat}
              </button>
            );
          })}
        </div>
      )}

      {/* Modern filter toolbar */}
      {showFilters && (
        <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Status pills — hidden for staff (dedicated rail above) */}
          {!isStaff && (
          <div className="px-4 py-3 border-b border-gray-50">
            <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar">
              {STATUSES.map(s => {
                const active = activeStatusFilter === s;
                const count = s !== 'All' ? inventory.filter(i => i.status === s).length : '';
                return (
                  <button key={s} onClick={() => setActiveStatusFilter(s)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                      active
                        ? 'bg-gray-900 text-white shadow-sm'
                        : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 border border-gray-200/50'
                    }`}>
                    {s === 'All' ? 'All' : s}{count ? ` ${count}` : ''}
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {/* On Sale toggle */}
          <div className="px-4 py-2 border-b border-gray-50">
            <button onClick={() => setOnSaleOnly(v => !v)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                onSaleOnly
                  ? 'bg-red-50 text-red-700 border border-red-200 shadow-sm'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 border border-gray-200/50'
              }`}>
              <BadgePercent size={13} />
              On Sale
            </button>
          </div>

        {/* Category + Size + Price row */}
          <div className="px-4 py-3 space-y-3">
            {/* Category pills (multi-select) */}
            <div>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Category</span>
              <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar">
                {allCategories.map(cat => {
                  const active = selectedCategories.includes(cat);
                  return (
                    <button key={cat} onClick={() => toggleCategory(cat)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                        active
                          ? 'bg-[#bf4a53] text-white shadow-sm'
                          : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 border border-gray-200/50'
                      }`}>
                      {active && <Check size={10} className="inline mr-1 -mt-0.5" />}
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Size (staff only) */}
              {isStaff && sizeOptions.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Size</span>
                  <div className="relative">
                    <select value={activeSizeFilter} onChange={e => setActiveSizeFilter(e.target.value)}
                      className="appearance-none bg-gray-50 border border-gray-200/60 rounded-lg py-1.5 pl-2.5 pr-7 text-xs font-medium text-gray-700 focus:outline-none focus:border-gray-400 transition-colors cursor-pointer min-w-[90px]">
                      {sizeOptions.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
                </div>
              )}

              {/* Price */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Price</span>
                <div className="flex items-center gap-1">
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">₱</span>
                    <input type="number" placeholder="Min" value={minPrice}
                      onChange={e => setMinPrice(e.target.value)}
                      className="w-[68px] pl-5 pr-2 py-1.5 bg-gray-50 border border-gray-200/60 rounded-lg text-xs font-medium focus:outline-none focus:border-gray-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  </div>
                  <span className="text-gray-300 text-[10px]">–</span>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">₱</span>
                    <input type="number" placeholder="Max" value={maxPrice}
                      onChange={e => setMaxPrice(e.target.value)}
                      className="w-[68px] pl-5 pr-2 py-1.5 bg-gray-50 border border-gray-200/60 rounded-lg text-xs font-medium focus:outline-none focus:border-gray-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Active filter chips + clear */}
          {activeFilterCount > 0 && (
            <div className="px-4 py-2.5 bg-gray-50/80 border-t border-gray-50 flex items-center gap-2 overflow-x-auto hide-scrollbar">
              {activeStatusFilter !== 'All' && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-full border border-gray-200 text-[10px] font-bold text-gray-700 shadow-sm">
                  {activeStatusFilter}
                  <button onClick={() => setActiveStatusFilter('All')} className="text-gray-400 hover:text-gray-600 ml-0.5">
                    <X size={11} />
                  </button>
                </span>
              )}
              {selectedCategories.map(cat => (
                <span key={cat} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-full border border-gray-200 text-[10px] font-bold text-gray-700 shadow-sm">
                  {cat}
                  <button onClick={() => toggleCategory(cat)} className="text-gray-400 hover:text-gray-600 ml-0.5">
                    <X size={11} />
                  </button>
                </span>
              ))}
              {activeSizeFilter !== 'All' && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-full border border-gray-200 text-[10px] font-bold text-gray-700 shadow-sm">
                  {activeSizeFilter}
                  <button onClick={() => setActiveSizeFilter('All')} className="text-gray-400 hover:text-gray-600 ml-0.5">
                    <X size={11} />
                  </button>
                </span>
              )}
              {(minPrice || maxPrice) && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-full border border-gray-200 text-[10px] font-bold text-gray-700 shadow-sm">
                  ₱{minPrice || '0'}–₱{maxPrice || '∞'}
                  <button onClick={() => { setMinPrice(''); setMaxPrice(''); }} className="text-gray-400 hover:text-gray-600 ml-0.5">
                    <X size={11} />
                  </button>
                </span>
              )}
              {onSaleOnly && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-full border border-gray-200 text-[10px] font-bold text-gray-700 shadow-sm">
                  On Sale
                  <button onClick={() => setOnSaleOnly(false)} className="text-gray-400 hover:text-gray-600 ml-0.5">
                    <X size={11} />
                  </button>
                </span>
              )}
              <button onClick={clearFilters}
                className="shrink-0 text-[10px] font-bold text-gray-400 hover:text-[#bf4a53] transition-colors ml-1">
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

      {/* Availability check modal - overlay */}
      {/* Items */}
      <div>
      {loading && inventory.length === 0 ? (
          <SkeletonGrid count={isStaff ? 8 : 8} columns={isStaff ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'} />
        ) : filteredInventory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
            <Search size={32} className="text-gray-300" />
            <p className="text-sm font-medium">No items found</p>
            <button onClick={clearFilters} className="text-xs font-bold text-[#bf4a53] hover:underline">Clear filters</button>
          </div>
        ) : isStaff ? (
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-5 gap-3">
            {filteredInventory.map(item => (
              <ItemCard key={item.id} item={item} role={role} guest={guest}
                onBook={() => handleItemAction(item)}
                onViewDetail={onViewDetail}
                onEdit={() => onEdit(item)}
                onDelete={role === 'Admin' && onRequestDelete ? () => onRequestDelete(item) : undefined}
                onRestore={role === 'Admin' && onRestore ? () => onRestore(item.id) : undefined}
                onCheckAvailability={() => onCheckAvailability(item)}
                onStatusChange={onStatusChange}
                onMarkOutOfService={onMarkOutOfService}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredInventory.map(item => (
              <ItemCard key={item.id} item={item} role={role} guest={guest}
                onBook={() => handleItemAction(item)}
                onViewDetail={onViewDetail}
                onEdit={() => onEdit(item)}
                onDelete={role === 'Admin' && onRequestDelete ? () => onRequestDelete(item) : undefined}
                onRestore={role === 'Admin' && onRestore ? () => onRestore(item.id) : undefined}
                onCheckAvailability={() => onCheckAvailability(item)}
                onStatusChange={onStatusChange}
                onMarkOutOfService={onMarkOutOfService}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
