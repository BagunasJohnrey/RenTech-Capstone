import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Camera, Package, User, Calendar, Scissors, Banknote, Smartphone, CreditCard } from 'lucide-react';
import { api } from '../utils/api';
import { storageService } from '../services';
import { customerLabel, itemLabel } from '../utils/format';
import { fileToBase64, downscaleToJpeg } from '../utils/file';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useLockScroll } from '../hooks/useLockScroll';
import { useButtonGuard } from '../hooks/useButtonGuard';

export default function ReleaseItemModal({ transaction, onClose, onReleased }) {
  // Freeze the page behind the sheet; the backdrop is tap-to-close only.
  useLockScroll(true);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [needsAlteration, setNeedsAlteration] = useState(false);
  // Ref guard: state alone can't block same-tick double-taps on Confirm
  // Release (duplicate release + duplicate payment records).
  const { guarding: releasing, guard: guardRelease } = useButtonGuard();
  const [error, setError] = useState('');

  // Timed exit + swipe-down-to-dismiss, mirroring the transaction sheet.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const requestClose = useCallback(() => {
    if (closing || closingRef.current) return;
    closingRef.current = true;
    setDragY(null);
    setClosing(true);
    setTimeout(onClose, 150);
  }, [closing, onClose]);
  useEscapeClose(requestClose);

  // Enter animation plays once on mount — never re-applied after a snap-back.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 250);
    return () => clearTimeout(t);
  }, []);

  const bodyRef = useRef(null);
  const sheetRef = useRef(null);
  const [dragY, setDragY] = useState(null);
  const [dismissing, setDismissing] = useState(false);
  const dragState = useRef({ startY: 0, lastY: 0, lastT: 0, active: false, atTop: true });
  const onSheetTouchStart = (e) => {
    if (dismissing || closingRef.current || releasing || e.touches.length !== 1) return;
    const t = e.touches[0];
    // Latch whether the gesture STARTED at the top: a scroll that merely
    // arrives at the top mid-gesture must never turn into a dismiss — only
    // a fresh, deliberate swipe from the top may close the sheet.
    dragState.current = { startY: t.clientY, lastY: t.clientY, lastT: Date.now(), active: false, atTop: bodyRef.current ? bodyRef.current.scrollTop <= 0 : true };
  };
  const onSheetTouchMove = (e) => {
    const s = dragState.current;
    if (s.dismissing || closingRef.current || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - s.startY;
    if (!s.active) {
      if (!s.atTop) return;
      if (dy < 10) return;
      s.active = true;
    }
    if (dy <= 0) { setDragY(null); return; } // finger back up: ease home, don't jump
    s.lastY = e.touches[0].clientY;
    s.lastT = Date.now();
    setDragY(dy);
  };
  const onSheetTouchEnd = (e) => {
    const s = dragState.current;
    s.active = false;
    if (s.dismissing || closingRef.current) return;
    const endY = e.changedTouches[0].clientY;
    const dy = Math.max(0, endY - s.startY);
    // Deliberate long drag only: ~45% of the sheet height (min 180px). Fast
    // flicks no longer dismiss on velocity — the swipe must truly reach.
    const threshold = Math.max(180, (sheetRef.current?.offsetHeight ?? 600) * 0.45);
    if (dy >= threshold) {
      s.dismissing = true;
      closingRef.current = true;
      setDismissing(true);
      setDragY(null);
      setTimeout(onClose, 190);
      return;
    }
    setDragY(null);
  };

  const [recordPayment, setRecordPayment] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payError, setPayError] = useState('');
  const [paySuccess, setPaySuccess] = useState(false);

  const outstandingBalance = Math.max(0, transaction.balance ?? 0);

  useEffect(() => {
    if (outstandingBalance > 0 && !recordPayment) {
      setPayAmount(String(outstandingBalance));
    }
  }, [outstandingBalance]);

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoFile(file);
    setPhotoUrl(URL.createObjectURL(file));
  };

  const clearPhoto = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoFile(null);
    setPhotoUrl('');
  };

  const handleRelease = () => {
    if (!photoFile) { setError('Please capture the pre-rental condition photo'); return; }
    if (recordPayment) {
      const amt = Number(payAmount);
      if (!amt || amt <= 0) { setPayError('Enter a valid amount'); return; }
      if (amt > outstandingBalance) { setPayError(`Maximum is ₱${outstandingBalance.toLocaleString()}`); return; }
    }
    guardRelease(async () => {
      setError('');
      setPayError('');
      try {
      const base64 = (await downscaleToJpeg(photoFile)) || (await fileToBase64(photoFile));
      const { path } = await storageService.upload(
        `rental/${transaction.id}/release-${Date.now()}.jpg`,
        'image/jpeg',
        base64
      );
      const updated = await api.put(`/transactions/${transaction.id}/release`, {
        releasePhoto: path,
        notes,
        needsAlteration,
      });
      if (recordPayment) {
        const amt = Number(payAmount);
        if (amt > 0 && amt <= outstandingBalance) {
          try {
            await api.post(`/transactions/${transaction.id}/payments`, { amount: amt, method: payMethod });
            setPaySuccess(true);
          } catch { /* payment failure is non-critical for release */ }
        }
      }
      onReleased(updated);
      onClose();
      } catch (err) {
        setError(err?.message || 'Failed to release item');
      }
    });
  };

  return (
    <div className={`fixed inset-0 z-[9999] transition-opacity duration-150 ${closing || dismissing ? 'opacity-0' : 'opacity-100'}`}
      style={dragY != null && !dismissing ? { opacity: Math.max(0.25, 1 - dragY / 500) } : undefined}
    >
      <div className={`fixed inset-0 bg-gray-900/40 backdrop-blur-sm ${closing ? 'animate-out fade-out duration-150' : 'animate-in fade-in duration-200'}`} onClick={requestClose} />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center px-0 pt-10 pb-0 sm:p-4 pointer-events-none">
        <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-release-item"
          ref={sheetRef}
          className={`bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md sheet-cap sm:max-h-[90vh] flex flex-col overflow-hidden pointer-events-auto transform-gpu ${closing && dragY == null && !dismissing ? 'animate-out slide-out-to-bottom sm:zoom-out-95 fade-out duration-150' : !entered && !closing && !dismissing && dragY == null ? 'animate-in slide-in-from-bottom sm:zoom-in-95 duration-200' : ''}`}
          style={
            dismissing
              ? { transform: 'translateY(105%)', transition: 'transform 190ms ease-in' }
              : dragY != null
                ? { transform: `translateY(${dragY}px)`, transition: 'none' }
                : { transform: 'translateY(0)', transition: 'transform 220ms cubic-bezier(0.2, 0.9, 0.25, 1.2)' }
          }
          onTouchStart={onSheetTouchStart}
          onTouchMove={onSheetTouchMove}
          onTouchEnd={onSheetTouchEnd}
          onClick={(e) => e.stopPropagation()}>
          <div className="shrink-0 overflow-hidden rounded-t-3xl">
            <div className="bg-white pt-2 pb-1 flex justify-center" aria-hidden="true">
              <div className="w-10 h-1 rounded-full bg-gray-200" />
            </div>
            <div className="bg-white flex justify-between items-center p-5 sm:p-6 border-b border-gray-100/80">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 rounded-xl">
                <Package size={18} className="text-blue-600" />
              </div>
              <div>
                <h3 id="dialog-title-release-item" className="font-bold text-lg text-gray-900">Release Item</h3>
                <p className="text-xs text-gray-500">Customer pickup</p>
              </div>
            </div>
            <button onClick={requestClose} aria-label="Close release dialog" className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
              <X size={20} />
            </button>
            </div>
          </div>

          <div ref={bodyRef} className="p-5 sm:p-6 space-y-5 flex-1 overflow-y-auto min-h-0 overscroll-contain">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <User size={11} /> Customer
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">{customerLabel(transaction.customer)}</p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Package size={11} /> Item
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">{itemLabel(transaction.item)}</p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Calendar size={11} /> Rental Date
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">
                {new Date(transaction.rentalDate || transaction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Calendar size={11} /> Due Date
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">
                {new Date(transaction.dueDate || transaction.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 mb-3 flex items-center gap-1.5">
              <Camera size={14} className="text-blue-500" /> Pre-Rental Condition Photo
            </label>
            <p className="text-[10px] text-gray-400 mb-2">Capture the item's condition before releasing to the customer.</p>
            <div className="relative h-44 sm:h-48 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center overflow-hidden transition-colors hover:border-blue-300">
              {photoUrl ? (
                <>
                  <img src={photoUrl} className="w-full h-full object-cover" alt="Pre-rental condition" />
                  <button onClick={clearPhoto} aria-label="Remove photo" className="absolute top-2 right-2 p-1.5 bg-gray-900/70 text-white rounded-full shadow hover:bg-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
                    <X size={14} />
                  </button>
                </>
              ) : (
                <label className="cursor-pointer text-center p-4 w-full h-full flex flex-col items-center justify-center">
                  <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />
                  <div className="p-3.5 bg-white rounded-full shadow-sm mb-2.5">
                    <Camera size={24} className="text-gray-400" />
                  </div>
                  <p className="text-sm font-bold text-gray-500">Tap to capture photo</p>
                  <p className="text-[10px] text-gray-300 mt-1">Use camera to document item condition before release</p>
                </label>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1.5">
              Notes (optional)
            </label>
            <textarea placeholder="Any notes about the item condition at pickup..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-blue-400 resize-none"
            />
          </div>

          <div className="bg-amber-50 border border-amber-200/70 rounded-2xl p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <div className="relative mt-0.5">
                <input
                  type="checkbox"
                  checked={needsAlteration}
                  onChange={(e) => setNeedsAlteration(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-10 h-6 rounded-full transition-colors ${needsAlteration ? 'bg-amber-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${needsAlteration ? 'translate-x-4' : ''}`} />
                </div>
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                  <Scissors size={14} className="text-amber-600" /> Needs alteration
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  The garment doesn't fit — customer will need to come back for fitting before using it.
                </p>
              </div>
            </label>
          </div>

          {outstandingBalance > 0 && (
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative mt-0.5">
                  <input
                    type="checkbox"
                    checked={recordPayment}
                    onChange={(e) => { setRecordPayment(e.target.checked); setPayError(''); }}
                    className="sr-only"
                  />
                  <div className={`w-10 h-6 rounded-full transition-colors ${recordPayment ? 'bg-[#bf4a53]' : 'bg-gray-300'}`}>
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${recordPayment ? 'translate-x-4' : ''}`} />
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                    <Banknote size={14} className="text-[#bf4a53]" /> Record payment at pickup
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Outstanding balance: <span className="font-bold text-[#bf4a53]">₱{outstandingBalance.toLocaleString()}</span>
                  </p>
                </div>
              </label>
              {recordPayment && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">₱</span>
                      <input
                        type="number"
                        min="1"
                        max={outstandingBalance}
                        value={payAmount}
                        onChange={e => { setPayAmount(e.target.value); setPayError(''); }}
                        className="w-full pl-8 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Method</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[{ key: 'cash', label: 'Cash', Icon: Banknote }, { key: 'gcash', label: 'GCash', Icon: Smartphone }, { key: 'card', label: 'Card', Icon: CreditCard }].map(m => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => setPayMethod(m.key)}
                          className={`py-2 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-1.5 ${payMethod === m.key ? 'bg-[#bf4a53] text-white border-[#bf4a53]' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}
                        >
                          <m.Icon size={12} /> {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {payError && <p className="text-[11px] text-red-500 font-medium">{payError}</p>}
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-xs font-semibold text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          </div>

          {/* Footer actions — pinned below the scrolling body so
              Cancel / Confirm Release never scroll out of reach. */}
          <div className="shrink-0 bg-white/95 backdrop-blur-md border-t border-gray-100/80 px-5 sm:px-6 pt-3.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-3xl">
            <div className="grid grid-cols-2 gap-3">
              <button onClick={requestClose}
                className="py-3.5 text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-2xl transition-colors border border-gray-200">
                Cancel
              </button>
              <button onClick={handleRelease} disabled={releasing || !photoFile}
                className={`py-3.5 text-sm font-bold text-white rounded-2xl transition-all flex items-center justify-center gap-2 ${
                  photoFile && !releasing
                    ? 'bg-blue-600 hover:bg-blue-700 shadow-sm active:scale-[0.98]'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}>
                {releasing ? 'Releasing...' : 'Confirm Release'}
              </button>
            </div>
          </div>
        </div>
    </div>
  </div>
  );
}
