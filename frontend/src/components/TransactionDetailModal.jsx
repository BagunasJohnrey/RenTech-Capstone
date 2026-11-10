import { useState, useEffect, useCallback, useRef } from 'react';
import RequiredMark from './ui/RequiredMark';
import { X, Receipt, Calendar, Ruler, FileText, CreditCard, Camera, Download, Banknote, Smartphone, Phone, Undo2, Maximize2, MapPin, UserCheck, PackageCheck, History, QrCode, AlertTriangle, Clock, Upload, CheckCircle2 } from 'lucide-react';
import { customerLabel, customerPhone, customerTelLink, itemLabel } from '../utils/format';
import { normalizeTx, invalidateTxCache, getTxAudits, preloadTxPhotos, peekFullTx, peekTxAudits } from '../hooks/useTransactions';
import { getBookingCode } from '../utils/receipt';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import ItemImage from './ItemImage';
import BookingQR from './BookingQR';
import { Skeleton } from './Skeleton';
import { useEscapeClose } from '../hooks/useEscapeClose';
import BottomSheet from './BottomSheet';
import { TX_STATUS_PILLS } from '../utils/statusColors';
import { api } from '../utils/api';
import ManualQrPanel from './ManualQrPanel';
import PhotoViewer from './PhotoViewer';
import ItemPhotoThumb from './ItemPhotoThumb';
import PaymentProofModal from './PaymentProofModal';
import { paymentsService } from '../services/payments';
import { emitDataChanged } from '../utils/dataEvents';
import { qrPaymentUnresolved } from '../utils/txDisplayStatus';

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

