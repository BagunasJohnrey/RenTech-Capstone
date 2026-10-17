import { useState } from 'react';
import {
  AlertTriangle, Calendar, CheckCircle2, ClipboardCheck, Hash,
  MapPin, Package, Phone, X, XCircle, ZoomIn,
} from 'lucide-react';
import BottomSheet from './BottomSheet';
import ItemImage from './ItemImage';
import { useToast } from './Toast';
import { useButtonGuard } from '../hooks/useButtonGuard';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { approveProof, rejectProof } from '../services/payments';
import { customerLabel, customerPhone, customerTelLink, itemLabel } from '../utils/format';
import { peso } from '../utils/receipt';
import { timeAgo } from './NotificationsDropdown';

const fmtDate = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  return isNaN(x.getTime()) ? '—' : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Staff review of a manual-QR payment proof: verify the screenshot, credit the
// verified amount through the ledger (approve) or send it back with a reason
// (reject). Approve/reject are the only terminal actions — both close the
// sheet and refresh the queue via onDone().
export default function PaymentProofReviewModal({ proof, onClose, onDone }) {
  const tx = proof?.transaction ?? null;
  const { success: toastSuccess } = useToast();
  const [zoom, setZoom] = useState(false);
  // Escape closes the zoom overlay first; the sheet is the fallback when not zoomed.
  useEscapeClose(() => setZoom(false), zoom);
  useEscapeClose(onClose, !zoom);

  const [approveAmount, setApproveAmount] = useState(String(proof?.amount ?? ''));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const { guarding, guard } = useButtonGuard();

  const claimed = Number(proof?.amount) || 0;
  const amount = Number(approveAmount);
  const amountValid = Number.isFinite(amount) && amount > 0;
  const mismatch = amountValid && amount !== claimed;
  const belowDownpayment = amountValid && amount < (Number(tx?.downpayment) || 0);

  const custPhone = customerPhone(tx?.customer);
  const custTel = customerTelLink(tx?.customer);

  const handleApprove = () => {
    if (!amountValid || guarding) return;
    guard(async () => {
      setError('');
      try {
        const res = await approveProof(proof.id, amount);
        toastSuccess(`Payment of ${peso(res?.proof?.amount ?? amount)} verified`);
        onDone();
      } catch (err) {
        setError(err?.message || 'Failed to approve this proof.');
      }
    });
  };

  const handleReject = () => {
    const text = reason.trim();
    if (text.length < 5 || guarding) return;
    guard(async () => {
      setError('');
      try {
        await rejectProof(proof.id, text);
        toastSuccess('Proof rejected — the customer can submit a new one');
        onDone();
      } catch (err) {
        setError(err?.message || 'Failed to reject this proof.');
      }
    });
  };

  return (
    <>
      <BottomSheet onClose={onClose} labelledby="dialog-title-review-proof" z="z-[9999]">
        <div className="flex justify-between items-center p-5 sm:p-6 border-b border-gray-100/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-50 rounded-xl">
              <ClipboardCheck size={18} className="text-amber-600" />
            </div>
            <div>
              <h3 id="dialog-title-review-proof" className="font-bold text-lg text-gray-900">Verify payment</h3>
              <p className="text-xs text-gray-500">Submitted {timeAgo(proof?.createdAt)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close review dialog"
            className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60"
          >
            <X size={20} />
          </button>
        </div>

        <div data-sheet-scroll className="p-5 sm:p-6 space-y-5 flex-1 overflow-y-auto min-h-0 overscroll-contain">
          <button
            type="button"
            onClick={() => setZoom(true)}
            className="relative block w-full rounded-2xl overflow-hidden border border-gray-100 bg-gray-50"
            aria-label="Zoom payment screenshot"
          >
            <ItemImage
              image={proof?.imagePath}
              alt="Payment screenshot"
              eager
              placeholderSize={40}
              className="w-full max-h-72 object-contain"
            />
            <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-900/70 text-white text-[10px] font-bold">
              <ZoomIn size={11} /> Tap to zoom
            </span>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Package size={11} /> Item
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">{itemLabel(tx?.item) || '—'}</p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Hash size={11} /> Booking
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">#{tx?.txNumber ?? '—'}</p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Calendar size={11} /> Pickup
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">{fmtDate(tx?.rentalDate)}</p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Calendar size={11} /> Due
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">{fmtDate(tx?.dueDate)}</p>
            </div>
          </div>

          <div className="bg-white border border-gray-100/80 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] flex items-center justify-center text-sm font-extrabold shrink-0">
                {(customerLabel(tx?.customer) || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Customer</p>
                <p className="font-bold text-gray-900 truncate">{customerLabel(tx?.customer) || '—'}</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
              {custPhone ? (
                custTel ? (
                  <a
                    href={custTel}
                    className="flex items-center gap-1.5 text-xs text-gray-500 min-w-0 hover:text-emerald-600 transition-colors"
                    aria-label={`Call ${custPhone}`}
                  >
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
              {tx?.customer?.address ? (
                <p className="flex items-center gap-1.5 text-xs text-gray-500 min-w-0">
                  <MapPin size={12} className="text-gray-400 shrink-0" />
                  <span className="truncate uppercase">{tx.customer.address}</span>
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-amber-600 min-w-0">
                  <MapPin size={12} className="shrink-0" />
                  <span className="italic">No address on file</span>
                </p>
              )}
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200/70 rounded-2xl p-4">
            <p className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-amber-600" /> Customer claims {peso(claimed)}
            </p>
            <div className="mt-2 space-y-1 text-xs text-gray-600">
              <p>Reference: <span className="font-bold text-gray-900">{proof?.reference || '—'}</span></p>
              <p>Channel: <span className="font-bold text-gray-900">{proof?.channel || '—'}</span></p>
              <p>
                Downpayment due: <span className="font-bold text-gray-900">{peso(tx?.downpayment)}</span>
                {' '}· Paid so far: {peso(tx?.totalPaid)}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label htmlFor="proof-approve-amount" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                Amount to credit
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">₱</span>
                <input
                  id="proof-approve-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={approveAmount}
                  onChange={(e) => { setApproveAmount(e.target.value); setError(''); }}
                  className="w-full pl-8 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] transition-colors"
                />
              </div>
            </div>
            {(mismatch || belowDownpayment) && (
              <div className="bg-amber-50 border border-amber-200/70 rounded-xl px-3 py-2 space-y-0.5">
                {mismatch && (
                  <p className="text-[11px] font-semibold text-amber-700 flex items-center gap-1">
                    <AlertTriangle size={11} className="shrink-0" /> Differs from the claimed {peso(claimed)} — credit only what you actually verified.
                  </p>
                )}
                {belowDownpayment && (
                  <p className="text-[11px] font-semibold text-amber-700 flex items-center gap-1">
                    <AlertTriangle size={11} className="shrink-0" /> Below the {peso(tx?.downpayment)} downpayment — this won't fully confirm the booking.
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={handleApprove}
              disabled={guarding || !amountValid}
              className="w-full py-3 text-sm font-bold text-white bg-[#bf4a53] hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-sm shadow-red-500/20"
            >
              <CheckCircle2 size={15} />
              {guarding ? 'Working…' : amountValid ? `Approve & credit ${peso(amount)}` : 'Approve & credit'}
            </button>
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <div>
              <label htmlFor="proof-reject-reason" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                Rejection reason
              </label>
              <textarea
                id="proof-reject-reason"
                value={reason}
                onChange={(e) => { setReason(e.target.value.slice(0, 300)); setError(''); }}
                rows={3}
                placeholder="e.g. Reference number unreadable — please re-upload a clearer screenshot"
                className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm leading-relaxed focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/20 transition-all resize-none"
              />
              <p className={`text-[11px] text-right font-medium ${reason.trim().length > 0 && reason.trim().length < 5 ? 'text-amber-600' : 'text-gray-400'}`}>
                {reason.length}/300 · min 5
              </p>
            </div>
            <button
              type="button"
              onClick={handleReject}
              disabled={guarding || reason.trim().length < 5}
              className="w-full py-3 text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 rounded-2xl transition-all flex items-center justify-center gap-2"
            >
              <XCircle size={15} />
              {guarding ? 'Working…' : 'Reject proof'}
            </button>
          </div>

          {error && (
            <p className="text-xs font-semibold text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>
      </BottomSheet>

      {zoom && (
        <div
          className="fixed inset-0 z-[10000] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setZoom(false)}
        >
          <button
            onClick={() => setZoom(false)}
            aria-label="Close zoom"
            className="absolute top-4 right-4 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
          <ItemImage
            image={proof?.imagePath}
            alt="Payment screenshot"
            eager
            placeholderSize={64}
            className="max-w-full max-h-full object-contain rounded-xl"
          />
        </div>
      )}
    </>
  );
}
