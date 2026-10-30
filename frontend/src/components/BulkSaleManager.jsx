import { useState, useEffect, useMemo } from 'react';
import { Tag, X, Loader2, Search, CalendarClock } from 'lucide-react';
import { inventoryService } from '../services';
import ItemImage from './ItemImage';
import { getSaleInfo } from './ItemCard';
import FilterChip from './ui/FilterChip';
import Pagination from './ui/Pagination';
import { useToast } from './Toast';

const PAGE_SIZE = 10;
const FILTERS = [
  { id: null, label: 'All' },
  { id: 'never', label: 'Never rented' },
  { id: 'onSale', label: 'On sale' },
];

const peso = (n) => `₱${Math.round(n).toLocaleString()}`;

// Pick items (stagnant stock first) and put them on sale in one batch. The
// item list comes from the app's inventory so sales applied elsewhere on the
// page show up here immediately; `onSalePatch` writes our changes back.
export default function BulkSaleManager({ items = [], onSalePatch, filter = null, onFilterChange }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [discountPct, setDiscountPct] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleEndsAt, setSaleEndsAt] = useState('');
  const [saving, setSaving] = useState(false);

  const counts = useMemo(() => ({
    null: items.length,
    never: items.filter(i => (i.rentalCount ?? 0) === 0).length,
    onSale: items.filter(i => getSaleInfo(i).active).length,
  }), [items]);

  // Sort: stagnant items first (fewest rentals), then by name.
  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter(i => filter !== 'never' || (i.rentalCount ?? 0) === 0)
      .filter(i => filter !== 'onSale' || getSaleInfo(i).active)
      .filter(i => !q || i.name.toLowerCase().includes(q) || i.category?.toLowerCase().includes(q))
      .sort((a, b) => ((a.rentalCount ?? 0) - (b.rentalCount ?? 0)) || a.name.localeCompare(b.name));
  }, [items, search, filter]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, filter]);

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allShownSelected = sorted.length > 0 && sorted.every(i => selected.has(i.id));
  const toggleAllShown = () => setSelected(prev => {
    const n = new Set(prev);
    sorted.forEach(i => (allShownSelected ? n.delete(i.id) : n.add(i.id)));
    return n;
  });

  const runBulk = async (sale, doneMsg) => {
    const ids = Array.from(selected);
    setSaving(true);
    try {
      await inventoryService.bulkSale(ids, sale);
      onSalePatch?.(ids, sale.onSale ? sale : { onSale: false, discountPct: null, salePrice: null, saleEndsAt: null });
      toastSuccess(doneMsg(ids.length));
      setSelected(new Set());
      return true;
    } catch (err) {
      toastError(err.message || 'Failed to update sale');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async () => {
    const pct = discountPct !== '' ? parseFloat(discountPct) : null;
    const price = salePrice !== '' ? parseFloat(salePrice) : null;
    if (!(pct > 0) && !(price > 0)) { toastError('Enter a discount % or a sale price.'); return; }
    const ok = await runBulk(
      { onSale: true, discountPct: pct, salePrice: price, saleEndsAt: saleEndsAt || null },
      n => `${n} item${n !== 1 ? 's' : ''} put on sale`,
    );
    if (ok) { setDiscountPct(''); setSalePrice(''); setSaleEndsAt(''); }
  };

  const handleClearSale = () => runBulk({ onSale: false }, n => `Sale cleared from ${n} item${n !== 1 ? 's' : ''}`);

  const inputCls = 'w-full h-10 px-3 bg-white rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/10';

  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm">
      {/* Toolbar */}
      <div className="p-4 md:p-5 space-y-3 border-b border-gray-100">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or category…"
            className="w-full h-10 pl-9 pr-4 bg-gray-50 rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-[#bf4a53] focus:bg-white transition-all" />
        </div>
        <div className="flex gap-2 overflow-x-auto -mx-1 px-1">
          {FILTERS.map(f => (
            <FilterChip key={String(f.id)} active={filter === f.id} count={counts[f.id]} onClick={() => onFilterChange?.(f.id)}>
              {f.label}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* List */}
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">No items match.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 px-4 md:px-5 py-2.5 bg-gray-50/60 border-b border-gray-100">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown}
                className="h-4 w-4 rounded accent-[#bf4a53]" />
              <span className="text-xs font-semibold text-gray-600">Select all {sorted.length}</span>
            </label>
            <span className="text-[11px] text-gray-400">Least rented first</span>
          </div>

          <ul className="divide-y divide-gray-100">
            {paged.map(item => {
              const isSelected = selected.has(item.id);
              const sale = getSaleInfo(item);
              const rentals = item.rentalCount ?? 0;
              return (
                <li key={item.id}>
                  <label className={`flex items-center gap-3 px-4 md:px-5 py-3 cursor-pointer transition-colors ${isSelected ? 'bg-rose-50/60' : 'hover:bg-gray-50/70'}`}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(item.id)}
                      className="h-4 w-4 rounded accent-[#bf4a53] shrink-0" />
                    <div className="w-11 h-14 rounded-xl overflow-hidden bg-gray-100 shrink-0">
                      <ItemImage image={item.image} alt={item.name} thumb className="w-full h-full object-cover" placeholderSize={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span>{item.category}</span>
                        <span className="text-gray-300">·</span>
                        <span className={rentals === 0 ? 'text-amber-600 font-semibold' : ''}>
                          {rentals === 0 ? 'Never rented' : `${rentals} rental${rentals !== 1 ? 's' : ''}`}
                        </span>
                        {sale.active && item.saleEndsAt && (
                          <>
                            <span className="text-gray-300">·</span>
                            <span className="inline-flex items-center gap-0.5"><CalendarClock size={10} />
                              ends {new Date(item.saleEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      {sale.active ? (
                        <>
                          <p className="text-sm font-bold text-[#bf4a53] tabular-nums">{peso(sale.price)}</p>
                          <p className="text-[11px] text-gray-400 line-through tabular-nums">{peso(item.price)}</p>
                        </>
                      ) : (
                        <p className="text-sm font-semibold text-gray-700 tabular-nums">{peso(item.price)}</p>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="p-4 md:p-5 border-t border-gray-100">
            {totalPages > 1
              ? <Pagination page={page} totalPages={totalPages} summary={`${sorted.length} items`} onPageChange={(p) => setPage(Math.min(totalPages, Math.max(1, p)))} />
              : <p className="text-[11px] text-gray-400 text-center">{sorted.length} item{sorted.length !== 1 ? 's' : ''}</p>}
          </div>
        </>
      )}

      {/* Action bar — appears once something is selected */}
      {selected.size > 0 && (
        <div className="sticky bottom-24 md:bottom-6 z-30 px-3 md:px-4 pb-3 md:pb-4">
          <div className="bg-gray-900 text-white rounded-2xl shadow-2xl shadow-gray-900/30 p-3 md:p-4 animate-in slide-in-from-bottom-2 fade-in duration-200">
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-sm font-bold">{selected.size} selected</p>
              <button onClick={() => setSelected(new Set())} className="text-[11px] font-semibold text-white/60 hover:text-white">Deselect</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_1.2fr_auto_auto] gap-2 items-end text-gray-900">
              <label className="block">
                <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">% off</span>
                <input type="number" min={0} max={100} value={discountPct} placeholder="20"
                  onChange={e => setDiscountPct(e.target.value === '' ? '' : Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                  className={`${inputCls} mt-1`} />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">or fixed ₱</span>
                <input type="number" min={0} step="0.01" value={salePrice} placeholder="Optional"
                  onChange={e => setSalePrice(e.target.value)} className={`${inputCls} mt-1`} />
              </label>
              <label className="block col-span-2 md:col-span-1">
                <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Ends</span>
                <input type="date" value={saleEndsAt} onChange={e => setSaleEndsAt(e.target.value)} className={`${inputCls} mt-1`} />
              </label>
              <button onClick={handleClearSale} disabled={saving}
                className="h-10 inline-flex items-center justify-center gap-1.5 px-4 rounded-xl text-xs font-bold text-white bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50">
                <X size={13} /> Clear sale
              </button>
              <button onClick={handleApply} disabled={saving}
                className="h-10 inline-flex items-center justify-center gap-1.5 px-5 rounded-xl text-xs font-bold text-white bg-[#bf4a53] hover:bg-red-700 transition-colors disabled:opacity-50">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} />}
                {saving ? 'Saving…' : 'Put on sale'}
              </button>
            </div>
            <p className="text-[11px] text-white/40 mt-2">A fixed price overrides the %. Leave “Ends” empty to run until cleared.</p>
          </div>
        </div>
      )}
    </div>
  );
}
