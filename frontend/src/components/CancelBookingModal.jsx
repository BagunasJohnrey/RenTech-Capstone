import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, XCircle, MessageCircle, Send, CheckCircle2, AlertTriangle } from 'lucide-react';
import { customerLabel, itemLabel } from '../utils/format';
import { useButtonGuard } from '../hooks/useButtonGuard';

// Proper cancel-booking dialog (replaces window.confirm). Shows what will
// happen, and — for customers whose booking can't be cancelled online
// (Active/Overdue = possibly picked up) — swaps the cancel button for a
// "message the boutique" form instead of letting the request 400.
export default function CancelBookingModal({ tx, role, onClose, onCancel, onSendMessage }) {
  const isCustomer = role === 'Customer';
  const needsStaff = isCustomer && ['Active', 'Overdue'].includes(tx.status);
  const [message, setMessage] = useState('');
  const [msgError, setMsgError] = useState('');
  // Ref guards: state alone can't block same-tick double-taps on
  // Cancel/Send (duplicate cancel + duplicate message).
  const { guarding: cancelling, guard: guardCancel } = useButtonGuard();
  const { guarding: sending, guard: guardSend } = useButtonGuard();
  const [sent, setSent] = useState(false);

  const handleCancel = () => {
    guardCancel(async () => {
      await onCancel(tx.id);
      onClose();
    });
  };

  const handleSend = () => {
    const clean = message.trim();
    if (clean.length < 10) {
      setMsgError('Please write at least 10 characters so the team knows what you need.');
      return;
    }
    setMsgError('');
    guardSend(async () => {
      try {
        await onSendMessage({ transactionId: tx.id, message: clean });
        setSent(true);
      } catch (err) {
        setMsgError(err?.message || 'Could not send the message. Please try again.');
      }
    });
  };

  const code = tx.txNumber ?? tx.id;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-cancel-booking"
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0 text-red-500">
            <XCircle size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="dialog-title-cancel-booking" className="font-bold text-lg text-gray-900">Cancel booking</h3>
            <p className="text-sm text-gray-500 truncate">Booking {code}</p>
          </div>
          <button onClick={onClose} aria-label="Close cancel dialog"
            className="text-gray-400 hover:bg-gray-100 rounded-full p-1.5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
            <X size={18} />
          </button>
        </div>

        <div className="bg-gray-50 rounded-2xl p-4 space-y-1.5 text-sm mb-4">
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Item</span>
            <span className="font-bold text-gray-900 text-right break-words">{itemLabel(tx.item)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Customer</span>
            <span className="font-semibold text-gray-900 text-right break-words">{customerLabel(tx.customer)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Status</span>
            <span className="font-bold text-gray-900">{tx.status}</span>
          </div>
        </div>

        {needsStaff ? (
          <div className="flex gap-2.5 bg-amber-50 border border-amber-200/70 rounded-2xl p-4 text-sm text-amber-800 mb-4">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <p className="leading-snug">
              This booking can't be cancelled online once the item may be picked up.
              Send a message below and the boutique team will handle it for you.
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-600 mb-4">
            This cannot be undone. The item will be freed and marked Available again.
          </p>
        )}

        {/* No message box on Reserved — direct cancel is available, so the
            optional field is just noise. Active/Overdue require it. */}
        {isCustomer && tx.status !== 'Reserved' && (
          <div className="border border-gray-100 rounded-2xl p-4 mb-4">
            <label htmlFor="cancel-admin-message" className="text-xs font-bold text-gray-700 flex items-center gap-1.5 mb-2">
              <MessageCircle size={14} className="text-[#bf4a53]" />
              {needsStaff ? 'Message the boutique' : 'Message the boutique instead (optional)'}
            </label>
            {sent ? (
              <p className="text-sm text-emerald-600 font-semibold flex items-center gap-1.5">
                <CheckCircle2 size={15} /> Message sent — the team will get back to you.
              </p>
            ) : (
              <>
                <textarea
                  id="cancel-admin-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="e.g. Please cancel my booking — my event was moved."
                  className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#bf4a53] focus:bg-white resize-none"
                />
                <p className="text-[11px] text-gray-400 mt-1 flex justify-between">
                  <span>Min 10 characters</span>
                  <span className="tabular-nums">{message.length} / 1000</span>
                </p>
                {msgError && <p className="text-xs text-red-600 font-medium mt-1.5">{msgError}</p>}
                <button onClick={handleSend} disabled={sending || message.trim().length < 10}
                  className="mt-2 w-full py-2.5 rounded-xl font-bold text-sm bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
                  <Send size={14} /> {sending ? 'Sending…' : 'Send message'}
                </button>
              </>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 rounded-full transition-colors">
            Keep booking
          </button>
          {/* Direct cancel: staff anytime (pre-pickup states), customers only
              while Reserved (nothing released yet). Active/Overdue customers
              must message first — the admin cancels after reading it. */}
          {!needsStaff && (!isCustomer || tx.status === 'Reserved') && (
            <button onClick={handleCancel} disabled={cancelling}
              className="flex-1 py-3 font-bold text-sm text-white bg-red-500 hover:bg-red-600 rounded-full transition-colors disabled:opacity-50">
              {cancelling ? 'Cancelling…' : 'Cancel booking'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
