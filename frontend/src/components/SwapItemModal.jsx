import { useState, useEffect, useRef, useCallback } from 'react';
import BottomSheet from './BottomSheet';
import { X, Repeat, Search, Loader2, CheckCircle, AlertTriangle, Tag } from 'lucide-react';
import { transactionsService, inventoryService } from '../services';
import { getSaleInfo } from './ItemCard';
import ItemImage from './ItemImage';
import { useToast } from './Toast';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useLockScroll } from '../hooks/useLockScroll';
import { useButtonGuard } from '../hooks/useButtonGuard';
import { customerLabel, itemLabel } from '../utils/format';

const peso = (n) => `₱${Number(n || 0).toLocaleString()}`;

// At-pickup item swap (staff only): the customer is at the counter and wants a
// different garment on the SAME booking record. The server re-derives the fee
// from the new item, carries the promo over when it still validates there
// (voids + hands the use back otherwise), keeps the downpayment as-is (no
// refunds), clears sizes, and voids the old release photo — so release must
// be (re)taken for the new item afterwards. This modal only swaps; it never
// releases.
//
// Mobile behaves like the release sheet: bottom-anchored, swipe-down to
// dismiss, footer pinned. Desktop: right-side panel.
export default function SwapItemModal({ transaction, inventory: inventoryProp = [], onClose, onSwapped }) {
  // Freeze the page behind the sheet; the backdrop is tap-to-close only.
  useLockScroll(true);
  const { success: toastSuccess } = useToast();
  // Staff pickers (History) pass inventory down; the release sheet doesn't
  // carry it, so fall back to a direct fetch (array shape, like useInventory).
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    if (inventoryProp.length > 0 || fetched) return;
    let active = true;
    inventoryService.list().then((data) => { if (active) setFetched(Array.isArray(data) ? data : []); }).catch(() => { if (active) setFetched([]); });
    return () => { active = false; };
  }, [inventoryProp.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const inventory = inventoryProp.length > 0 ? inventoryProp : (fetched ?? []);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [check, setCheck] = useState({ checking: false, available: null, reason: '' });
  const [swapError, setSwapError] = useState('');
  const { guarding: swapping, guard: guardSwap } = useButtonGuard();

  // BottomSheet owns motion + swipe-to-dismiss; closing is blocked mid-swap
  // (interceptClose hands the close straight back here, where it no-ops).
  const requestClose = useCallback(() => {
    if (!swapping) onClose();
  }, [swapping, onClose]);
  useEscapeClose(requestClose);

  const oldFee = Number(transaction.rentalFee ?? transaction.amount ?? 0);
  const paid = Number(transaction.totalPaid ?? transaction.downpayment ?? 0);
  const candidates = inventory.filter((i) => i.id !== transaction.itemId && i.status === 'Available');
  const q = query.trim().toLowerCase();
  const visible = (q
    ? candidates.filter((i) => `${i.name || ''} ${i.category || ''}`.toLowerCase().includes(q))
    : candidates
  ).slice(0, 30);
  const selected = candidates.find((i) => i.id === selectedId) || null;
  const newFee = selected ? Number(getSaleInfo(selected).price ?? selected.price ?? 0) : 0;
  const newBalance = Math.max(0, newFee - paid);
  const diff = newFee - oldFee;

  // Re-check availability whenever the picked item changes (same backend
  // overlap logic as booking — the swap endpoint re-checks atomically too,
  // so a 409 here just means "picked just now, choose another").
  useEffect(() => {
    if (!selected) { setCheck({ checking: false, available: null, reason: '' }); return; }
    let active = true;
    setCheck({ checking: true, available: null, reason: '' });
    setSwapError('');
    inventoryService
      .availability(selected.id, transaction.rentalDate, transaction.dueDate)
      .then((res) => { if (active) setCheck({ checking: false, available: res.available, reason: res.reason || '' }); })
      .catch(() => { if (active) setCheck({ checking: false, available: null, reason: '' }); });
    return () => { active = false; };
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const canConfirm = selected && check.available === true && !swapping;

  const handleConfirm = () => {
    if (!canConfirm) return;
    guardSwap(async () => {
      setSwapError('');
      try {
        const result = await transactionsService.swapItem(transaction.id, { newItemId: selected.id });
        toastSuccess(`Booking moved to ${selected.name}`);
        onSwapped?.(result, transaction.itemId);
        onClose();
      } catch (err) {
        if (err?.status === 409) setSwapError(err.message || 'That item was just taken — pick another');
        else setSwapError(err?.message || 'Failed to swap item');
      }
    });
  };

  return (
    <BottomSheet columns onClose={requestClose} labelledby="dialog-title-swap-item" z="z-[10000]" maxWidth="sm:max-w-lg" interceptClose={swapping} hideHandle>
          <div className="shrink-0 overflow-hidden rounded-t-3xl">
            <div className="bg-white pt-2 pb-1 flex justify-center sm:hidden" aria-hidden="true">
              <div className="w-10 h-1 rounded-full bg-gray-200" />
            </div>
            <div className="bg-white flex justify-between items-center p-5 sm:p-6 border-b border-gray-100/80">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 rounded-xl">
                  <Repeat size={18} className="text-blue-600" />
                </div>
                <div>
                  <h3 id="dialog-title-swap-item" className="font-bold text-lg text-gray-900">Swap Item</h3>
                  <p className="text-xs text-gray-500 truncate">{customerLabel(transaction.customer)} · now: {itemLabel(transaction.item)}</p>
                </div>
              </div>
              <button onClick={requestClose} aria-label="Close swap dialog" className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Desktop (lg+): picker on the left, fee summary docked as a right
              sidebar. Below lg: picker, then the summary pinned above the footer. */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          <div data-sheet-scroll className="p-5 sm:p-6 flex-1 overflow-y-auto min-h-0 overscroll-contain">
<div className="space-y-4">
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search available items…"
              className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200/80 rounded-xl text-sm focus:outline-none focus:border-blue-400"
            />
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-gray-400 font-medium text-center py-6">No available items match.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 lg:gap-3">
              {visible.map((item) => {
                const sale = getSaleInfo(item);
                const active = item.id === selectedId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`relative flex items-center gap-3 p-2.5 rounded-2xl border text-left transition-colors lg:flex-col lg:items-stretch lg:gap-0 lg:p-0 lg:overflow-hidden ${active ? 'border-blue-500 bg-blue-50/60' : 'border-gray-200/80 hover:border-gray-300 bg-white'}`}
                  >
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-gray-100 shrink-0 lg:w-full lg:h-auto lg:aspect-[4/5] lg:rounded-none">
                      <ItemImage thumb image={item.image} alt={item.name} className="w-full h-full object-cover" placeholderSize={18} />
                    </div>
                    <div className="flex-1 min-w-0 lg:p-3">
                      <p className="text-[13px] font-bold text-gray-900 truncate">{item.name}</p>
                      <p className="text-[11px] text-gray-500">{item.category} · {sale.active ? (<><span className="line-through">{peso(item.price)}</span> <span className="font-bold text-[#bf4a53]">{peso(sale.price)}</span></>) : peso(item.price)}</p>
                    </div>
                    {active && <CheckCircle size={16} className="text-blue-600 shrink-0 lg:absolute lg:top-2.5 lg:right-2.5 lg:w-6 lg:h-6 lg:bg-white lg:rounded-full lg:shadow-sm" />}
                  </button>
                );
              })}
            </div>
          )}
          {candidates.length > 30 && !q && (
            <p className="text-[10px] text-gray-400">Showing first 30 — search to narrow down.</p>
          )}

          {swapError && (
            <p className="text-xs font-semibold text-red-600 bg-red-50 px-3 py-2 rounded-lg">{swapError}</p>
          )}
          </div>
