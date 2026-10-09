import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Receipt, Shirt, Calendar, Ruler, FileText, CreditCard, Camera, Download, Banknote, Smartphone, Phone, Undo2, MapPin, UserCheck, PackageCheck, History, QrCode, ExternalLink } from 'lucide-react';
import QRCode from 'qrcode';
import { customerLabel, customerPhone, customerTelLink, itemLabel } from '../utils/format';
import { normalizeTx, invalidateTxCache } from '../hooks/useTransactions';
import { getBookingCode } from '../utils/receipt';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import ItemImage from './ItemImage';
import BookingQR from './BookingQR';
import { Skeleton } from './Skeleton';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useLockScroll } from '../hooks/useLockScroll';
import { TX_STATUS_PILLS } from '../utils/statusColors';
import { api } from '../utils/api';
import { paymentsService } from '../services/payments';
import { usePaymongo } from '../hooks/usePaymongo';

const fmtDate = (d) => {
  if (!d) return null;
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
  } catch { return d; }
};

const fmtCurrency = (n) => {
  if (n == null || n === '') return null;
  const num = Number(n);
  if (isNaN(num)) return null;
  return `₱${num.toLocaleString()}`;
};

const statusColors = Object.fromEntries(
  Object.entries(TX_STATUS_PILLS).map(([k, v]) => [k, `${v.bg} ${v.text} ${v.ring}`])
);

