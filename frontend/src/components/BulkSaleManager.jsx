import { useState, useEffect, useMemo } from 'react';
import { Tag, Check, X, Loader2, Search, ChevronLeft, ChevronRight, Package } from 'lucide-react';
import { inventoryService } from '../services';
import ItemImage from './ItemImage';
import { SkeletonList } from './Skeleton';

const PAGE_SIZE = 8;

export default function BulkSaleManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [discountPct, setDiscountPct] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleEndsAt, setSaleEndsAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    inventoryService.list()
      .then(data => { if (Array.isArray(data)) setItems(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Sort: stagnant items first (fewest rentals), then by name.
  // Items with 0 rentals (never rented) appear first.
  const sorted = useMemo(() => {
    const filtered = search
      ? items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || i.category?.toLowerCase().includes(search.toLowerCase()))
      : items;
    return [...filtered].sort((a, b) => {
      const ra = a.rentalCount ?? 0;
      const rb = b.rentalCount ?? 0;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }, [items, search]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page when search changes
  useEffect(() => { setPage(1); }, [search]);

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const pagedIds = paged.map(i => i.id);
    const allSelected = pagedIds.every(id => selected.has(id));
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); pagedIds.forEach(id => n.delete(id)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); pagedIds.forEach(id => n.add(id)); return n; });
    }
  };

  const handleApply = async () => {
    if (selected.size === 0) { setMsg('Select at least one item.'); setTimeout(() => setMsg(''), 2500); return; }
    const pct = discountPct ? parseFloat(discountPct) : null;
    const price = salePrice ? parseFloat(salePrice) : null;
    if (pct === null && price === null) { setMsg('Enter a discount % or sale price.'); setTimeout(() => setMsg(''), 2500); return; }

    setSaving(true);
    try {
      await inventoryService.bulkSale(Array.from(selected), {
        onSale: true,
        discountPct: pct,
        salePrice: price,
        saleEndsAt: saleEndsAt || null,
      });
      // Update local state
      setItems(prev => prev.map(i => selected.has(i.id)
        ? { ...i, onSale: true, discountPct: pct, salePrice: price, saleEndsAt: saleEndsAt || null }
        : i
      ));
      setMsg(`${selected.size} item(s) put on sale!`);
      setSelected(new Set());
      setDiscountPct('');
      setSalePrice('');
      setSaleEndsAt('');
    } catch (err) {
      setMsg(err.message || 'Failed to apply sale');
    } finally {
      setSaving(false);
    }
    setTimeout(() => setMsg(''), 3000);
  };

  const handleClearSale = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await inventoryService.bulkSale(Array.from(selected), { onSale: false });
      setItems(prev => prev.map(i => selected.has(i.id) ? { ...i, onSale: false, discountPct: null, salePrice: null, saleEndsAt: null } : i));
      setMsg(`Sale cleared from ${selected.size} item(s).`);
      setSelected(new Set());
    } catch (err) {
      setMsg(err.message || 'Failed to clear sale');
    } finally {
      setSaving(false);
    }
    setTimeout(() => setMsg(''), 3000);
  };

  const allPagedSelected = paged.length > 0 && paged.every(i => selected.has(i.id));
  const allItemsSelected = sorted.length > 0 && sorted.every(i => selected.has(i.id));

  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-11 h-11 rounded-2xl bg-rose-50 text-[#bf4a53] flex items-center justify-center shrink-0">
            <Tag size={20} />
          </span>
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 text-base">On Sale</h3>
            <p className="text-xs text-gray-500 mt-0.5">Bulk discount items — stagnant stock prioritized</p>
          </div>
        </div>
        {selected.size > 0 && (
          <span className="shrink-0 text-[11px] font-bold text-[#bf4a53] bg-rose-50 px-3 py-1.5 rounded-full">
            {selected.size} selected
          </span>
        )}
      </div>

      {/* Bulk sale form */}
      <div className="bg-gray-50/70 border border-gray-100 rounded-2xl p-4 space-y-3">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Apply to selected</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Discount %</label>
            <input type="number" min={0} max={100} value={discountPct}
              onChange={e => setDiscountPct(e.target.value === '' ? '' : Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
              placeholder="0"
              className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-[#bf4a53]" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Sale Price ₱</label>
            <input type="number" min={0} step="0.01" value={salePrice}
              onChange={e => setSalePrice(e.target.value)}
              placeholder="optional"
              className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-[#bf4a53]" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Sale Ends</label>
            <input type="date" value={saleEndsAt} onChange={e => setSaleEndsAt(e.target.value)}
              className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-[#bf4a53]" />
          </div>
        </div>
        <p className="text-[11px] text-gray-400">Leave sale price empty to apply % off the regular price.</p>
        <div className="flex items-center gap-2 pt-1">
          <button onClick={handleApply} disabled={saving || selected.size === 0}
            className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-[#bf4a53] hover:bg-red-700 active:scale-[0.99] transition-all disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {saving ? 'Applying…' : 'Put on Sale'}
          </button>
          <button onClick={handleClearSale} disabled={saving || selected.size === 0}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 active:scale-[0.99] transition-all disabled:opacity-50">
            <X size={13} /> Clear Sale
          </button>
        </div>
      </div>

      {msg && <p className={`text-xs font-bold ${msg.includes('Failed') || msg.includes('Select') || msg.includes('Enter') ? 'text-amber-600' : 'text-emerald-600'}`}>{msg}</p>}

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search items…"
          className="w-full pl-9 pr-4 py-2.5 bg-gray-50 rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-[#bf4a53] focus:bg-white transition-all" />
      </div>

      {/* Item list */}
      {loading ? (
        <SkeletonList count={4} />
      ) : sorted.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No items found.</p>
      ) : (
        <>
          {/* Select all / page row */}
          <div className="flex items-center gap-3 px-1">
            <button onClick={() => {
              if (allItemsSelected) {
                setSelected(new Set());
              } else {
                setSelected(new Set(sorted.map(i => i.id)));
              }
            }}
              className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${allItemsSelected ? 'bg-[#bf4a53] border-[#bf4a53]' : 'border-gray-300 hover:border-gray-400'}`}>
              {allItemsSelected && <Check size={12} className="text-white" />}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium cursor-pointer" onClick={() => {
                if (allItemsSelected) { setSelected(new Set()); } else { setSelected(new Set(sorted.map(i => i.id))); }
              }}>
                Select all ({sorted.length})
              </span>
              <span className="text-gray-300">|</span>
              <span className="text-xs text-gray-400 font-medium cursor-pointer hover:text-gray-600" onClick={() => {
                if (allPagedSelected) {
                  setSelected(prev => { const n = new Set(prev); paged.forEach(i => n.delete(i.id)); return n; });
                } else {
                  setSelected(prev => { const n = new Set(prev); paged.forEach(i => n.add(i.id)); return n; });
                }
              }}>
                {allPagedSelected ? 'Deselect page' : 'Select page'} ({paged.length})
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {paged.map(item => {
              const isSelected = selected.has(item.id);
              const hasSale = !!item.onSale;
              return (
                <div key={item.id}
                  onClick={() => toggleSelect(item.id)}
                  className={`flex items-center gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${
                    isSelected ? 'border-[#bf4a53] bg-rose-50/50 shadow-sm' : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm'
                  }`}>
                  <button onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}
                    className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${
                      isSelected ? 'bg-[#bf4a53] border-[#bf4a53]' : 'border-gray-300'
                    }`}>
                    {isSelected && <Check size={12} className="text-white" />}
                  </button>
                  <div className="w-12 h-14 rounded-xl overflow-hidden bg-gray-100 shrink-0">
                    <ItemImage image={item.image} alt={item.name} thumb className="w-full h-full object-cover" placeholderSize={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
                    <p className="text-[11px] text-gray-500">{item.category} &middot; ₱{item.price}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(item.rentalCount ?? 0) === 0 && (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Never rented</span>
                    )}
                    {hasSale && (
                      <span className="text-[10px] font-bold text-[#bf4a53] bg-rose-50 px-2 py-0.5 rounded-full">On Sale</span>
                    )}
                    <span className="text-[10px] text-gray-400">{item.rentalCount ?? 0} rental{(item.rentalCount ?? 0) !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (() => {
            const pages = [];
            const addPage = (p) => pages.push(p);
            // Always show first page
            addPage(1);
            // Pages around current
            for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
              addPage(i);
            }
            // Always show last page
            if (totalPages > 1) addPage(totalPages);
            // Dedupe + build display list with ellipsis markers
            const display = [];
            let prev = 0;
            for (const p of pages) {
              if (p === prev) continue;
              if (p - prev > 1) display.push('...');
              display.push(p);
              prev = p;
            }
            return (
              <div className="flex items-center justify-center gap-1 pt-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-all">
                  <ChevronLeft size={16} />
                </button>
                {display.map((p, i) => p === '...' ? (
                  <span key={`e${i}`} className="px-1 text-gray-300 text-xs select-none">...</span>
                ) : (
                  <button key={p} onClick={() => setPage(p)}
                    className={`min-w-[32px] h-8 rounded-xl text-xs font-bold transition-all ${
                      page === p
                        ? 'bg-[#bf4a53] text-white shadow-sm'
                        : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>{p}</button>
                ))}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-all">
                  <ChevronRight size={16} />
                </button>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