</div>

          {!selected && (
            <div className="hidden lg:flex lg:w-[320px] shrink-0 border-l border-gray-100/80 bg-gray-50/40 flex-col items-center justify-center text-center p-8">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-3">
                <Repeat size={22} className="text-blue-500" />
              </div>
              <p className="text-sm font-bold text-gray-700">Pick a replacement</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">The new fee, balance and availability for these dates show up here.</p>
            </div>
          )}

          {/* Price + availability summary — pinned above the footer (never
              scrolls) so the totals stay visible while picking on mobile. */}
          {selected && (
            <div className="shrink-0 border-t border-gray-100/80 px-5 sm:px-6 py-3 bg-white space-y-2 lg:w-[320px] lg:border-t-0 lg:border-l lg:py-6 lg:overflow-y-auto lg:space-y-3">
              {/* Desktop sidebar: the picked item, photo + full name. */}
              <div className="hidden lg:block">
                <div className="rounded-2xl overflow-hidden bg-gray-100 aspect-square">
                  <ItemImage image={selected.image} alt={selected.name} className="w-full h-full object-cover" placeholderSize={24} />
                </div>
                <p className="mt-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Swapping to</p>
                <p className="text-sm font-bold text-gray-900">{selected.name}</p>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Old fee</span><span className="font-bold text-gray-900">{peso(oldFee)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">New fee</span><span className="font-bold text-gray-900">{peso(newFee)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Already paid (kept)</span><span className="font-bold text-gray-900">{peso(paid)}</span></div>
                <div className="flex justify-between border-t border-gray-200/70 pt-1.5">
                  <span className="text-gray-500">New balance</span>
                  <span className={`font-bold ${newBalance > 0 ? 'text-[#bf4a53]' : 'text-emerald-600'}`}>{newBalance > 0 ? peso(newBalance) : 'Nothing more to pay'}</span>
                </div>
              </div>
              {diff !== 0 && (
                <p className={`text-[11px] font-semibold ${diff > 0 ? 'text-amber-600' : 'text-gray-500'}`}>
                  {diff > 0 ? `Collect ${peso(diff)} at the counter.` : `Overpayment of ${peso(-diff)} is forfeited (no refunds).`}
                </p>
              )}
              {transaction.promoCodeId ? (
                <p className="text-[11px] text-amber-600 font-medium flex items-center gap-1.5"><Tag size={12} /> The booking coupon carries over when it still applies to the new item — otherwise it is voided (use handed back).</p>
              ) : null}
              {check.checking && <p className="text-[11px] text-gray-400 font-medium flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Checking availability…</p>}
              {!check.checking && check.available === false && (
                <p className="text-[11px] text-red-500 font-medium flex items-center gap-1.5"><AlertTriangle size={12} /> {check.reason || 'Not available for these dates — pick another.'}</p>
              )}
              {!check.checking && check.available === true && (
                <p className="text-[11px] text-emerald-600 font-medium flex items-center gap-1.5"><CheckCircle size={12} /> Available for these dates.</p>
              )}
              <p className="text-[10px] text-gray-400">Sizes are cleared and the old release photo is voided — release must be taken for the new item.</p>
            </div>
          )}
          </div>

          {/* Footer actions — pinned below the scrolling body so
              Cancel / Confirm Swap never scroll out of reach. */}
          <div className="shrink-0 bg-white/95 backdrop-blur-md border-t border-gray-100/80 px-5 sm:px-6 pt-3.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-3xl">
            <div className="grid grid-cols-2 gap-3">
              <button onClick={requestClose}
                className="py-3.5 text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-2xl transition-colors border border-gray-200">
                Cancel
              </button>
              <button onClick={handleConfirm} disabled={!canConfirm}
                className={`py-3.5 text-sm font-bold text-white rounded-2xl transition-all flex items-center justify-center gap-2 ${
                  canConfirm
                    ? 'bg-blue-600 hover:bg-blue-700 shadow-sm active:scale-[0.98]'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}>
                {swapping ? <><Loader2 size={16} className="animate-spin" /> Swapping…</> : <><Repeat size={16} /> Confirm Swap</>}
              </button>
            </div>
          </div>
    </BottomSheet>
  );
}
