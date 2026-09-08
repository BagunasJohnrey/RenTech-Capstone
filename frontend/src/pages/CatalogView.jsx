import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Search, X, SlidersHorizontal, ChevronDown, Check, BadgePercent, Trash2, ArrowUpDown, Package, Tag } from 'lucide-react';
import ItemCard, { getSaleInfo } from '../components/ItemCard';
import { FeaturedSkeleton } from '../components/Skeleton';
import { itemPill } from '../utils/statusColors';
import { categoryPriority, sortByCategory } from '../utils/categorySort';

const ADMIN_STATUSES = ['All', 'Available', 'Rented', 'Reserved', 'Cleaning', 'OutOfService', 'Deleted'];
const STAFF_STATUSES = ['All', 'Available', 'Rented', 'Reserved', 'Cleaning', 'OutOfService'];
const CUSTOMER_STATUSES = ['All', 'Available', 'Reserved', 'Advance'];

// For customers/guests, "Available" means truly free: no bookings at all.
// Items that are reserved for future dates but still free to rent outside
// those dates get their own "Reserved" chip so the filters stay honest.
const isFreeNow = (item) => item.status === 'Available';

// "Reserved" = free now but already booked for specific future dates — rent
// it only for non-conflicting dates (the booking flow validates this).
const isReservedOut = (item) => item.status === 'Reserved';

