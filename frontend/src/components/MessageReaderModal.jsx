import { X, MessageCircle, CheckCircle2, Clock, XCircle, ExternalLink } from 'lucide-react';
import { timeAgo } from './NotificationsDropdown';

// Shared customer-message reader dialog (Messages inbox + Notifications page):
// full text, live booking state, approve-cancellation, view-booking, and
// mark-done. Pass null for onApprove/onViewBooking to hide that action.
export default function MessageReaderModal({
  message,
  done,
  bookingStatus,
  approving,
  approveResult,
  onApprove,
  onViewBooking,
  onToggleDone,
  onClose,
}) {
  if (!message) return null;
  const canApprove = !!onApprove && !!message.transactionId && !approveResult?.ok && bookingStatus !== 'Cancelled';

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-message"
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
            <MessageCircle size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="dialog-title-message" className="font-bold text-gray-900 leading-tight break-words">{message.title}</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">{timeAgo(message.time)}</p>
          </div>
          <button onClick={onClose} aria-label="Close message"
            className="text-gray-400 hover:bg-gray-100 rounded-full p-1.5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
            <X size={18} />
          </button>
        </div>

        <div className="bg-gray-50 rounded-2xl p-4 mb-4">
          <p className="text-sm text-gray-700 leading-relaxed break-words whitespace-pre-wrap">{message.text}</p>
        </div>

        {/* Done / pending state */}
        {done ? (
          <p className="text-sm font-semibold rounded-2xl px-4 py-3 mb-4 flex items-center gap-2 bg-emerald-50 text-emerald-700">
            <CheckCircle2 size={16} className="shrink-0" /> Done — this message was handled.
          </p>
        ) : (
          message.transactionId && bookingStatus && bookingStatus !== 'loading' && bookingStatus !== 'unknown' && (
            <p className={`text-sm font-semibold rounded-2xl px-4 py-3 mb-4 flex items-center gap-2 ${bookingStatus === 'Cancelled' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {bookingStatus === 'Cancelled'
                ? <><CheckCircle2 size={16} className="shrink-0" /> Done — booking already {bookingStatus.toLowerCase()}.</>
                : <><Clock size={16} className="shrink-0" /> Pending — booking is {bookingStatus}.</>}
            </p>
          )
        )}

        {approveResult && (
          <p className={`text-sm font-semibold rounded-2xl px-4 py-3 mb-4 flex items-start gap-2 ${approveResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
            {approveResult.ok
              ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              : <XCircle size={16} className="shrink-0 mt-0.5" />}
            {approveResult.text}
          </p>
        )}

        <div className="flex flex-col gap-2.5">
          {canApprove && (
            <button onClick={onApprove} disabled={approving}
              className="w-full py-3 font-bold text-sm text-white bg-red-500 hover:bg-red-600 rounded-full transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
              <XCircle size={15} /> {approving ? 'Cancelling…' : 'Approve cancellation'}
            </button>
          )}
          {message.transactionId && onViewBooking && (
            <button
              onClick={() => onViewBooking(message.transactionId)}
              className="w-full py-3 font-bold text-sm text-[#bf4a53] bg-[#bf4a53]/5 hover:bg-[#bf4a53]/10 rounded-full transition-colors flex items-center justify-center gap-1.5"
            >
              <ExternalLink size={14} /> View booking
            </button>
          )}
          <div className="flex gap-2.5">
            {onToggleDone && (
              <button onClick={onToggleDone}
                className="flex-1 py-3 font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 rounded-full transition-colors">
                {done ? 'Reopen' : 'Mark done'}
              </button>
            )}
            <button onClick={onClose}
              className="flex-1 py-3 font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 rounded-full transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