function DetailRow({ label, value, highlight }) {
  if (value == null || value === '' || value === '—') return null;
  return (
    <div className="flex justify-between items-start py-2.5">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm text-right max-w-[55%] break-words ${highlight ? 'font-bold text-gray-900' : 'font-semibold text-gray-900'}`}>{value}</span>
    </div>
  );
}

// Staff attribution: backend includes assistedBy/releasedBy objects on the
// full record; list rows only carry the ids, which the audit timeline can
// fill in. Falls back gracefully when nobody is recorded (online bookings).
const staffName = (staff) => {
  if (!staff) return null;
  if (typeof staff === 'object') return staff.name || null;
  return null;
};

// Human-readable one-liner for an audit-log row in the staff timeline.
const auditLabel = (log) => {
  const nv = log?.newValue ?? {};
  if (log?.action === 'create' && log?.entity === 'transaction') return 'Booking created';
  if (log?.entity === 'payment') return `Payment recorded${nv.amount != null ? ` · ₱${Number(nv.amount).toLocaleString()}` : ''}`;
  if (nv.released) return 'Item released (pickup)';
  if (nv.status === 'Returned') return 'Item returned';
  if (nv.status === 'Cancelled') return 'Booking cancelled';
  if (log?.action === 'update' && log?.entity === 'transaction') return 'Booking updated';
  return `${log?.action || 'Activity'} · ${log?.entity || 'record'}`;
};

export default function TransactionDetailModal({ transaction, onClose, fetchFull, role, onReturn }) {
  const flags = useFeatureFlags();
  // Freeze the page behind the sheet; the backdrop is tap-to-close only.
  useLockScroll(true);
  const [qrSaveUrl, setQrSaveUrl] = useState(null);
  const [tx, setTx] = useState(transaction);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState('');
  const [payLoading, setPayLoading] = useState(false);
  const [paySuccess, setPaySuccess] = useState(false);
  // Record Payment channels: counter = manual cash/GCash/card record (existing),
  // online = real gateway charge (PayMongo drop-in / Maya QR) on the staff device.
  const [payChannel, setPayChannel] = useState('counter');
  const [gateway, setGateway] = useState('paymongo');
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [gatewayIntent, setGatewayIntent] = useState(null);
  const [gatewayQrUrl, setGatewayQrUrl] = useState(null);
  const [gatewayStatus, setGatewayStatus] = useState(null);
  const { openDropIn } = usePaymongo();
  const pollStopRef = useRef(false);
  // Gate the body on enrichment: everything appears at once when the full
  // record lands — never staged pop-ins. Header/footer use instant list data.
  const [enriching, setEnriching] = useState(() => !!(transaction?.id && fetchFull));
  // Staff audit timeline (who assisted / released / returned / edited).
  // Staff-only endpoint — customers get a 403, which we swallow silently.
  // Starts true so the body gate below holds the skeleton until the timeline
  // lands alongside the record — both fire in parallel on mount, and the
  // sheet appears once with everything instead of staged pop-ins.
  const isStaffView = role === 'Admin' || role === 'Staff';
  const [audits, setAudits] = useState([]);
  const [auditsLoading, setAuditsLoading] = useState(true);
  // Smooth exits: play the slide/fade-out, then unmount. Every dismiss path
  // goes through these instead of cutting instantly.
  const [closing, setClosing] = useState(false);
  const [payClosing, setPayClosing] = useState(false);
  // Guards late fetch resolutions: a record landing mid-exit would swap the
  // content under the fade-out = the visible "glitch" on close.
  const closingRef = useRef(false);
  const requestClose = useCallback(() => {
    if (closing || closingRef.current) return;
    closingRef.current = true;
    setDragY(null);
    setClosing(true);
    setTimeout(onClose, 150);
  }, [closing, onClose]);
  const closePayModal = useCallback(() => {
    if (payLoading || gatewayLoading || payClosing) return;
    pollStopRef.current = true;
    setPayClosing(true);
    setTimeout(() => { setShowPayModal(false); setPayClosing(false); }, 150);
  }, [payLoading, gatewayLoading, payClosing]);
  const openPayModal = () => {
    setPayClosing(false);
    setPayChannel('counter');
    setGatewayIntent(null);
    setGatewayQrUrl(null);
    setGatewayStatus(null);
    setPayError('');
    setPaySuccess(false);
    pollStopRef.current = false;
    // Prefill the full outstanding so Record ₱X is one tap.
    if (!payAmount && tx?.balance > 0) setPayAmount(String(Math.max(0, tx.balance)));
    // Which gateway new charges use (admin Settings → payment_gateway).
    api.get('/settings/rental-defaults')
      .then((d) => { if (d?.payment_gateway === 'maya') setGateway('maya'); else setGateway('paymongo'); })
      .catch(() => {});
    setShowPayModal(true);
  };
  // Esc dismisses the topmost layer first (pay form before the detail sheet).
  const handleEscape = useCallback(() => {
    if (showPayModal) closePayModal();
    else requestClose();
  }, [showPayModal, closePayModal, requestClose]);
  useEscapeClose(handleEscape);

  // Swipe-down-to-dismiss (mobile bottom sheet). Touch-only handlers so the
  // desktop mouse path is untouched. Takes over only for downward drags that
  // start with the body scrolled to the top — anything else stays a scroll.
  const bodyRef = useRef(null);
  const sheetRef = useRef(null);
  const [dragY, setDragY] = useState(null);
  const [dismissing, setDismissing] = useState(false);
  // Enter animation plays once on mount — never re-applied (e.g. after a
  // drag snap-back), or the sheet would visibly replay the slide-in.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 250);
    return () => clearTimeout(t);
  }, []);
  const dragState = useRef({ startY: 0, lastY: 0, lastT: 0, active: false, atTop: true });
  const onSheetTouchStart = (e) => {
    if (dismissing || closingRef.current || e.touches.length !== 1) return;
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
      if (dy < 10) return; // taps and upward scrolls behave normally
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
      // Dragged far enough — slide off and unmount.
      s.dismissing = true;
      closingRef.current = true;
      setDismissing(true);
      setDragY(null);
      setTimeout(onClose, 190);
      return;
    }
    setDragY(null); // snap back (transition animates it)
  };

  // Fetch enrichment only when the transaction id changes — `transaction` is a
  // new object identity on every parent render, and `normalizeTx()` also
  // returns a fresh object, so depending on them (or calling setTx every
  // render + every fetch resolve) creates an infinite update loop, which is
  // what used to block the close button from ever un-mounting the modal.
  useEffect(() => {
    setTx(transaction);
  }, [transaction?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enrichment + audit timeline fire in PARALLEL on open; the body gate below
  // holds the skeleton until BOTH resolve, so the sheet (incl. Staff Audit)
  // appears in one paint — never a staged pop-in of the Activity list after
  // the rest of the body. Audit fetch is best-effort: a 403 (non-staff) or a
  // network blip simply hides the section instead of blocking the sheet.
  useEffect(() => {
    setAudits([]);
    let cancelled = false;
    const jobs = [];
    if (transaction?.id && fetchFull) {
      setEnriching(true);
      jobs.push(
        // normalize the full record so customerProfile is always present —
        // otherwise the address flickers in from the list item then vanishes.
        fetchFull(transaction.id)
          .then((full) => { if (!cancelled && !closingRef.current) setTx(normalizeTx(full)); })
          .catch(() => {})
          .finally(() => { if (!cancelled) setEnriching(false); })
      );
    } else {
      setEnriching(false);
    }
    if (isStaffView && transaction?.id) {
      setAuditsLoading(true);
      jobs.push(
        api.get(`/transactions/${transaction.id}/audits`)
          .then((logs) => { if (!cancelled) setAudits(Array.isArray(logs) ? logs : []); })
          .catch(() => { if (!cancelled) setAudits([]); })
          .finally(() => { if (!cancelled) setAuditsLoading(false); })
      );
    } else {
      setAuditsLoading(false);
    }
    return () => { cancelled = true; };
  }, [transaction?.id, fetchFull, isStaffView]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tx) return null;

  const status = tx.status;
  const statusColor = statusColors[status] || 'bg-gray-100 text-gray-600 ring-gray-200';
  const statusText = TX_STATUS_PILLS[status]?.text || 'text-gray-600';
  const txRef = `#${String(tx.txNumber ?? tx.id ?? '').slice(0, 8)}`;
  // Fall back to the incoming `transaction` prop: `tx` state is replaced by
  // the fetchFull enrichment (~500ms round-trip), and anything derived only
  // from `tx` would pop in late + shift the layout. The list record already
  // carries phone/address, so prefer instant values with the same result.
  const custProfile = tx.customerProfile || transaction?.customerProfile || tx.customer;
  const custPhone = customerPhone(custProfile, tx.contact || tx.customerPhone || transaction?.contact || transaction?.customerPhone);
  // Address previously read ONLY from customerProfile, so list records that
  // carry it on the raw customer object waited for the enrichment round-trip.
  const rawCustomer = (tx.customer && typeof tx.customer === 'object' ? tx.customer : null)
    || (transaction?.customer && typeof transaction.customer === 'object' ? transaction.customer : null);
  const custAddr = tx.customerProfile?.address || rawCustomer?.address || transaction?.customerProfile?.address;
  // Tap-to-call for staff (mirrors the History list). Null for customers and
  // when no usable number exists.
  const custTel = isStaffView ? customerTelLink(custProfile, tx.contact || tx.customerPhone || transaction?.contact || transaction?.customerPhone) : null;
  const custInitial = (customerLabel(tx.customer) || '?').charAt(0).toUpperCase();
  // Staff audit: who assisted this booking (walk-ins included) and who
  // physically released the item. Full record carries the objects; list rows
  // may only carry the ids — the timeline backfills names from audit logs.
  const assistedFromTx = staffName(tx.assistedBy);
  const releasedFromTx = staffName(tx.releasedBy);
  const assistedFromLog = audits.find((l) => l?.action === 'create')?.performedBy?.name || null;
  const releasedFromLog = [...audits].reverse().find((l) => l?.newValue?.released)?.performedBy?.name || null;
  const assistedName = assistedFromTx || assistedFromLog;
  const releasedName = releasedFromTx || releasedFromLog;
  // The body gate above holds the skeleton until the timeline lands, so by
  // the time we render here the data is final — no loading branch needed.
  const showStaffAudit = isStaffView && (assistedName || releasedName || audits.length > 0);
  const rentalTotal = Number(tx.rentalFee ?? tx.amount ?? 0) || 0;
  const paidSoFar = Number(tx.totalPaid ?? 0) || 0;
  const paidPct = rentalTotal > 0 ? Math.min(100, Math.round((paidSoFar / rentalTotal) * 100)) : 0;
  const outstandingBalance = Math.max(0, tx.balance ?? 0);
  // Returned stays payable (damage fee settled post-return); only Cancelled
  // is terminal. Return itself requires a zero balance (backend enforces too).
  const canRecordPayment = (role === 'Admin' || role === 'Staff')
    && !['Cancelled'].includes(tx.status)
    && outstandingBalance > 0;
  const isReturnBlockedByBalance = outstandingBalance > 0;
  const canProcessReturn = (role === 'Admin' || role === 'Staff')
    && ['Active', 'Overdue'].includes(tx.status)
    && !isReturnBlockedByBalance;


  const handleRecordPayment = async () => {
    setPayError('');
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { setPayError('Enter a valid amount'); return; }
    if (amt > outstandingBalance) { setPayError(`Maximum is ₱${outstandingBalance.toLocaleString()}`); return; }
    setPayLoading(true);
    try {
      // Counter = cash only (GCash/Card go through the Online tab gateway).
      const res = await api.post(`/transactions/${tx.id}/payments`, { amount: amt, method: 'cash', notes: payNotes || undefined });
      // Payments post outside the transactions hook — drop the cached full
      // record so the next open re-reads instead of serving stale totals.
      invalidateTxCache(tx.id);
      setTx(prev => ({
        ...prev,
        totalPaid: res.totalPaid,
        balance: res.balance,
        payments: [...(prev.payments || []), res.payment],
      }));
      setPaySuccess(true);
      setTimeout(() => {
        setPayClosing(true);
        setTimeout(() => { setShowPayModal(false); setPayClosing(false); setPaySuccess(false); setPayAmount(''); setPayNotes(''); }, 150);
      }, 1200);
    } catch (err) {
      setPayError(err?.message || 'Failed to record payment');
    } finally {
      setPayLoading(false);
    }
  };

  // Online gateway charge from the counter (staff collects on their device or
  // shows the QR to the customer). Same create-intent + webhook ledger as the
  // customer flow — the modal polls getStatus so the sheet reflects the credit.
  // Success = the ledger actually moved (totalPaid up / balance down), not just
  // a "succeeded" label: after the rental is secured, getStatus reports
  // succeeded from the downpayment even while a new damage charge is pending.
  const pollGatewayStatus = async () => {
    pollStopRef.current = false;
    const paidAtStart = Number(tx.totalPaid ?? 0) || 0;
    const balanceAtStart = Math.max(0, tx.balance ?? 0);
    for (let i = 0; i < 20; i++) {
      if (pollStopRef.current) return;
      await new Promise((r) => setTimeout(r, 3000));
      if (pollStopRef.current) return;
      try {
        const s = await paymentsService.getStatus(tx.id);
        setGatewayStatus(s?.status ?? null);
        const paidNow = Number(s?.totalPaid ?? paidAtStart) || 0;
        const balanceNow = Math.max(0, s?.balance ?? balanceAtStart);
        const moved = paidNow > paidAtStart || balanceNow < balanceAtStart;
        if (moved || s?.status === 'partial') {
          invalidateTxCache(tx.id);
          setTx((prev) => ({
            ...prev,
            totalPaid: s.totalPaid ?? prev.totalPaid,
            balance: s.balance ?? prev.balance,
          }));
          if (balanceNow <= 0) {
            setPaySuccess(true);
            setTimeout(() => {
              setPayClosing(true);
              setTimeout(() => { setShowPayModal(false); setPayClosing(false); setPaySuccess(false); setPayAmount(''); setGatewayIntent(null); setGatewayQrUrl(null); setGatewayStatus(null); }, 150);
            }, 1200);
          }
          return;
        }
        if (s?.status === 'failed' || s?.status === 'expired') return;
      } catch { /* transient blip — keep polling */ }
    }
  };

  const handleGatewayCharge = async () => {
    setPayError('');
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { setPayError('Enter a valid amount'); return; }
    if (amt > outstandingBalance) { setPayError(`Maximum is ₱${outstandingBalance.toLocaleString()}`); return; }
    setGatewayLoading(true);
    setGatewayStatus(null);
    try {
      const intent = await paymentsService.createIntent({ transactionId: tx.id, amount: amt });
      if (intent?.simulated) {
        setPayError('Online payments are not configured (simulated) — use Counter cash instead.');
        return;
      }
      if (intent?.gateway === 'maya') {
        setGatewayIntent(intent);
        setGatewayStatus('pending');
        if (intent.qrCodeBody) {
          try { setGatewayQrUrl(await QRCode.toDataURL(intent.qrCodeBody, { width: 220, margin: 1 })); }
          catch { setGatewayQrUrl(null); }
        }
        pollGatewayStatus();
        return;
      }
      // PayMongo: hosted drop-in on the staff device, then poll for the webhook credit.
      try {
        await openDropIn(intent.clientKey, {
          amount: Math.round(amt * 100),
          currency: 'PHP',
          description: `Counter payment for booking ${getBookingCode(tx)}`,
        });
      } catch (payErr) {
        setPayError(payErr?.message || 'Payment was cancelled or failed.');
        return;
      }
      setGatewayIntent(intent);
      setGatewayStatus('pending');
      pollGatewayStatus();
    } catch (err) {
      setPayError(err?.message || 'Could not start the online payment.');
    } finally {
      setGatewayLoading(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[300] transition-opacity duration-150 ${closing || dismissing ? 'opacity-0' : 'opacity-100'}`}
      style={dragY != null && !dismissing ? { opacity: Math.max(0.25, 1 - dragY / 500) } : undefined}
    >
      <div className={`fixed inset-0 bg-gray-900/40 backdrop-blur-sm ${closing ? 'animate-out fade-out duration-150' : 'animate-in fade-in duration-200'}`} onClick={requestClose} />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center px-0 pt-10 pb-0 sm:p-4 pointer-events-none">
        {/* dvh cap + top gap: plain vh includes the mobile browser chrome, so the
            sheet used to slide under it and read as full-screen. */}
        {/* Flex column: static header + scrolling body + pinned footer, so the
            actions never scroll away on mobile (sticky-inside-scroller janks
            on some browsers when the sheet itself is the scroll container). */}
        <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-transaction-detail"
          ref={sheetRef}
          className={`bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg sheet-cap sm:max-h-[90vh] flex flex-col overflow-hidden pointer-events-auto transform-gpu ${closing && dragY == null && !dismissing ? 'animate-out slide-out-to-bottom sm:zoom-out-95 fade-out duration-150' : !entered && !closing && !dismissing && dragY == null ? 'animate-in slide-in-from-bottom sm:zoom-in-95 duration-200' : ''}`}
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
          onClick={e => e.stopPropagation()}>

        {/* Header — brand gradient band */}
        <div className="shrink-0 overflow-hidden rounded-t-3xl">
          <div className="bg-gradient-to-r from-[#bf4a53] to-[#e07080] px-5 sm:px-6 pt-2 pb-4 relative">
            <div className="flex justify-center" aria-hidden="true">
              <div className="w-10 h-1 rounded-full bg-white/40 mb-2" />
            </div>
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <div className="absolute top-3 right-8 w-24 h-24 border border-white/30 rounded-full" />
              <div className="absolute -bottom-8 left-10 w-20 h-20 border border-white/20 rounded-full" />
            </div>
            <div className="flex items-start justify-between gap-3 relative">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0">
                  <Receipt size={20} className="text-white" />
                </div>
                <div className="min-w-0">
                  <h3 id="dialog-title-transaction-detail" className="font-bold text-lg text-white leading-tight">Transaction {txRef}</h3>
                  <p className="text-xs text-white/80 font-medium mt-0.5">
                    {status === 'Active' ? 'Currently rented' :
                     status === 'Overdue' ? 'Past due date' :
                     status === 'Returned' ? 'Completed' :
                     status === 'Reserved' ? 'Upcoming booking' : status}
                  </p>
                </div>
              </div>
              <button onClick={requestClose} aria-label="Close transaction details" className="p-1.5 text-white/80 hover:bg-white/20 rounded-full transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                <X size={18} />
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 relative">
              <span className={`inline-flex items-center px-3 py-1.5 rounded-full bg-white text-xs font-bold tracking-wide shadow-sm ${statusText}`}>
                {status}
              </span>
              <span className="text-[11px] font-mono font-bold text-white/80">{getBookingCode(tx)}</span>
            </div>
          </div>
        </div>

        <div ref={bodyRef} className="p-5 sm:p-6 space-y-6 flex-1 overflow-y-auto min-h-0 overscroll-contain">
          {(enriching || (isStaffView && auditsLoading)) ? (
            // Structural placeholder matching the body rhythm — swapped for
            // the real sections in one paint, no staged pop-ins. Staff view
            // holds until BOTH the record and the timeline land (they race in
            // parallel), so Activity never pops in after the rest of the body.
            <div className="space-y-6" aria-hidden="true">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Skeleton className="h-[104px] rounded-2xl" />
                <Skeleton className="h-[104px] rounded-2xl" />
              </div>
              <Skeleton className="h-[150px] rounded-2xl" />
              <Skeleton className="h-[190px] rounded-2xl" />
              <Skeleton className="h-[88px] rounded-2xl" />
            </div>
          ) : (
          <>
          {/* Customer & Item — profile-tile cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-white border border-gray-100/80 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] flex items-center justify-center text-sm font-extrabold shrink-0">
                  {custInitial}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Customer</p>
                  <p className="font-bold text-gray-900 truncate">{customerLabel(tx.customer) || '—'}</p>
                </div>
              </div>
              {/* Contact rows: number is tap-to-call for staff (mirrors the
                  History list). Walk-ins booked before the contact handoff
                  fix have no phone/address on file — say so explicitly so it
                  reads as missing data, not a hidden UI. */}
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                {custPhone ? (
                  custTel ? (
                    <a href={custTel} className="flex items-center gap-1.5 text-xs text-gray-500 min-w-0 hover:text-emerald-600 transition-colors" aria-label={`Call ${custPhone}`}>
                      <Phone size={12} className="text-gray-400 shrink-0" />
                      <span className="truncate font-semibold underline decoration-dotted underline-offset-2">{custPhone}</span>
                    </a>
                  ) : (
                    <p className="flex items-center gap-1.5 text-xs text-gray-500 min-w-0">
                      <Phone size={12} className="text-gray-400 shrink-0" />
                      <span className="truncate">{custPhone}</span>
                    </p>
                  )
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-amber-600 min-w-0">
                    <Phone size={12} className="shrink-0" />
                    <span className="italic">No contact number on file</span>
                  </p>
                )}
                {custAddr ? (
                  <p className="flex items-center gap-1.5 text-xs text-gray-500 min-w-0">
                    <MapPin size={12} className="text-gray-400 shrink-0" />
                    <span className="truncate uppercase">{custAddr}</span>
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-amber-600 min-w-0">
                    <MapPin size={12} className="shrink-0" />
                    <span className="italic">No address on file</span>
                  </p>
                )}
              </div>
            </div>
            <div className="bg-white border border-gray-100/80 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                  <Shirt size={16} className="text-gray-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Item</p>
                  <p className="font-bold text-gray-900 truncate">{itemLabel(tx.item) || '—'}</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                {tx.size && (
                  <p className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Ruler size={12} className="text-gray-400 shrink-0" /> Size: {tx.size}
                  </p>
                )}
                {tx.eventDate && (
                  <p className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Calendar size={12} className="text-gray-400 shrink-0" /> Event: {fmtDate(tx.eventDate)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Staff audit — who assisted this booking (walk-ins included)
              and who released the item at pickup, plus the full activity
              timeline. Staff/Admin only; never rendered for customers. */}
          {showStaffAudit && (
            <div>
              <div className="flex items-center gap-1.5 text-gray-400 mb-3">
                <UserCheck size={13} />
                <span className="text-[10px] font-bold uppercase tracking-wide">Staff Audit</span>
              </div>
              <div className="bg-white border border-gray-100/80 rounded-2xl p-4 space-y-3">
                {assistedName && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                      <UserCheck size={15} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Assisted by</p>
                      <p className="text-sm font-bold text-gray-900 truncate">{assistedName}</p>
                    </div>
                  </div>
                )}
                {releasedName && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                      <PackageCheck size={15} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Released by</p>
                      <p className="text-sm font-bold text-gray-900 truncate">{releasedName}</p>
                    </div>
                  </div>
                )}
                {!assistedName && !releasedName && audits.length === 0 && (
                  <p className="text-xs text-gray-400 italic">No staff activity recorded (online booking).</p>
                )}
                {audits.length > 0 && (
                  <div className={(assistedName || releasedName) ? 'pt-3 border-t border-gray-100' : ''}>
                    <p className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                      <History size={11} /> Activity
                    </p>
                    <ol className="relative space-y-3 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-gray-200">
                      {audits.map((log) => (
                        <li key={log.id} className="relative pl-7">
                          <span className={`absolute left-0 top-1 w-[11px] h-[11px] rounded-full ring-4 ${log?.newValue?.released ? 'bg-blue-500 ring-blue-100' : log?.action === 'create' ? 'bg-violet-500 ring-violet-100' : log?.entity === 'payment' ? 'bg-emerald-500 ring-emerald-100' : 'bg-gray-300 ring-gray-100'}`} />
                          <p className="text-xs font-bold text-gray-900">{auditLabel(log)}</p>
                          <p className="text-[11px] text-gray-500">
                            {log?.performedBy?.name || 'System'}
                            {log?.createdAt ? ` · ${fmtDate(log.createdAt)}` : ''}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Schedule timeline */}
          <div>
            <div className="flex items-center gap-1.5 text-gray-400 mb-3">
              <Calendar size={13} />
              <span className="text-[10px] font-bold uppercase tracking-wide">Schedule</span>
            </div>
            <div className="bg-white border border-gray-100/80 rounded-2xl p-4">
              <ol className="relative space-y-4 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-gray-200">
                <li className="relative pl-7">
                  <span className="absolute left-0 top-1 w-[11px] h-[11px] rounded-full bg-blue-500 ring-4 ring-blue-100" />
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Pickup Date</p>
                  <p className="text-sm font-bold text-gray-900">{fmtDate(tx.rentalDate || tx.date) || '—'}</p>
                </li>
                <li className="relative pl-7">
                  <span className={`absolute left-0 top-1 w-[11px] h-[11px] rounded-full ring-4 ${status === 'Overdue' ? 'bg-red-500 ring-red-100' : status === 'Returned' ? 'bg-emerald-500 ring-emerald-100' : 'bg-amber-400 ring-amber-100'}`} />
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Due / Return By</p>
                  <p className={`text-sm font-bold ${status === 'Overdue' ? 'text-red-600' : 'text-gray-900'}`}>{fmtDate(tx.dueDate || tx.returnDate) || '—'}</p>
                </li>
                {tx.returnDate && ['Returned'].includes(status) && (
                  <li className="relative pl-7">
                    <span className="absolute left-0 top-1 w-[11px] h-[11px] rounded-full bg-emerald-500 ring-4 ring-emerald-100" />
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Actual Return</p>
                    <p className="text-sm font-bold text-gray-900">{fmtDate(tx.returnDate)}</p>
                  </li>
                )}
              </ol>
            </div>
          </div>

          {/* Payment Summary */}
          <div>
            <div className="flex items-center gap-1.5 text-gray-400 mb-3">
              <CreditCard size={13} />
              <span className="text-[10px] font-bold uppercase tracking-wide">Payment</span>
            </div>
            <div className="bg-white border border-gray-100/80 rounded-2xl p-4">
              {rentalTotal > 0 && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-bold text-gray-500">
                      Paid {fmtCurrency(paidSoFar)} <span className="font-medium text-gray-400">of {fmtCurrency(rentalTotal)}</span>
                    </span>
                    <span className={`font-extrabold ${paidPct >= 100 ? 'text-emerald-600' : 'text-[#bf4a53]'}`}>{paidPct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ease-out ${paidPct >= 100 ? 'bg-emerald-500' : 'bg-[#bf4a53]'}`}
                      style={{ width: `${paidPct}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="divide-y divide-gray-100">
                <DetailRow label="Rental Fee" value={fmtCurrency(tx.rentalFee ?? tx.amount)} />
                <DetailRow label="Downpayment" value={fmtCurrency(tx.downpayment)} />
                <DetailRow label="Balance" value={fmtCurrency(outstandingBalance)} highlight />
                {tx.latePenalty > 0 && <DetailRow label="Late Penalty" value={fmtCurrency(tx.latePenalty)} />}
                {tx.damageFee > 0 && <DetailRow label="Damage Fee" value={fmtCurrency(tx.damageFee)} />}
                {tx.totalPaid > 0 && <DetailRow label="Total Paid" value={fmtCurrency(tx.totalPaid)} />}
              </div>
              {outstandingBalance > 0 && !['Cancelled', 'Returned'].includes(tx.status) && (
                <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200/70 rounded-xl px-3 py-2 leading-snug">
                  Please settle the remaining ₱{outstandingBalance.toLocaleString()} at pickup — the item is released only once fully paid.
                </p>
              )}
            </div>
            {Array.isArray(tx.payments) && tx.payments.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Payment History</p>
                {tx.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${p.method === 'cash' ? 'bg-green-100 text-green-700' : p.method === 'gcash' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        {p.method === 'cash' ? <Banknote size={14} /> : p.method === 'gcash' ? <Smartphone size={14} /> : <CreditCard size={14} />}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{fmtCurrency(p.amount)}</p>
                        <p className="text-[10px] text-gray-500 capitalize">{p.method} · {p.type}</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400">{new Date(p.createdAt).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Booking QR — gated on loaded flags so a wrong optimistic
              default can't flash the section on first open. */}
          {flags.flagsLoaded && flags.qr_codes && tx.id && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Booking QR</p>
                {qrSaveUrl && (
                  <a
                    href={qrSaveUrl}
                    download={`${getBookingCode(tx)}.png`}
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-[#bf4a53] hover:underline"
                    title="Download a copy of this QR code">
                    <Download size={11} /> Save QR
                  </a>
                )}
              </div>
              <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 text-white shadow-md">
                <div className="flex flex-col sm:flex-row items-stretch">
                  <div className="p-3.5 flex items-center justify-center shrink-0">
                    <div className="bg-white p-2.5 rounded-xl">
                      <BookingQR tx={tx} size={96} showCode={false} title="Scan to open this booking" onDataUrl={setQrSaveUrl} />
                    </div>
                  </div>
                  <div aria-hidden="true" className="border-t sm:border-t-0 sm:border-l border-dashed border-white/20 mx-3.5 sm:mx-0 sm:my-3.5" />
                  <div className="flex-1 min-w-0 p-3.5 sm:p-4 flex flex-col justify-center text-center sm:text-left">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/50">Booking QR code</p>
                    <p className="font-mono text-base font-bold tracking-wider mt-0.5">{getBookingCode(tx)}</p>
                    <p className="text-[11px] text-white/60 leading-snug mt-1">Customer shows this at pickup — scan it to pull up the order.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Measurements */}
          {tx.measurements && Object.keys(tx.measurements).length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-gray-400 mb-3">
                <Ruler size={13} />
                <span className="text-[10px] font-bold uppercase tracking-wide">Measurements</span>
              </div>
              <div className="bg-white border border-gray-100/80 rounded-2xl p-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {Object.entries(tx.measurements).map(([key, val]) => (
                    <div key={key} className="flex justify-between text-sm">
                      <span className="text-gray-500 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                      <span className="font-semibold text-gray-900">{val} cm</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <div className="flex items-center gap-1.5 text-gray-400 mb-3">
              <FileText size={13} />
              <span className="text-[10px] font-bold uppercase tracking-wide">Notes</span>
            </div>
            <div className="bg-white border border-gray-100/80 rounded-2xl p-4 text-sm">
              {tx.notes ? (
                <p className="text-gray-700 whitespace-pre-wrap">{tx.notes}</p>
              ) : (
                <p className="text-gray-400 italic">No notes</p>
              )}
              {(tx.address || tx.customerProfile?.address) && (
                <p className="text-gray-500 mt-2 pt-2 border-t border-gray-100">
                  <span className="font-medium text-gray-400">Address:</span>{' '}
                  <span className="uppercase">{tx.address || tx.customerProfile?.address}</span>
                </p>
              )}
            </div>
          </div>

          {/* Condition Photos (before / after) */}
          {(tx.releasePhoto || tx.returnPhoto || tx.conditionPhoto) && (
            <div>
              <div className="flex items-center gap-1.5 text-gray-400 mb-3">
                <Camera size={13} />
                <span className="text-[10px] font-bold uppercase tracking-wide">Condition Photos</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(tx.releasePhoto || tx.conditionPhoto) && (
                  <div className="bg-white border border-gray-100/80 rounded-2xl overflow-hidden">
                    <ItemImage image={tx.releasePhoto || tx.conditionPhoto} alt="Item condition at release" className="w-full h-40 object-cover" placeholderSize={20} />
                    <p className="text-[10px] text-gray-500 font-medium text-center py-2">Release (Before)</p>
                  </div>
                )}
                {tx.returnPhoto && (
                  <div className="bg-white border border-gray-100/80 rounded-2xl overflow-hidden">
                    <ItemImage image={tx.returnPhoto} alt="Item condition on return" className="w-full h-40 object-cover" placeholderSize={20} />
                    <p className="text-[10px] text-gray-500 font-medium text-center py-2">Return (After)</p>
                  </div>
                )}
              </div>
            </div>
          )}

        </>
          )}
        </div>

        {/* Footer actions — pinned below the scrolling body (flex column, not
            sticky) so they stay fixed on mobile. Close removed (header X /
            backdrop / Esc still dismiss). */}
        <div className="shrink-0 bg-white/95 backdrop-blur-md border-t border-gray-100/80 px-5 sm:px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-b-3xl">
          <div className="space-y-2">
            {(role === 'Admin' || role === 'Staff') && ['Active', 'Overdue'].includes(tx.status) && isReturnBlockedByBalance && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs font-semibold text-amber-800">
                Settle the ₱{outstandingBalance.toLocaleString()} balance first — return is locked until fully paid.
              </div>
            )}
            {canProcessReturn && onReturn && (
              <button onClick={() => onReturn(tx)} className="w-full py-3.5 rounded-2xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm flex items-center justify-center gap-2">
                <Undo2 size={16} /> Process Return
              </button>
            )}
            {canRecordPayment && (
              <button onClick={openPayModal} className="w-full py-3.5 rounded-2xl font-bold text-sm bg-[#bf4a53] text-white hover:bg-[#a83d46] transition-colors shadow-sm flex items-center justify-center gap-2">
                <Banknote size={16} /> {tx.status === 'Returned' ? `Settle damage ₱${outstandingBalance.toLocaleString()}` : 'Record Payment'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Record Payment Modal — same bottom-sheet treatment on mobile */}
      {showPayModal && (
        <div className={`fixed inset-0 z-[310] transition-opacity duration-150 ${payClosing ? 'opacity-0' : 'opacity-100'}`}>
          {/* No blur here — the parent sheet already blurs beneath, and two
              stacked blurs jank low-end phones. */}
          <div className={`fixed inset-0 bg-gray-900/50 ${payClosing ? 'animate-out fade-out duration-150' : 'animate-in fade-in duration-150'}`} onClick={closePayModal} />
          <div className="fixed inset-0 flex items-end sm:items-center justify-center px-0 pt-12 pb-0 sm:p-4 pointer-events-none">
            <div role="dialog" aria-modal="true" className={`bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-sm sheet-cap overflow-y-auto p-5 sm:p-6 space-y-5 pointer-events-auto transform-gpu ${payClosing ? 'animate-out slide-out-to-bottom sm:zoom-out-95 fade-out duration-150' : 'animate-in slide-in-from-bottom sm:zoom-in-95 duration-200'}`} onClick={e => e.stopPropagation()}>
            {paySuccess ? (
              <div className="text-center py-4">
                <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Banknote size={24} className="text-green-600" />
                </div>
                <p className="font-bold text-lg text-gray-900">Payment Recorded</p>
                <p className="text-sm text-gray-500 mt-1">₱{Number(payAmount).toLocaleString()} via {payChannel === 'online' ? (gateway === 'maya' ? 'Maya' : 'PayMongo') : 'cash'}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-lg text-gray-900">Record Payment</h4>
                  <button onClick={closePayModal} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full transition-colors" aria-label="Close payment form">
                    <X size={16} />
                  </button>
                </div>

                <div className="bg-gray-50 rounded-xl p-3 text-sm">
                  <p className="text-gray-500">Outstanding balance</p>
                  <p className="font-bold text-lg text-[#bf4a53]">₱{outstandingBalance.toLocaleString()}</p>
                </div>

                {/* Channel switch: counter cash vs live gateway charge */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-2xl" role="tablist" aria-label="Payment channel">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={payChannel === 'counter'}
                    onClick={() => { setPayChannel('counter'); setPayError(''); pollStopRef.current = true; }}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-1.5 ${payChannel === 'counter' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                  >
                    <Banknote size={14} /> Counter
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={payChannel === 'online'}
                    onClick={() => { setPayChannel('online'); setPayError(''); }}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-1.5 ${payChannel === 'online' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                  >
                    {gateway === 'maya' ? <QrCode size={14} /> : <CreditCard size={14} />} Online
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">₱</span>
                    <input
                      type="number"
                      min="1"
                      max={outstandingBalance}
                      value={payAmount}
                      onChange={e => { setPayAmount(e.target.value); setPayError(''); }}
                      placeholder="0"
                      disabled={!!gatewayIntent}
                      className="w-full pl-8 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] transition-colors disabled:opacity-60"
                    />
                  </div>
                </div>

                {payChannel === 'counter' ? (
                <>
                <div className="bg-gray-50/70 border border-gray-100 rounded-2xl p-3 text-xs text-gray-600">
                  Counter cash — for GCash / card, use the <span className="font-bold text-gray-900">Online</span> tab instead.
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Notes (optional)</label>
                  <input
                    type="text"
                    value={payNotes}
                    onChange={e => setPayNotes(e.target.value)}
                    placeholder="e.g. change given, reference #"
                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] transition-colors"
                  />
                </div>

                {payError && <p className="text-xs text-red-500 font-medium">{payError}</p>}

                <button
                  onClick={handleRecordPayment}
                  disabled={payLoading}
                  className="w-full py-3.5 rounded-2xl font-bold text-sm bg-[#bf4a53] text-white hover:bg-[#a83d46] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {payLoading ? 'Recording...' : `Record ₱${Number(payAmount || 0).toLocaleString()}`}
                </button>
                </>
                ) : (
                <>
                <div className="bg-blue-50/70 border border-blue-100 rounded-2xl p-3 text-xs text-gray-600">
                  {gateway === 'maya'
                    ? <>Collect via <span className="font-bold text-gray-900">Maya QRPh</span> — show the QR to the customer to scan, or open the link on their phone. Credit lands via webhook.</>
                    : <>Collect via <span className="font-bold text-gray-900">PayMongo</span> (GCash / card) — the checkout opens on this device for the customer to pay now.</>}
                </div>

                {/* Maya QR payload once generated */}
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
                    {gatewayStatus && !['succeeded'].includes(gatewayStatus) && (
                      <p className="text-[11px] font-bold text-amber-600 animate-pulse">
                        {gatewayStatus === 'expired' || gatewayStatus === 'failed' ? 'Payment not completed — generate a fresh QR.' : 'Waiting for customer payment…'}
                      </p>
                    )}
                  </div>
                )}

                {payError && <p className="text-xs text-red-500 font-medium">{payError}</p>}

                {!gatewayIntent ? (
                  <button
                    onClick={handleGatewayCharge}
                    disabled={gatewayLoading}
                    className="w-full py-3.5 rounded-2xl font-bold text-sm bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {gateway === 'maya' ? <QrCode size={15} /> : <CreditCard size={15} />}
                    {gatewayLoading ? 'Starting…' : gateway === 'maya' ? `Generate Maya QR for ₱${Number(payAmount || 0).toLocaleString()}` : `Collect ₱${Number(payAmount || 0).toLocaleString()} via PayMongo`}
                  </button>
                ) : (
                  <button
                    onClick={() => { pollStopRef.current = true; setGatewayIntent(null); setGatewayQrUrl(null); setGatewayStatus(null); setPayError(''); }}
                    className="w-full py-3 rounded-2xl font-bold text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    Start a fresh charge
                  </button>
                )}
                </>
                )}
              </>
            )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
