import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Camera, Package, User, Calendar, Scissors, Banknote, CreditCard, Repeat, QrCode, ExternalLink } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../utils/api';
import { storageService } from '../services';
import { paymentsService } from '../services/payments';
import { usePaymongo } from '../hooks/usePaymongo';
import { getBookingCode } from '../utils/receipt';
import { customerLabel, itemLabel } from '../utils/format';
import { fileToBase64, downscaleToJpeg } from '../utils/file';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useLockScroll } from '../hooks/useLockScroll';
import { useButtonGuard } from '../hooks/useButtonGuard';
import { useToast } from './Toast';
import SwapItemModal from './SwapItemModal';

export default function ReleaseItemModal({ transaction: initialTx, onClose, onReleased, onSwapItem }) {
  // Local copy: an in-sheet item swap replaces the garment (and fee) without
  // closing the sheet — the release then continues against the new item.
  const [tx, setTx] = useState(initialTx);
  const [swapOpen, setSwapOpen] = useState(false);
  const { success: toastSuccess } = useToast();
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
  const [payError, setPayError] = useState('');
  const [paySuccess, setPaySuccess] = useState(false);
  // Pickup collection channel: cash (manual record) or online gateway
  // (PayMongo drop-in / Maya QR shown to the customer). GCash/card go through
  // Online — Cash tab is cash-only.
  const [payChannel, setPayChannel] = useState('cash');
  const [gateway, setGateway] = useState('paymongo');
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [gatewayIntent, setGatewayIntent] = useState(null);
  const [gatewayQrUrl, setGatewayQrUrl] = useState(null);
  const [gatewayStatus, setGatewayStatus] = useState(null);
  const { openDropIn } = usePaymongo();
  const pollStopRef = useRef(false);

  const outstandingBalance = Math.max(0, tx.balance ?? 0);
  // Full payment is required before the item leaves the shop (backend
  // enforces this too) — an unpaid booking must clear the FULL outstanding
  // here, then release. Paid bookings skip this block.
  const requiresPayment = outstandingBalance > 0;

  useEffect(() => {
    if (requiresPayment) {
      setPayAmount(String(outstandingBalance));
      setRecordPayment(true);
    }
  }, [outstandingBalance]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which gateway online charges use (admin Settings → payment_gateway).
  useEffect(() => {
    api.get('/settings/rental-defaults')
      .then((d) => { if (d?.payment_gateway === 'maya') setGateway('maya'); else setGateway('paymongo'); })
      .catch(() => {});
    return () => { pollStopRef.current = true; };
  }, []);

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

  // Online poll: success = the ledger actually moved (balance down), not just
  // a "succeeded" label — after the booking is secured, getStatus reports
  // succeeded from the downpayment while a new pickup charge is still pending.
  const pollGatewayStatus = async (paidAtStart, balanceAtStart) => {
    pollStopRef.current = false;
    for (let i = 0; i < 20; i++) {
      if (pollStopRef.current) return false;
      await new Promise((r) => setTimeout(r, 3000));
      if (pollStopRef.current) return false;
      try {
        const s = await paymentsService.getStatus(tx.id);
        setGatewayStatus(s?.status ?? null);
        const paidNow = Number(s?.totalPaid ?? paidAtStart) || 0;
        const balanceNow = Math.max(0, s?.balance ?? balanceAtStart);
        if (paidNow > paidAtStart || balanceNow < balanceAtStart) {
          setTx((prev) => ({ ...prev, totalPaid: s.totalPaid ?? prev.totalPaid, balance: s.balance ?? prev.balance }));
          setPayAmount(String(Math.max(0, s?.balance ?? 0)));
          if (balanceNow <= 0) return true;
          return false;
        }
        if (s?.status === 'failed' || s?.status === 'expired') return false;
      } catch { /* transient blip — keep polling */ }
    }
    return false;
  };

  const handleGatewayCharge = async () => {
    setPayError('');
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { setPayError('Enter a valid amount'); return; }
    if (amt !== outstandingBalance) { setPayError(`Full payment required — collect ₱${outstandingBalance.toLocaleString()}`); return; }
    setGatewayLoading(true);
    setGatewayStatus(null);
    try {
      const intent = await paymentsService.createIntent({ transactionId: tx.id, amount: amt });
      if (intent?.simulated) {
        setPayError('Online payments are not configured (simulated) — use Cash instead.');
        return;
      }
      if (intent?.gateway === 'maya') {
        setGatewayIntent(intent);
        setGatewayStatus('pending');
        if (intent.qrCodeBody) {
          try { setGatewayQrUrl(await QRCode.toDataURL(intent.qrCodeBody, { width: 220, margin: 1 })); }
          catch { setGatewayQrUrl(null); }
        }
        await pollGatewayStatus(Number(tx.totalPaid ?? 0) || 0, outstandingBalance);
        return;
      }
      try {
        await openDropIn(intent.clientKey, {
          amount: Math.round(amt * 100),
          currency: 'PHP',
          description: `Pickup payment for booking ${getBookingCode(tx)}`,
        });
      } catch (payErr) {
        setPayError(payErr?.message || 'Payment was cancelled or failed.');
        return;
      }
      setGatewayIntent(intent);
      setGatewayStatus('pending');
      await pollGatewayStatus(Number(tx.totalPaid ?? 0) || 0, outstandingBalance);
    } catch (err) {
      setPayError(err?.message || 'Could not start the online payment.');
    } finally {
      setGatewayLoading(false);
    }
  };

  const handleRelease = () => {
    if (!photoFile) { setError('Please capture the pre-rental condition photo'); return; }
    if (requiresPayment && payChannel === 'online') {
      setPayError('Waiting for the online payment — release unlocks once the balance is ₱0.');
      return;
    }
    if (requiresPayment) {
      const amt = Number(payAmount);
      if (!amt || amt <= 0) { setPayError('Enter a valid amount'); return; }
      if (amt < outstandingBalance) { setPayError(`Full payment required — collect ₱${outstandingBalance.toLocaleString()}`); return; }
      if (amt > outstandingBalance) { setPayError(`Maximum is ₱${outstandingBalance.toLocaleString()}`); return; }
    } else if (recordPayment) {
      const amt = Number(payAmount);
      if (!amt || amt <= 0) { setPayError('Enter a valid amount'); return; }
      if (amt > outstandingBalance) { setPayError(`Maximum is ₱${outstandingBalance.toLocaleString()}`); return; }
    }
    guardRelease(async () => {
      setError('');
      setPayError('');
      try {
      // Payment FIRST, release second: the backend rejects release on any
      // outstanding balance, so charging after would always 400. Cash posts
      // here; Online must already have landed via the poller above.
      if (requiresPayment && payChannel === 'cash') {
        const amt = Number(payAmount);
        try {
          await api.post(`/transactions/${tx.id}/payments`, { amount: amt, method: 'cash' });
          setPaySuccess(true);
        } catch (payErr) {
          setPayError(payErr?.message || 'Payment failed — release blocked until fully paid');
          return;
        }
      }
      const base64 = (await downscaleToJpeg(photoFile)) || (await fileToBase64(photoFile));
      const { path } = await storageService.upload(
        `rental/${tx.id}/release-${Date.now()}.jpg`,
        'image/jpeg',
        base64
      );
      const updated = await api.put(`/transactions/${tx.id}/release`, {
        releasePhoto: path,
        notes,
        needsAlteration,
      });
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
              <p className="text-sm font-bold text-gray-900 truncate">{customerLabel(tx.customer)}</p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Package size={11} /> Item
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">{itemLabel(tx.item)}</p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Calendar size={11} /> Rental Date
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">
                {new Date(tx.rentalDate || tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Calendar size={11} /> Due Date
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">
                {new Date(tx.dueDate || tx.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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

          <button onClick={() => setSwapOpen(true)}
            className="w-full py-2.5 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-2xl transition-colors flex items-center justify-center gap-1.5">
            <Repeat size={14} /> Customer wants a different item? Swap it
          </button>

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

          {requiresPayment && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
              <div>
                <p className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                  <Banknote size={14} className="text-[#bf4a53]" /> Full payment required before release
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Outstanding balance: <span className="font-bold text-[#bf4a53]">₱{outstandingBalance.toLocaleString()}</span> — collect it now, then release.
                </p>
              </div>
              {/* Channel switch: cash (manual) vs online gateway */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-2xl" role="tablist" aria-label="Pickup payment channel">
                <button
                  type="button"
                  role="tab"
                  aria-selected={payChannel === 'cash'}
                  onClick={() => { setPayChannel('cash'); setPayError(''); pollStopRef.current = true; }}
                  className={`py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${payChannel === 'cash' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                >
                  <Banknote size={12} /> Cash
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={payChannel === 'online'}
                  onClick={() => { setPayChannel('online'); setPayError(''); }}
                  className={`py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${payChannel === 'online' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                >
                  {gateway === 'maya' ? <QrCode size={12} /> : <CreditCard size={12} />} Online
                </button>
              </div>
              {payChannel === 'cash' ? (
              <>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Amount (full balance)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">₱</span>
                  <input
                    type="number"
                    min={outstandingBalance}
                    max={outstandingBalance}
                    value={payAmount}
                    onChange={e => { setPayAmount(e.target.value); setPayError(''); }}
                    className="w-full pl-8 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] transition-colors"
                  />
                </div>
              </div>
              </>
              ) : (
              <>
              <div className="bg-blue-50/70 border border-blue-100 rounded-2xl p-3 text-xs text-gray-600">
                {gateway === 'maya'
                  ? <>Collect via <span className="font-bold text-gray-900">Maya QRPh</span> — show the QR to the customer to scan. Release unlocks once paid.</>
                  : <>Collect via <span className="font-bold text-gray-900">PayMongo</span> (GCash / card) — the checkout opens on this device for the customer to pay now.</>}
              </div>
              {gatewayIntent?.gateway === 'maya' && (
                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col items-center gap-2">
                  {gatewayQrUrl
                    ? <img src={gatewayQrUrl} alt="Maya payment QR" className="w-44 h-44 rounded-xl border border-gray-100" />
                    : <QrCode size={40} className="text-gray-300" />}
                  {gatewayIntent.redirectUrl && (
                    <a href={gatewayIntent.redirectUrl} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-bold text-[#bf4a53] hover:underline">
                      <ExternalLink size={12} /> Open Maya checkout
                    </a>
                  )}
                  {gatewayIntent.expiresAt && (
                    <p className="text-[11px] text-gray-400">QR valid for 1 hour · expires {new Date(gatewayIntent.expiresAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</p>
                  )}
                  {gatewayStatus && (
                    <p className="text-[11px] font-bold text-amber-600 animate-pulse">Waiting for customer payment…</p>
                  )}
                </div>
              )}
              {!gatewayIntent ? (
                <button
                  type="button"
                  onClick={handleGatewayCharge}
                  disabled={gatewayLoading}
                  className="w-full py-2.5 rounded-2xl font-bold text-xs bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {gateway === 'maya' ? <QrCode size={14} /> : <CreditCard size={14} />}
                  {gatewayLoading ? 'Starting…' : gateway === 'maya' ? `Generate Maya QR for ₱${outstandingBalance.toLocaleString()}` : `Collect ₱${outstandingBalance.toLocaleString()} via PayMongo`}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { pollStopRef.current = true; setGatewayIntent(null); setGatewayQrUrl(null); setGatewayStatus(null); setPayError(''); }}
                  className="w-full py-2.5 rounded-2xl font-bold text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  Start a fresh charge
                </button>
              )}
              </>
              )}
              {payError && <p className="text-[11px] text-red-500 font-medium">{payError}</p>}
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
              <button onClick={handleRelease} disabled={releasing || !photoFile || (requiresPayment && (payChannel === 'online' || Number(payAmount) !== outstandingBalance))}
                className={`py-3.5 text-sm font-bold text-white rounded-2xl transition-all flex items-center justify-center gap-2 ${
                  photoFile && !releasing && (!requiresPayment || (payChannel === 'cash' && Number(payAmount) === outstandingBalance))
                    ? 'bg-blue-600 hover:bg-blue-700 shadow-sm active:scale-[0.98]'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}>
                {releasing ? 'Releasing...' : !requiresPayment ? 'Confirm Release' : payChannel === 'online' ? 'Waiting for payment…' : `Collect ₱${outstandingBalance.toLocaleString()} & Release`}
              </button>
            </div>
          </div>
        </div>
    </div>
      {swapOpen && (
        <SwapItemModal
          transaction={tx}
          onClose={() => setSwapOpen(false)}
          onSwapped={(updated, prevItemId) => {
            // Continue the release against the NEW garment: refresh the sheet,
            // force a fresh condition photo (the old one showed another item),
            // and let the parent merge + fix inventory statuses.
            setTx((prev) => ({ ...prev, ...updated }));
            clearPhoto();
            pollStopRef.current = true;
            setGatewayIntent(null);
            setGatewayQrUrl(null);
            setGatewayStatus(null);
            setPayChannel('cash');
            setSwapOpen(false);
            toastSuccess(`Swapped to ${updated?.item?.name ?? 'new item'} — capture its photo`);
            onSwapItem?.(updated, prevItemId);
          }}
        />
      )}
  </div>
  );
}
