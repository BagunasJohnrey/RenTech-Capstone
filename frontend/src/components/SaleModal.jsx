import { useState, useEffect, useCallback } from 'react';
import { X, Tag, Loader2 } from 'lucide-react';
import { inventoryService } from '../services';
import { getSaleInfo } from './ItemCard';
import ItemImage from './ItemImage';
import { Skeleton } from './Skeleton';
import { useEscapeClose } from '../hooks/useEscapeClose';

// Admin-only quick sale editor: opened from the Insights clearance /
// never-rented lists so idle pieces go on sale without leaving the page.
// Mirrors ItemForm's sale semantics (salePrice wins, else % off regular).
// autoCheck: toggle starts ON (put-on-sale intent) instead of echoing the item.
export default function SaleModal({ itemId, onClose, onSaved, autoCheck = true }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [onSale, setOnSale] = useState(false);
  const [discountPct, setDiscountPct] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleEndsAt, setSaleEndsAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Timed exit like the other sheets: play the fade/slide-out, then unmount.
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 150);
  }, [closing, onClose]);
  useEscapeClose(requestClose);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    inventoryService.get(itemId)
      .then((data) => {
        if (cancelled) return;
        setItem(data);
        setOnSale(autoCheck ? true : !!data.onSale);
        setDiscountPct(data.discountPct ?? '');
        setSalePrice(data.salePrice ?? '');
        setSaleEndsAt(data.saleEndsAt ? new Date(data.saleEndsAt).toISOString().slice(0, 10) : '');
      })
      .catch((err) => { if (!cancelled) setLoadError(err?.message || 'Could not load this item.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [itemId]);

  // Live preview using the same canonical math as every price display.
  const preview = item
    ? getSaleInfo({
        ...item,
        onSale,
        discountPct: discountPct === '' ? null : Number(discountPct),
        salePrice: salePrice === '' ? null : Number(salePrice),
        saleEndsAt: saleEndsAt ? new Date(saleEndsAt).toISOString() : null,
      })
    : null;

  const pctNum = discountPct === '' ? null : Number(discountPct);
  const invalidPct = pctNum !== null && (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100);

  const handleSave = async () => {
    if (saving || invalidPct) return;
    setSaveError('');
    setSaving(true);
    try {
      const result = await inventoryService.update(itemId, {
        onSale,
        discountPct: discountPct === '' ? null : Number(discountPct),
        salePrice: salePrice === '' ? null : Number(salePrice),
        saleEndsAt: saleEndsAt ? new Date(saleEndsAt).toISOString() : null,
      });
      onSaved?.(result);
      requestClose();
    } catch (err) {
      setSaveError(err?.message || 'Could not save the sale.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-[320] transition-opacity duration-150 ${closing ? 'opacity-0' : 'opacity-100'}`}>
      <div className={`fixed inset-0 bg-gray-900/40 backdrop-blur-sm ${closing ? 'animate-out fade-out duration-150' : 'animate-in fade-in duration-200'}`} onClick={requestClose} />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4 pointer-events-none">
        <div role="dialog" aria-modal="true" aria-label="Put item on sale"
          className={`bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-sm max-h-[92dvh] sm:max-h-[85vh] flex flex-col overflow-hidden pointer-events-auto transform-gpu ${closing ? 'animate-out slide-out-to-bottom sm:zoom-out-95 fade-out duration-150' : 'animate-in slide-in-from-bottom sm:zoom-in-95 duration-200'}`}
          onClick={e => e.stopPropagation()}>
          <div className="shrink-0 flex items-center gap-3 p-5 sm:p-6 border-b border-gray-100/80">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center shrink-0">
              <Tag size={18} className="text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 leading-tight">On Sale (Admin)</h3>
              <p className="text-xs text-gray-400 mt-0.5 truncate">{item?.name ?? 'Loading…'}</p>
            </div>
            <button onClick={requestClose} aria-label="Close sale editor"
              className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors shrink-0">
              <X size={17} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 overscroll-contain p-5 sm:p-6">
            {loading ? (
              <div className="space-y-3" aria-hidden="true">
                <Skeleton className="h-[68px] rounded-2xl" />
                <Skeleton className="h-[120px] rounded-2xl" />
              </div>
            ) : loadError ? (
              <p className="text-sm text-red-600 bg-red-50 rounded-2xl px-4 py-3">{loadError}</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 bg-gray-50/70 border border-gray-100 rounded-2xl p-3">
                  <ItemImage image={item.image} alt={item.name} thumb className="w-12 h-12 rounded-xl object-cover shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-gray-900 text-sm truncate">{item.name}</p>
                    <p className="text-xs text-gray-500">
                      {preview?.active ? (
                        <>₱{preview.price.toLocaleString()} <span className="text-emerald-600 font-bold">on sale</span> <span className="line-through text-gray-400">₱{Number(item.price).toLocaleString()}</span></>
                      ) : (
                        <>₱{Number(item.price).toLocaleString()} regular price</>
                      )}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer shrink-0">
                    <span className="text-[11px] font-bold text-gray-500">Sale</span>
                    <input type="checkbox" checked={onSale} onChange={(e) => setOnSale(e.target.checked)}
                      className="h-4 w-4 accent-[#bf4a53]" aria-label="On sale" />
                  </label>
                </div>

                {onSale && (
                  <div className="grid grid-cols-2 gap-3 animate-in fade-in duration-150">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Discount %</label>
                      <input type="number" min="0" max="100" value={discountPct}
                        onChange={(e) => setDiscountPct(e.target.value)}
                        placeholder="0"
                        className={`w-full bg-white border rounded-2xl px-4 py-2.5 text-[13px] font-medium focus:outline-none transition-colors ${invalidPct ? 'border-red-300' : 'border-gray-200/80 focus:border-gray-400'}`}
                      />
                      {invalidPct && <p className="text-[11px] text-red-500 font-medium">0–100 only</p>}
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Sale Price ₱</label>
                      <input type="number" min="0" value={salePrice}
                        onChange={(e) => setSalePrice(e.target.value)}
                        placeholder="optional"
                        className="w-full bg-white border border-gray-200/80 rounded-2xl px-4 py-2.5 text-[13px] font-medium focus:outline-none focus:border-gray-400 transition-colors"
                      />
                    </div>
                    <div className="col-span-2 space-y-1.5">
                      <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Sale Ends (optional)</label>
                      <input type="date" value={saleEndsAt}
                        onChange={(e) => setSaleEndsAt(e.target.value)}
                        className="w-full bg-white border border-gray-200/80 rounded-2xl px-4 py-2.5 text-[13px] font-medium focus:outline-none focus:border-gray-400 transition-colors"
                      />
                    </div>
                    <p className="col-span-2 text-[11px] text-gray-400">
                      Leave sale price empty to apply % off the regular price.
                    </p>
                  </div>
                )}

                {saveError && <p className="text-xs text-red-600 font-medium bg-red-50 rounded-xl px-3 py-2">{saveError}</p>}
              </div>
            )}
          </div>

          {!loading && !loadError && (
            <div className="shrink-0 bg-white/95 backdrop-blur-md border-t border-gray-100/80 px-5 sm:px-6 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-b-3xl">
              <div className="grid grid-cols-2 gap-3">
                <button onClick={requestClose}
                  className="py-3 text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-2xl transition-colors border border-gray-200">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving || invalidPct}
                  className="py-3 text-sm font-bold text-white rounded-2xl bg-[#bf4a53] hover:bg-red-700 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving && <Loader2 size={15} className="animate-spin" />}
                  {saving ? 'Saving…' : 'Save Sale'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