// Plain-language entry for an audit-log row in the staff timeline:
// { title, detail?, tone } — tone picks the dot color.
const peso = (n) => `₱${Number(n).toLocaleString()}`;
const shortDay = (d) => {
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const capFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// Raw action ids ("item_swap", "sms.send") → "Item swap", "Sms send".
const humanize = (s) => capFirst(String(s || 'Activity').replace(/[._]+/g, ' ').trim());

const auditEntry = (log) => {
  const nv = log?.newValue ?? {};
  const ov = log?.oldValue ?? {};
  const action = log?.action;

  if (log?.entity === 'payment_proof') {
    const amt = nv.amount != null ? peso(nv.amount) : null;
    if (action === 'payment_proof.submit') {
      return { title: 'Payment proof sent', detail: [amt, nv.reference && `Ref ${nv.reference}`].filter(Boolean).join(' · ') || null, tone: 'amber' };
    }
    if (action === 'payment_proof.approve') return { title: 'Payment proof approved', detail: amt, tone: 'green' };
    if (action === 'payment_proof.reject') return { title: 'Payment proof rejected', detail: nv.reason || null, tone: 'red' };
  }
  if (action === 'create' && log?.entity === 'transaction') return { title: 'Booking created', tone: 'violet' };
  if (action === 'item_swap') {
    const from = ov.itemName, to = nv.itemName;
    const swap = from && to ? `${from} → ${to}` : to ? `Now: ${to}` : null;
    const bal = nv.balance != null ? `balance ${peso(nv.balance)}` : null;
    return { title: 'Item swapped', detail: [swap, bal].filter(Boolean).join(' · ') || null, tone: 'blue' };
  }
  if (nv.paymentReceived != null) {
    return { title: 'Payment received', detail: [peso(nv.paymentReceived), nv.balance != null && `balance ${peso(nv.balance)}`].filter(Boolean).join(' · '), tone: 'green' };
  }
  if (log?.entity === 'payment') {
    return { title: 'Payment received', detail: [nv.amount != null && peso(nv.amount), nv.method].filter(Boolean).join(' · ') || null, tone: 'green' };
  }
  if (nv.released) return { title: 'Picked up by customer', tone: 'blue' };
  if (nv.status === 'Returned') {
    const fees = [
      Number(nv.latePenalty) > 0 && `late fee ${peso(nv.latePenalty)}`,
      Number(nv.damageFee) > 0 && `damage fee ${peso(nv.damageFee)}`,
      nv.damageReason,
    ].filter(Boolean);
    return {
      title: nv.damageReason || Number(nv.damageFee) > 0 ? 'Returned with damage' : 'Returned to store',
      detail: fees.length ? capFirst(fees.join(' · ')) : 'No late or damage fees',
      tone: nv.damageReason || Number(nv.damageFee) > 0 ? 'red' : 'green',
    };
  }
  if (nv.status === 'Cancelled') return { title: 'Booking cancelled', tone: 'red' };
  // One-time clean-up script (scripts/backfill-payments.ts) that added
  // missing payment entries to old bookings and recalculated the balance.
  if (action === 'backfill') return { title: 'Payment records repaired', detail: 'Missing payment entries added by a system clean-up', tone: 'gray' };
  if (action === 'contact_admin') return { title: 'Customer sent a message', detail: nv.message || null, tone: 'gray' };
  if (action === 'update' && log?.entity === 'transaction') {
    const changes = [];
    if ('rentalDate' in nv && shortDay(nv.rentalDate) !== shortDay(ov.rentalDate)) changes.push(`pickup ${shortDay(ov.rentalDate) ?? '—'} → ${shortDay(nv.rentalDate) ?? '—'}`);
    if ('dueDate' in nv && shortDay(nv.dueDate) !== shortDay(ov.dueDate)) changes.push(`return ${shortDay(ov.dueDate) ?? '—'} → ${shortDay(nv.dueDate) ?? '—'}`);
    if ('notes' in nv && (nv.notes || '') !== (ov.notes || '')) changes.push('notes updated');
    if ('alterationStatus' in nv && nv.alterationStatus !== ov.alterationStatus) changes.push(`alteration ${nv.alterationStatus ? humanize(nv.alterationStatus).toLowerCase() : 'cleared'}`);
    const datesOnly = changes.length > 0 && changes.every((c) => c.startsWith('pickup') || c.startsWith('return'));
    return {
      title: datesOnly ? 'Dates changed' : 'Booking edited',
      detail: changes.length ? capFirst(changes.join(' · ')) : null,
      tone: 'gray',
    };
  }
  return { title: humanize(action), tone: 'gray' };
};

const AUDIT_DOT = {
  violet: 'bg-violet-500 ring-violet-100',
  blue: 'bg-blue-500 ring-blue-100',
  green: 'bg-emerald-500 ring-emerald-100',
  amber: 'bg-amber-500 ring-amber-100',
  red: 'bg-red-500 ring-red-100',
  gray: 'bg-gray-300 ring-gray-100',
};

const fmtWhen = (d) => {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  const day = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const time = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
};

export default function TransactionDetailModal({ transaction, onClose, fetchFull, role, onReturn }) {
  const flags = useFeatureFlags();
  // Freeze the page behind the sheet; the backdrop is tap-to-close only.
  const [qrSaveUrl, setQrSaveUrl] = useState(null);
  // List record + any already-fetched full record = instant first paint.
  const mergeFull = (base, full) => (full ? normalizeTx({ ...base, ...full }) : base);
  const [tx, setTx] = useState(() => mergeFull(transaction, peekFullTx(transaction?.id)));
  const [showPayModal, setShowPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState('');
  const [payLoading, setPayLoading] = useState(false);
  const [paySuccess, setPaySuccess] = useState(false);
  // Record Payment channels: counter (cash, recorded here) or the
  // boutique's static QR (verified in person, then recorded).
  const [payChannel, setPayChannel] = useState('counter');
  const [manualQrCodes, setManualQrCodes] = useState([]);
  const [manualChannel, setManualChannel] = useState('');
  // Gate the body on enrichment: everything appears at once when the full
  // record lands — never staged pop-ins. Header/footer use instant list data.
  const [enriching, setEnriching] = useState(() => !!(transaction?.id && fetchFull) && !peekFullTx(transaction?.id));
  // Staff audit timeline (who assisted / released / returned / edited).
  // Staff-only endpoint — customers get a 403, which we swallow silently.
  // Starts true so the body gate below holds the skeleton until the timeline
  // lands alongside the record — both fire in parallel on mount, and the
  // sheet appears once with everything instead of staged pop-ins.
  const isStaffView = role === 'Admin' || role === 'Staff';
  const isCustomerView = role === 'Customer';
  // Customer-only: this booking's QR payment proofs (newest first) so a
  // rejected proof can be re-uploaded straight from the booking.
  // The customer list record already carries the latest proof
  // (`paymentProofs[0]`), so the banner renders with no extra request. Only a
  // record without it (deep link) or a fresh re-upload triggers a fetch.
  const listHasProofs = Array.isArray(transaction?.paymentProofs);
  const [fetchedProofs, setFetchedProofs] = useState(null);
  // Holds the body skeleton only when we must fetch, so "Downpayment not yet
  // paid" never flashes before the real status.
  const [proofsLoading, setProofsLoading] = useState(() => role === 'Customer' && !!transaction?.id && !listHasProofs);
  const [proofsKey, setProofsKey] = useState(0);
  const [showProofUpload, setShowProofUpload] = useState(false);
  const [audits, setAudits] = useState(() => peekTxAudits(transaction?.id) || []);
  const [auditsLoading, setAuditsLoading] = useState(() => !peekTxAudits(transaction?.id));
  // The shared BottomSheet owns drag-to-dismiss + enter/exit animations.
  // closingRef guards late fetch resolutions: a record landing mid-exit
  // would swap the content under the fade-out.
  const closingRef = useRef(false);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    onClose();
  }, [onClose]);
  useEffect(() => {
    if (!isCustomerView || !transaction?.id) return undefined;
    if (listHasProofs && proofsKey === 0) return undefined;
    let active = true;
    paymentsService.myProofs()
      .then((d) => {
        if (!active) return;
        const list = Array.isArray(d?.proofs) ? d.proofs : [];
        setFetchedProofs(list.filter((p) => p.transaction?.id === transaction.id));
      })
      .catch(() => {})
      .finally(() => { if (active) setProofsLoading(false); });
    return () => { active = false; };
  }, [isCustomerView, transaction?.id, proofsKey, listHasProofs]);
  const closePayModal = useCallback(() => {
    if (payLoading) return;
    setShowPayModal(false);
  }, [payLoading]);
  const openPayModal = () => {
    setPayChannel('counter');
    setPayError('');
    setPaySuccess(false);
    // Prefill the full outstanding so Record ₱X is one tap.
    if (!payAmount && tx?.balance > 0) setPayAmount(String(Math.max(0, tx.balance)));
    api.get('/settings/rental-defaults')
      .then((d) => {
        const codes = Array.isArray(d?.manual_qr_codes) ? d.manual_qr_codes : [];
        setManualQrCodes(codes);
        if (codes[0]) setManualChannel(codes[0].id);
      })
      .catch(() => {});
    setShowPayModal(true);
  };
  // Full-screen condition photo (index into conditionPhotos), or null.
  const [photoView, setPhotoView] = useState(null);
  // Full-screen catalog photo of the rented item.
  const [itemPhotoOpen, setItemPhotoOpen] = useState(false);
  // Esc dismisses the topmost layer first (photo, then pay form, then sheet).
  const handleEscape = useCallback(() => {
    if (itemPhotoOpen) setItemPhotoOpen(false);
    else if (photoView != null) setPhotoView(null);
    else if (showPayModal) closePayModal();
    else requestClose();
  }, [itemPhotoOpen, photoView, showPayModal, closePayModal, requestClose]);
  useEscapeClose(handleEscape);

  // Fetch enrichment only when the transaction id changes — `transaction` is a
  // new object identity on every parent render, and `normalizeTx()` also
  // returns a fresh object, so depending on them (or calling setTx every
  // render + every fetch resolve) creates an infinite update loop, which is
  // what used to block the close button from ever un-mounting the modal.
  useEffect(() => {
    setTx(mergeFull(transaction, peekFullTx(transaction?.id)));
  }, [transaction?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enrichment + audit timeline fire in PARALLEL on open; the body gate below
  // holds the skeleton until BOTH resolve, so the sheet (incl. Staff Audit)
  // appears in one paint — never a staged pop-in of the Activity list after
  // the rest of the body. Audit fetch is best-effort: a 403 (non-staff) or a
  // network blip simply hides the section instead of blocking the sheet.
  useEffect(() => {
    let cancelled = false;
    const jobs = [];
    // Already fetched recently? Paint it now and refresh silently below.
    const cachedFull = peekFullTx(transaction?.id);
    const cachedAudits = isStaffView ? peekTxAudits(transaction?.id) : null;
    setAudits(cachedAudits || []);
    // Condition photos are the slowest part of the sheet (signing request +
    // full-size download), so start them NOW, alongside the record and the
    // timeline, instead of after the body renders and they scroll into view.
    preloadTxPhotos(transaction);
    if (transaction?.id && fetchFull) {
      if (cachedFull) setTx(mergeFull(transaction, cachedFull));
      setEnriching(!cachedFull);
      jobs.push(
        // normalize the full record so customerProfile is always present —
        // otherwise the address flickers in from the list item then vanishes.
        fetchFull(transaction.id)
          .then((full) => {
            preloadTxPhotos(full);
            if (!cancelled && !closingRef.current) setTx(mergeFull(transaction, full));
          })
          .catch(() => {})
          .finally(() => { if (!cancelled) setEnriching(false); })
      );
    } else {
      setEnriching(false);
    }
    if (isStaffView && transaction?.id) {
      setAuditsLoading(!cachedAudits);
      jobs.push(
        getTxAudits(transaction.id)
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
  // Item catalog photo: full record carries the item object, list rows the
  // flattened `itemImage` — fall back to the incoming prop so it paints instantly.
  const itemImg = (tx.item && typeof tx.item === 'object' ? tx.item.image : null)
    || tx.itemImage
    || (transaction?.item && typeof transaction.item === 'object' ? transaction.item.image : null)
    || transaction?.itemImage
    || null;
  const conditionPhotos = [
    (tx.releasePhoto || tx.conditionPhoto) && { image: tx.releasePhoto || tx.conditionPhoto, label: 'Release (Before)', alt: 'Item condition at release' },
    tx.returnPhoto && { image: tx.returnPhoto, label: 'Return (After)', alt: 'Item condition on return' },
  ].filter(Boolean);
  const rentalTotal = Number(tx.rentalFee ?? tx.amount ?? 0) || 0;
  const myProofs = fetchedProofs ?? (Array.isArray(tx.paymentProofs) ? tx.paymentProofs : (transaction?.paymentProofs || []));
  const latestProof = myProofs[0] || null;
  const bookingOpen = !['Cancelled', 'Returned'].includes(tx.status);
  const isManualBooking = tx.paymentPath === 'manual' || tx.gateway === 'manual';
  const downpaymentUnpaid = Number(tx.totalPaid ?? 0) < Number(tx.downpayment ?? 0);
  const canReuploadProof = isCustomerView && bookingOpen && downpaymentUnpaid
    && (latestProof ? latestProof.status === 'rejected' : isManualBooking);
  const paidSoFar = Number(tx.totalPaid ?? 0) || 0;
  const paidPct = rentalTotal > 0 ? Math.min(100, Math.round((paidSoFar / rentalTotal) * 100)) : 0;
  const outstandingBalance = Math.max(0, tx.balance ?? 0);
  // Channel label for the manual-transfer note (falls back to the first QR).
  const manualChannelLabel = manualQrCodes.find((q) => q.id === manualChannel)?.label
    || manualQrCodes[0]?.label || 'InstaPay';
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
      // Counter = cash only (the static QR lives on the Online tab).
      const res = await api.post(`/transactions/${tx.id}/payments`, { amount: amt, method: 'cash', notes: payNotes || undefined });
      // Payments post outside the transactions hook — drop the cached full
      // record so the next open re-reads instead of serving stale totals.
      invalidateTxCache(tx.id);
      // Lists / Tasks / Release sheets elsewhere hold their own copy of this
      // booking — tell them to reload now instead of on the next 20s check.
      emitDataChanged({ source: 'payment', id: tx.id });
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

  // Static QR: the customer pays the boutique's own QR; the staff member
  // verifies it in person then records it here as an instapay payment. Same
  // record path/merge as the counter cash flow — the method/notes differ.
  const handleManualRecord = async () => {
    setPayError('');
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { setPayError('Enter a valid amount'); return; }
    if (amt > outstandingBalance) { setPayError(`Maximum is ₱${outstandingBalance.toLocaleString()}`); return; }
    setPayLoading(true);
    try {
      const res = await api.post(`/transactions/${tx.id}/payments`, {
        amount: amt,
        method: 'instapay',
        notes: `${manualChannelLabel} transfer — verified in person`,
      });
      invalidateTxCache(tx.id);
      // Lists / Tasks / Release sheets elsewhere hold their own copy of this
      // booking — tell them to reload now instead of on the next 20s check.
      emitDataChanged({ source: 'payment', id: tx.id });
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


  return (
    <>
      {/* Flex column: static header + scrolling body + pinned footer, so the
          actions never scroll away on mobile. Own white handle lives on the
          gradient header, so the sheet's gray one is hidden. */}
      <BottomSheet onClose={requestClose} labelledby="dialog-title-transaction-detail" z="z-[300]" maxWidth="sm:max-w-lg" panelWidth="md:w-[640px] lg:w-[920px]" hideHandle>

        {/* Header — brand gradient band */}
        <div className="shrink-0 overflow-hidden">
          <div className="bg-gradient-to-r from-[#bf4a53] to-[#e07080] px-5 sm:px-6 pt-2 sm:pt-5 pb-4 relative">
            <div className="flex justify-center sm:hidden" aria-hidden="true">
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
              <button onClick={requestClose} aria-label="Close transaction details" className="p-2 text-white/80 hover:bg-white/20 rounded-full transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
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

        <div data-sheet-scroll className="p-5 sm:p-6 lg:p-8 space-y-6 flex-1 overflow-y-auto min-h-0 overscroll-contain">
          {(enriching || (isStaffView && auditsLoading) || (isCustomerView && proofsLoading)) ? (
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
          // Desktop (lg+): two full-height columns (.panel-split) — people &
          // schedule on the left, money & records on the right, with one
          // card per column stretching so neither leaves an empty band.
          // Below lg: the same single column, same order, as before.
          <div className="space-y-6 panel-split">
          <div className="space-y-6 panel-col">
          {/* Customer & Item — profile-tile cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-white border border-gray-100/80 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] flex items-center justify-center text-sm font-extrabold shrink-0">
                  {custInitial}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Customer</p>
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
                <ItemPhotoThumb image={itemImg} name={itemLabel(tx.item)} onOpen={() => setItemPhotoOpen(true)} className="w-14 h-14" iconSize={18} />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Item</p>
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
            <div className="panel-grow panel-stack">
              <div className="flex items-center gap-1.5 text-gray-400 mb-3">
                <UserCheck size={13} />
                <span className="text-xs font-bold uppercase tracking-wide">Staff Audit</span>
              </div>
              <div className="panel-fill bg-white border border-gray-100/80 rounded-2xl p-4 space-y-3">
                {assistedName && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                      <UserCheck size={15} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Assisted by</p>
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
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Released by</p>
                      <p className="text-sm font-bold text-gray-900 truncate">{releasedName}</p>
                    </div>
                  </div>
                )}
                {!assistedName && !releasedName && audits.length === 0 && (
                  <p className="text-xs text-gray-400 italic">No staff activity recorded (online booking).</p>
                )}
                {audits.length > 0 && (
                  <div className={(assistedName || releasedName) ? 'pt-3 border-t border-gray-100' : ''}>
                    <p className="flex items-center gap-1.5 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                      <History size={11} /> Activity
                    </p>
                    <ol className="relative space-y-3 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-gray-200">
                      {audits.map((log) => {
                        const entry = auditEntry(log);
                        const when = log?.createdAt ? fmtWhen(log.createdAt) : null;
                        return (
                          <li key={log.id} className="relative pl-7">
                            <span className={`absolute left-0 top-1 w-[11px] h-[11px] rounded-full ring-4 ${AUDIT_DOT[entry.tone] || AUDIT_DOT.gray}`} />
                            <p className="text-sm font-bold text-gray-900">{entry.title}</p>
                            {entry.detail && <p className="text-xs text-gray-700 break-words">{entry.detail}</p>}
                            <p className="text-xs text-gray-500">
                              {log?.performedBy?.name ? `by ${log.performedBy.name}` : 'Automatic'}
                              {when ? ` · ${when}` : ''}
                            </p>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Schedule timeline */}
          <div className={showStaffAudit ? '' : 'panel-grow panel-stack'}>
            <div className="flex items-center gap-1.5 text-gray-400 mb-3">
              <Calendar size={13} />
              <span className="text-xs font-bold uppercase tracking-wide">Schedule</span>
            </div>
            <div className="panel-fill bg-white border border-gray-100/80 rounded-2xl p-4">
              <ol className="relative space-y-4 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-gray-200">
                <li className="relative pl-7">
                  <span className="absolute left-0 top-1 w-[11px] h-[11px] rounded-full bg-blue-500 ring-4 ring-blue-100" />
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Pickup Date</p>
                  <p className="text-sm font-bold text-gray-900">{fmtDate(tx.rentalDate || tx.date) || '—'}</p>
                </li>
                <li className="relative pl-7">
                  <span className={`absolute left-0 top-1 w-[11px] h-[11px] rounded-full ring-4 ${status === 'Overdue' ? 'bg-red-500 ring-red-100' : status === 'Returned' ? 'bg-emerald-500 ring-emerald-100' : 'bg-amber-400 ring-amber-100'}`} />
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Due / Return By</p>
                  <p className={`text-sm font-bold ${status === 'Overdue' ? 'text-red-600' : 'text-gray-900'}`}>{fmtDate(tx.dueDate || tx.returnDate) || '—'}</p>
                </li>
                {tx.returnDate && ['Returned'].includes(status) && (
                  <li className="relative pl-7">
                    <span className="absolute left-0 top-1 w-[11px] h-[11px] rounded-full bg-emerald-500 ring-4 ring-emerald-100" />
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Actual Return</p>
                    <p className="text-sm font-bold text-gray-900">{fmtDate(tx.returnDate)}</p>
                  </li>
                )}
              </ol>
            </div>
          </div>

          </div>
          <div className="space-y-6 panel-col">
          {/* Customer: QR payment-proof status + re-upload when rejected */}
          {isCustomerView && (latestProof || canReuploadProof) && (
            latestProof?.status === 'rejected' ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0"><AlertTriangle size={17} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-red-700">Payment proof rejected</p>
                    {latestProof.rejectionReason && (
                      <p className="text-xs text-red-600 mt-0.5 break-words">Reason: <span className="font-semibold">{latestProof.rejectionReason}</span></p>
                    )}
                    <p className="text-[11px] text-red-500/80 mt-1">{canReuploadProof ? 'Upload a clear screenshot of your payment so staff can verify your booking.' : 'Contact the boutique if you need help with this booking.'}</p>
                  </div>
                </div>
                {canReuploadProof && (
                  <button type="button" onClick={() => setShowProofUpload(true)}
                    className="mt-3 w-full py-2.5 rounded-xl bg-[#bf4a53] text-white text-sm font-bold hover:bg-[#a83f47] transition-colors flex items-center justify-center gap-2">
                    <Upload size={15} /> Re-upload payment proof
                  </button>
                )}
              </div>
            ) : latestProof?.status === 'pending' ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0"><Clock size={17} /></div>
                <div>
                  <p className="text-sm font-bold text-amber-800">Payment under review</p>
                  <p className="text-xs text-amber-700 mt-0.5">Staff are checking your {latestProof.amount ? `₱${Number(latestProof.amount).toLocaleString()} ` : ''}payment proof. You'll be notified once it's verified.</p>
                </div>
              </div>
            ) : latestProof?.status === 'approved' ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0"><CheckCircle2 size={17} /></div>
                <div>
                  <p className="text-sm font-bold text-emerald-800">Payment verified</p>
                  <p className="text-xs text-emerald-700 mt-0.5">Your downpayment proof was approved.</p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm font-bold text-gray-800">Downpayment not yet paid</p>
                <p className="text-xs text-gray-500 mt-0.5">Pay through the boutique's QR and upload your screenshot to confirm this booking.</p>
                <button type="button" onClick={() => setShowProofUpload(true)}
                  className="mt-3 w-full py-2.5 rounded-xl bg-[#bf4a53] text-white text-sm font-bold hover:bg-[#a83f47] transition-colors flex items-center justify-center gap-2">
                  <Upload size={15} /> Upload payment proof
                </button>
              </div>
            )
          )}
          {/* Payment Summary */}
          <div>
            <div className="flex items-center gap-1.5 text-gray-400 mb-3">
              <CreditCard size={13} />
              <span className="text-xs font-bold uppercase tracking-wide">Payment</span>
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
                {/* The downpayment is the REQUIRED amount, not money received —
                    say so when it hasn't actually been paid yet. */}
                <DetailRow
                  label={paidSoFar >= Number(tx.downpayment ?? 0) ? 'Downpayment' : 'Downpayment (required)'}
                  value={paidSoFar > 0 || !(Number(tx.downpayment) > 0)
                    ? fmtCurrency(tx.downpayment)
                    : `${fmtCurrency(tx.downpayment)} · not received`}
                />
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
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Payment History</p>
                {tx.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${p.method === 'cash' ? 'bg-green-100 text-green-700' : p.method === 'gcash' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        {p.method === 'cash' ? <Banknote size={14} /> : p.method === 'gcash' ? <Smartphone size={14} /> : <CreditCard size={14} />}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{fmtCurrency(p.amount)}</p>
                        <p className="text-xs text-gray-500 capitalize">{p.method} · {p.type}</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">{new Date(p.createdAt).toLocaleDateString()}</p>
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
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Booking QR</p>
                {qrSaveUrl && (
                  <a
                    href={qrSaveUrl}
                    download={`${getBookingCode(tx)}.png`}
                    className="inline-flex items-center gap-1 text-xs font-bold text-[#bf4a53] hover:underline"
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
                    <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-white/50">Booking QR code</p>
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
                <span className="text-xs font-bold uppercase tracking-wide">Measurements</span>
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
          <div className="panel-grow panel-stack">
            <div className="flex items-center gap-1.5 text-gray-400 mb-3">
              <FileText size={13} />
              <span className="text-xs font-bold uppercase tracking-wide">Notes</span>
            </div>
            <div className="panel-fill bg-white border border-gray-100/80 rounded-2xl p-4 text-sm">
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
                <span className="text-xs font-bold uppercase tracking-wide">Condition Photos</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {conditionPhotos.map((p, i) => (
                  <button key={p.label} type="button" onClick={() => setPhotoView(i)}
                    aria-label={`View ${p.label} photo full size`}
                    className="group text-left bg-white border border-gray-100/80 rounded-2xl overflow-hidden hover:border-gray-200 hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50">
                    <div className="relative">
                      <ItemImage eager thumb image={p.image} alt={p.alt} className="w-full h-40 object-cover" placeholderSize={20} />
                      <span aria-hidden="true" className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/45 text-white flex items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity">
                        <Maximize2 size={14} />
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 font-medium text-center py-2">{p.label}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          </div>
          </div>
          )}
        </div>

        {/* Footer actions — pinned below the scrolling body (flex column, not
            sticky) so they stay fixed on mobile. Close removed (header X /
            backdrop / Esc still dismiss). */}
        <div className="shrink-0 bg-white/95 backdrop-blur-md border-t border-gray-100/80 px-5 sm:px-6 lg:px-8 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-b-3xl">
          {/* Desktop (lg+): one row — notice on the left, compact buttons on
              the right. Below lg: stacked full-width, as before. */}
          <div className="space-y-2 lg:space-y-0 lg:flex lg:items-center lg:justify-end lg:gap-3">
            {/* QR proof still unverified: say exactly what unlocks the booking
                (approval credits the downpayment and brings back Release). */}
            {(role === 'Admin' || role === 'Staff') && ['Reserved', 'Active', 'Overdue'].includes(tx.status) && qrPaymentUnresolved(tx) && (
              <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 text-xs font-semibold text-blue-800 lg:flex-1">
                Waiting on the ₱{Number(tx.downpayment || 0).toLocaleString()} QR payment proof — approve it in Tasks → Payments to verify. Approving credits the downpayment and unlocks Release.
              </div>
            )}
            {(role === 'Admin' || role === 'Staff') && ['Active', 'Overdue'].includes(tx.status) && isReturnBlockedByBalance && !qrPaymentUnresolved(tx) && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs font-semibold text-amber-800 lg:flex-1">
                Settle the ₱{outstandingBalance.toLocaleString()} balance first — return is locked until fully paid.
              </div>
            )}
            {canProcessReturn && onReturn && (
              <button onClick={() => onReturn(tx)} className="w-full lg:w-auto lg:shrink-0 lg:px-8 py-3.5 rounded-2xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm flex items-center justify-center gap-2">
                <Undo2 size={16} /> Process Return
              </button>
            )}
            {canRecordPayment && (
              <button onClick={openPayModal} className="w-full lg:w-auto lg:shrink-0 lg:px-8 py-3.5 rounded-2xl font-bold text-sm bg-[#bf4a53] text-white hover:bg-[#a83d46] transition-colors shadow-sm flex items-center justify-center gap-2">
                <Banknote size={16} /> {tx.status === 'Returned' ? `Settle damage ₱${outstandingBalance.toLocaleString()}` : 'Record Payment'}
              </button>
            )}
          </div>
        </div>
      </BottomSheet>

      {/* Record Payment — stacked sheet. No second blur: the parent sheet
          already blurs beneath, and two stacked blurs jank low-end phones. */}
      {showPayModal && (
        <BottomSheet onClose={closePayModal} labelledby="dialog-title-record-payment" z="z-[310]" maxWidth="sm:max-w-sm" variant="dialog"
          interceptClose={payLoading} backdropClass="bg-gray-900/50">
            <div data-sheet-scroll className="overflow-y-auto min-h-0 p-5 sm:p-6 space-y-5">
            {paySuccess ? (
              <div className="text-center py-4">
                <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Banknote size={24} className="text-green-600" />
                </div>
                <p className="font-bold text-lg text-gray-900">Payment Recorded</p>
                <p className="text-sm text-gray-500 mt-1">₱{Number(payAmount).toLocaleString()} via {payChannel === 'online' ? manualChannelLabel : 'cash'}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h4 id="dialog-title-record-payment" className="font-bold text-lg text-gray-900">Record Payment</h4>
                  <button onClick={closePayModal} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors" aria-label="Close payment form">
                    <X size={18} />
                  </button>
                </div>

                <div className="bg-gray-50 rounded-xl p-3 text-sm">
                  <p className="text-gray-500">Outstanding balance</p>
                  <p className="font-bold text-lg text-[#bf4a53]">₱{outstandingBalance.toLocaleString()}</p>
                </div>

                {/* Channel switch: counter cash vs the boutique's static QR */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-2xl" role="tablist" aria-label="Payment channel">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={payChannel === 'counter'}
                    onClick={() => { setPayChannel('counter'); setPayError(''); }}
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
                    <QrCode size={14} /> Online
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Amount<RequiredMark show={!String(payAmount ?? '').trim()} /></label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">₱</span>
                    <input
                      type="number"
                      min="1"
                      max={outstandingBalance}
                      value={payAmount}
                      onChange={e => { setPayAmount(e.target.value); setPayError(''); }}
                      placeholder="0"
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
                <ManualQrPanel
                  qrCodes={manualQrCodes}
                  channel={manualChannel}
                  onChannelChange={setManualChannel}
                  note="Verify the transfer in your payment app before recording it."
                />
                {payError && <p className="text-xs text-red-500 font-medium">{payError}</p>}
                <button
                  onClick={handleManualRecord}
                  disabled={payLoading || manualQrCodes.length === 0}
                  className="w-full py-3.5 rounded-2xl font-bold text-sm bg-[#bf4a53] text-white hover:bg-[#a83d46] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {payLoading ? 'Recording...' : 'Customer has paid — record payment'}
                </button>
                </>
                )}
              </>
            )}
            </div>
        </BottomSheet>
      )}

      {photoView != null && conditionPhotos[photoView] && (
        <PhotoViewer photos={conditionPhotos} index={photoView} onIndexChange={setPhotoView} onClose={() => setPhotoView(null)} />
      )}

      {itemPhotoOpen && itemImg && (
        <PhotoViewer photos={[{ image: itemImg, label: itemLabel(tx.item) || 'Item' }]} index={0} onIndexChange={() => {}} onClose={() => setItemPhotoOpen(false)} />
      )}

      {showProofUpload && (
        <PaymentProofModal
          tx={tx}
          z="z-[320]"
          onClose={() => setShowProofUpload(false)}
          onSubmitted={() => { setProofsKey((k) => k + 1); invalidateTxCache(tx.id); }}
        />
      )}
    </>
  );
}