// "Advance" = currently rented out (in someone's hands now — including
// overdue pieces not yet returned) but still open for advance booking on other
// dates. The booking flow validates date conflicts.
const isBookedOut = (item) => item.status === 'Rented' || item.status === 'Overdue';

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
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef(null);

  const [showFilters, setShowFilters] = useState(false);

  const [activeStatusFilter, setActiveStatusFilter] = useState('All');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [activeSizeFilter, setActiveSizeFilter] = useState('All');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [onSaleOnly, setOnSaleOnly] = useState(false);
  const [sortBy, setSortBy] = useState('default');

  const allCategories = useMemo(() => {
    const set = new Set(inventory.map(item => item.category));
    return Array.from(set).sort((a, b) => categoryPriority({ category: a }) - categoryPriority({ category: b }));
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

  // Live "Available" count for the customer/guest rail: truly free items only.
  const availableCount = useMemo(
    () => inventory.filter(isFreeNow).length,
    [inventory]
  );

  // Live "Reserved" count: free now but already booked for future dates.
  const reservedCount = useMemo(
    () => inventory.filter(isReservedOut).length,
    [inventory]
  );

  // Live "Advance" count: currently rented out, still open for advance
  // booking on other dates.
  const bookedCount = useMemo(
    () => inventory.filter(isBookedOut).length,
    [inventory]
  );

const activeFilterCount = (activeStatusFilter !== 'All' ? 1 : 0)
    + (selectedCategories.length > 0 ? 1 : 0)
    + (activeSizeFilter !== 'All' ? 1 : 0)
    + (minPrice !== '' || maxPrice !== '' ? 1 : 0)
    + (onSaleOnly ? 1 : 0)
    + (sortBy !== 'default' ? 1 : 0);

  const filteredInventory = useMemo(() => {
    const filtered = inventory.filter(item => {
      const q = searchQuery.toLowerCase();
      if (q && !item.name.toLowerCase().includes(q) && !item.category.toLowerCase().includes(q)) return false;
      if (activeStatusFilter === 'All' && item.status === 'Deleted') return false;
      if (activeStatusFilter !== 'All') {
        // Customers/guests: "Available" = truly free (no bookings);
        // "Reserved" = free now but booked for future dates; "Advance" =
        // currently rented out but open for advance booking on other dates.
        // Staff/admin keep exact raw-status matching.
        const match = isStaff
          ? item.status === activeStatusFilter
          : activeStatusFilter === 'Available'
            ? isFreeNow(item)
            : activeStatusFilter === 'Reserved'
              ? isReservedOut(item)
              : activeStatusFilter === 'Advance'
                ? isBookedOut(item)
                : item.status === activeStatusFilter;
        if (!match) return false;
      }
      if (selectedCategories.length > 0 && !selectedCategories.includes(item.category)) return false;
      if (activeSizeFilter !== 'All' && item.size !== activeSizeFilter) return false;
      if (minPrice !== '' && item.price < Number(minPrice)) return false;
      if (maxPrice !== '' && item.price > Number(maxPrice)) return false;
      if (onSaleOnly && !getSaleInfo(item).active) return false;
      return true;
    });
    if (!isStaff && sortBy === 'default') {
      // Default sort for customers/guests: items not currently rented (free or
      // reserved with booked dates) first, then currently rented, then the rest.
      // Within each group, Filipino heritage items (Filipiniana, Barong) come first.
      const rank = (st) => st === 'Available' ? 0 : st === 'Reserved' ? 1 : st === 'Rented' ? 2 : 3;
      filtered.sort((a, b) => rank(a.status) - rank(b.status) || categoryPriority(a) - categoryPriority(b));
    } else if (sortBy === 'priceAsc') {
      filtered.sort((a, b) => a.price - b.price);
    } else if (sortBy === 'priceDesc') {
      filtered.sort((a, b) => b.price - a.price);
    } else if (sortBy === 'name') {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    }
    return filtered;
  }, [inventory, searchQuery, activeStatusFilter, selectedCategories, activeSizeFilter, minPrice, maxPrice, onSaleOnly, isStaff, sortBy]);

const clearFilters = () => {
    setActiveStatusFilter('All');
    setSelectedCategories([]);
    setActiveSizeFilter('All');
    setMinPrice('');
    setMaxPrice('');
    setOnSaleOnly(false);
    setSortBy('default');
  };

const toggleCategory = (cat) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  // Changes whenever a filter/search/toggle changes — keys the item grid so
  // it replays a quick fade on the way in instead of hard-swapping.
  const gridKey = JSON.stringify([activeStatusFilter, selectedCategories, activeSizeFilter, minPrice, maxPrice, onSaleOnly, searchQuery, sortBy]);

  // Search suggestions
  const suggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 1) return [];
    const seen = new Set();
    const results = [];
    // Category matches
    const cats = [...new Set(inventory.map(i => i.category))].filter(c => c.toLowerCase().includes(q));
    for (const c of cats.slice(0, 3)) {
      const key = `cat:${c}`;
      if (!seen.has(key)) { seen.add(key); results.push({ type: 'category', label: c, value: c }); }
    }
    // Item name matches
    const matchingItems = inventory.filter(i => i.name.toLowerCase().includes(q));
    for (const i of sortByCategory(matchingItems).slice(0, 5)) {
      const key = `item:${i.id}`;
      if (!seen.has(key)) { seen.add(key); results.push({ type: 'item', label: i.name, value: i.name, category: i.category }); }
    }
    return results;
  }, [searchQuery, inventory]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowSuggestions(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Infinite scroll: show 10 items at a time, persisted across navigations
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(() => {
    const saved = sessionStorage.getItem('catalog_visibleCount');
    return saved ? Number(saved) : PAGE_SIZE;
  });
  const sentinelRef = useRef(null);

  // Persist visible count and reset when filters change
  useEffect(() => {
    sessionStorage.setItem('catalog_visibleCount', String(visibleCount));
  }, [visibleCount]);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [gridKey]);

  // IntersectionObserver — re-attach whenever the sentinel element or data changes
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || filteredInventory.length === 0) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisibleCount((c) => c + PAGE_SIZE); },
      { rootMargin: '300px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [filteredInventory.length, visibleCount]);

  const displayedInventory = useMemo(
    () => filteredInventory.slice(0, visibleCount),
    [filteredInventory, visibleCount]
  );

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
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Inventory Health KPIs — Admin only */}
      {role === 'Admin' && (
        <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <Package size={14} className="text-gray-400" />
              Inventory Health
            </h3>
            <span className="text-[11px] font-semibold text-gray-500 tabular-nums">{inventory.length} items total</span>
          </div>

          {/* Status counts — 2-up on phones, 3-up on tablets, 5-up on desktop */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { label: 'Available', status: 'Available' },
              { label: 'Rented', status: 'Rented' },
              { label: 'Reserved', status: 'Reserved' },
              { label: 'In Cleaning', status: 'Cleaning' },
              { label: 'Out of Service', status: 'OutOfService' },
            ].map(({ label, status }) => {
              const pill = itemPill(status);
              const count = inventory.filter(i => i.status === status).length;
              const pct = inventory.length > 0 ? Math.round((count / inventory.length) * 100) : 0;
              const active = activeStatusFilter === status;
              return (
                <button
                  key={status}
                  onClick={() => setActiveStatusFilter(active ? 'All' : status)}
                  title={`Filter by ${label}`}
                  className={`bg-white rounded-2xl p-4 border text-left transition-all btn-press ${
                    active
                      ? 'ring-2 ring-gray-900/70 border-gray-200 shadow-sm'
                      : 'border-gray-100/80 shadow-sm hover:shadow-md hover:border-gray-200'
                  }`}
                >
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider truncate">{label}</p>
                  <p className={`text-2xl lg:text-3xl font-extrabold mt-1 tabular-nums ${count > 0 ? pill.text : 'text-gray-900'}`}>{count}</p>
                  <div className="mt-2.5 h-1 rounded-full bg-gray-100 overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${pill.dot}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[10px] font-semibold text-gray-400 mt-1 tabular-nums">{pct}% of items</p>
                </button>
              );
            })}
          </div>

          {/* On Sale + Archived toggles */}
          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-3">
            <button
              onClick={() => setOnSaleOnly(!onSaleOnly)}
              title="Filter: On Sale"
              className={`flex items-center justify-between rounded-xl border px-3 py-2.5 transition-all btn-press ${
                onSaleOnly
                  ? 'ring-2 ring-[#bf4a53]/60 bg-[#bf4a53]/5 border-[#bf4a53]/40'
                  : 'bg-white border-gray-200 hover:border-[#bf4a53]/40 hover:bg-[#bf4a53]/5'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${onSaleOnly ? 'bg-[#bf4a53] text-white' : 'bg-[#bf4a53]/10 text-[#bf4a53]'}`}>
                  <BadgePercent size={13} strokeWidth={2.5} />
                </span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600 truncate">On Sale</span>
              </span>
              <span className="text-sm font-bold text-[#bf4a53] tabular-nums">{onSaleCount}</span>
            </button>
            <button
              onClick={() => setActiveStatusFilter(activeStatusFilter === 'Deleted' ? 'All' : 'Deleted')}
              title="Filter: Archived"
              className={`flex items-center justify-between rounded-2xl border px-3 py-2.5 transition-all btn-press ${
                activeStatusFilter === 'Deleted'
                  ? 'ring-2 ring-gray-900/70 bg-gray-100 border-gray-300'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${activeStatusFilter === 'Deleted' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  <Trash2 size={13} strokeWidth={2.5} />
                </span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600 truncate">Archived</span>
              </span>
              <span className="text-sm font-bold text-gray-500 tabular-nums">{deletedCount}</span>
            </button>
          </div>
        </div>
      )}

{/* Search + Filter toggle row */}
      <div className="flex items-center gap-2.5">
        <div className="relative flex-1 min-w-0" ref={searchRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder={isStaff ? 'Search items by name or category...' : 'Search (e.g. Gatsby, Suit)...'}
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
            onFocus={() => { if (searchQuery.trim()) setShowSuggestions(true); }}
            className="w-full pl-9 pr-9 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 transition-colors"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setShowSuggestions(false); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors">
              <X size={12} className="text-gray-500" />
            </button>
          )}
          {/* Suggestions dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-50 top-full mt-1.5 left-0 right-0 bg-white rounded-2xl border border-gray-100 shadow-xl shadow-gray-950/10 overflow-hidden">
              {(() => {
                const cats = suggestions.filter(s => s.type === 'category');
                const items = suggestions.filter(s => s.type === 'item');
                return (
                  <>
                    {cats.length > 0 && (
                      <div className="p-2">
                        <p className="px-2.5 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Categories</p>
                        {cats.map((s, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setSelectedCategories(prev => prev.includes(s.value) ? prev : [...prev, s.value]);
                              setSearchQuery('');
                              setShowSuggestions(false);
                            }}
                            className="w-full flex items-center gap-3 px-2.5 py-2 hover:bg-[#bf4a53]/5 rounded-xl text-left transition-colors group"
                          >
                            <span className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-[#bf4a53]/10 to-orange-100 flex items-center justify-center group-hover:from-[#bf4a53] group-hover:to-orange-400 transition-all">
                              <Tag size={14} className="text-[#bf4a53] group-hover:text-white transition-colors" />
                            </span>
                            <span className="text-sm font-semibold text-gray-800">{s.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {cats.length > 0 && items.length > 0 && <div className="mx-3 border-t border-gray-100" />}
                    {items.length > 0 && (
                      <div className="p-2">
                        <p className="px-2.5 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Items</p>
                        {items.map((s, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setSearchQuery(s.value);
                              setShowSuggestions(false);
                            }}
                            className="w-full flex items-center gap-3 px-2.5 py-2 hover:bg-gray-50 rounded-xl text-left transition-colors group"
                          >
                            <span className="shrink-0 w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center group-hover:bg-gray-900 transition-colors">
                              <Search size={14} className="text-gray-400 group-hover:text-white transition-colors" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-800 truncate">{s.label}</p>
                              <p className="text-[11px] text-gray-400">{s.category}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
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

      {/* Category rail — staff/admin only (mirrors the status rail above;
          customers/guests get the combined rail below instead) */}
      {isStaff && (
        <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar -mx-1 px-1 pb-1">
          {['All', ...allCategories].map(cat => {
            const active = cat === 'All' ? selectedCategories.length === 0 : selectedCategories.includes(cat);
            const count = cat === 'All'
              ? inventory.filter(i => i.status !== 'Deleted').length
              : inventory.filter(i => i.category === cat && i.status !== 'Deleted').length;
            return (
              <button key={cat} type="button"
                onClick={() => {
                  if (cat === 'All') { setSelectedCategories([]); return; }
                  toggleCategory(cat);
                }}
                aria-pressed={active}
                className={`shrink-0 inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                  active ? 'bg-[#bf4a53] text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:text-gray-800'
                }`}>
                {cat}
                <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center tabular-nums ${active ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Category + Status rail — customers/guests combined */}
      {!isStaff && (
        <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar -mx-1 px-1 pb-1">
          {['All', ...allCategories].map(cat => {
            const active = cat === 'All' ? selectedCategories.length === 0 : selectedCategories.includes(cat);
            return (
              <button key={cat} type="button"
                onClick={() => {
                  if (cat === 'All') { setSelectedCategories([]); return; }
                  setSelectedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
                }}
                aria-pressed={active}
                className={`shrink-0 px-4 py-2 rounded-full text-xs md:text-sm font-bold transition-all whitespace-nowrap ${
                  active
                    ? 'bg-[#bf4a53] text-white shadow-sm'
                    : 'bg-white text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-400'
                }`}>
                {cat}
              </button>
            );
          })}
          <div className="w-px h-5 bg-gray-200 shrink-0 mx-0.5" />
          {CUSTOMER_STATUSES.filter(s => s !== 'All').map(s => {
            const active = activeStatusFilter === s;
            const title = s === 'Available'
              ? 'No bookings — free to rent now'
              : s === 'Reserved'
                ? 'Free now, but already reserved for upcoming dates'
                : s === 'Advance'
                  ? 'Currently rented out — still open for advance booking on other dates'
                  : undefined;
            return (
              <button key={s} type="button" title={title} onClick={() => setActiveStatusFilter(active ? 'All' : s)} aria-pressed={active}
                className={`shrink-0 px-4 py-2 rounded-full text-xs md:text-sm font-bold transition-all whitespace-nowrap ${
                  active ? 'bg-gray-900 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:text-gray-800'
                }`}>
                {s}
              </button>
            );
          })}
        </div>
      )}

      {/* Modern filter toolbar */}
      {showFilters && (
        <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-4 py-3 grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-3">
            {/* On Sale toggle */}
            <button onClick={() => setOnSaleOnly(v => !v)}
              className={`col-span-2 sm:col-span-1 shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all whitespace-nowrap ${
                onSaleOnly
                  ? 'bg-red-50 text-red-700 border border-red-200 shadow-sm'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 border border-gray-200/50'
              }`}>
              <BadgePercent size={15} />
              On Sale
            </button>

            {/* Sort */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider shrink-0">Sort</span>
              <div className="relative w-full sm:w-auto">
                <ArrowUpDown size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  className="w-full appearance-none bg-gray-50 border border-gray-200/60 rounded-lg py-2 pl-8 pr-8 text-sm font-medium text-gray-700 focus:outline-none focus:border-gray-400 transition-colors cursor-pointer">
                  {[
                    { value: 'default', label: isStaff ? 'Default' : 'Featured' },
                    { value: 'priceAsc', label: 'Price: Low–High' },
                    { value: 'priceDesc', label: 'Price: High–Low' },
                    { value: 'name', label: 'Name A–Z' },
                  ].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
            </div>

            {/* Price */}
            <div className="col-span-2 sm:col-span-1 flex items-center gap-2">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider shrink-0">Price</span>
              <div className="flex items-center gap-1.5 flex-1">
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">₱</span>
                  <input type="number" placeholder="Min" value={minPrice}
                    onChange={e => setMinPrice(e.target.value)}
                    className="w-full pl-7 pr-2 py-2 bg-gray-50 border border-gray-200/60 rounded-lg text-sm font-medium focus:outline-none focus:border-gray-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                </div>
                <span className="text-gray-300 text-xs shrink-0">–</span>
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">₱</span>
                  <input type="number" placeholder="Max" value={maxPrice}
                    onChange={e => setMaxPrice(e.target.value)}
                    className="w-full pl-7 pr-2 py-2 bg-gray-50 border border-gray-200/60 rounded-lg text-sm font-medium focus:outline-none focus:border-gray-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
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
              {sortBy !== 'default' && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-full border border-gray-200 text-[10px] font-bold text-gray-700 shadow-sm">
                  {sortBy === 'priceAsc' ? 'Price: Low–High' : sortBy === 'priceDesc' ? 'Price: High–Low' : 'Name A–Z'}
                  <button onClick={() => setSortBy('default')} className="text-gray-400 hover:text-gray-600 ml-0.5">
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

{/* Items */}
      <div key={gridKey} className="animate-in fade-in duration-300">
{loading && inventory.length === 0 ? (
          <FeaturedSkeleton count={8} />
        ) : filteredInventory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
            <Search size={32} className="text-gray-300" />
            <p className="text-sm font-medium">No items found</p>
            <button onClick={clearFilters} className="text-xs font-bold text-[#bf4a53] hover:underline">Clear filters</button>
          </div>
        ) : (
          <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {displayedInventory.map(item => (
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
          {/* Sentinel for infinite scroll */}
          <div ref={sentinelRef} className="h-1" />
          {visibleCount >= filteredInventory.length && filteredInventory.length > 0 && (
            <p className="text-center text-xs text-gray-400 pt-4 pb-2">You've reached the end of results</p>
          )}
          </>
        )}
      </div>
    </div>
  );
}
