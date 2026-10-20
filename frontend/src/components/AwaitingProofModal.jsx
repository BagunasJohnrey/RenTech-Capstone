import { createPortal } from 'react-dom';
import {
  AlertTriangle, Calendar, ClipboardCheck, Hash, MapPin, Package, Phone, X,
} from 'lucide-react';
import BottomSheet from './BottomSheet';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { customerLabel, customerPhone, customerTelLink, itemLabel } from '../utils/format';
import { peso } from '../utils/receipt';
import { timeAgo } from './NotificationsDropdown';

const fmtDate = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  return isNaN(x.getTime()) ? '—' : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Read-only detail sheet for a booking that still owes a manual-QR payment
// proof. Staff use it to see who/what/when before chasing the customer; it
// deliberately does not jump straight into the transaction editor.
export default function AwaitingProofModal({ booking, onClose }) {
  useEscapeClose(onClose, true);
  const rejected = booking?.latestProof?.status === 'rejected';
  const downpayment = Number(booking?.downpayment) || 0;
  const paid = Number(booking?.totalPaid) || 0;
  const remaining = Math.max(0, downpayment - paid);
  const custPhone = customerPhone(booking?.customer);
  const custTel = customerTelLink(booking?.customer);

  return createPortal(
    <BottomSheet onClose={onClose} labelledby="dialog-title-awaiting-proof" z="z-[9999]">
      <div className="flex justify-between items-center p-5 sm:p-6 border-b border-gray-100/80 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-50 rounded-xl">
            <ClipboardCheck size={18} className="text-amber-600" />
          </div>
          <div>
            <h3 id="dialog-title-awaiting-proof" className="font-bold text-lg text-gray-900">Payment proof needed</h3>
            <p className="text-xs text-gray-500">Downpayment still unpaid</p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close payment proof details"
          className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60"
        >
          <X size={20} />
        </button>
      </div>

      <div data-sheet-scroll className="p-5 sm:p-6 space-y-5 flex-1 overflow-y-auto min-h-0 overscroll-contain">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 bg-gray-50 rounded-2xl">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
              <Package size={11} /> Item
            </p>
            <p className="text-sm font-bold text-gray-900 truncate">{itemLabel(booking?.item) || '—'}</p>
          </div>
          <div className="p-3.5 bg-gray-50 rounded-2xl">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
              <Hash size={11} /> Booking
            </p>
            <p className="text-sm font-bold text-gray-900 truncate">#{booking?.txNumber ?? '—'}</p>
          </div>
          <div className="p-3.5 bg-gray-50 rounded-2xl">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
              <Calendar size={11} /> Pickup
            </p>
            <p className="text-sm font-bold text-gray-900 truncate">{fmtDate(booking?.rentalDate)}</p>
          </div>
          <div className="p-3.5 bg-gray-50 rounded-2xl">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
              <Calendar size={11} /> Due
            </p>
            <p className="text-sm font-bold text-gray-900 truncate">{fmtDate(booking?.dueDate)}</p>
          </div>
        </div>

        <div className="bg-white border border-gray-100/80 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] flex items-center justify-center text-sm font-extrabold shrink-0">
              {(customerLabel(booking?.customer) || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Customer</p>
              <p className="font-bold text-gray-900 truncate">{customerLabel(booking?.customer) || '—'}</p>
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
            {booking?.customer?.address ? (
              <p className="flex items-center gap-1.5 text-xs text-gray-500 min-w-0">
                <MapPin size={12} className="text-gray-400 shrink-0" />
                <span className="truncate uppercase">{booking.customer.address}</span>
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
            <AlertTriangle size={14} className="text-amber-600" /> Downpayment
          </p>
          <div className="mt-2 space-y-1 text-xs text-gray-600">
            <p>Due: <span className="font-bold text-gray-900">{peso(downpayment)}</span></p>
            <p>Paid so far: <span className="font-bold text-gray-900">{peso(paid)}</span></p>
            <p>
              Still needed: <span className="font-bold text-[#bf4a53]">{peso(remaining)}</span>
            </p>
          </div>
        </div>

        <div className={`rounded-2xl border p-4 ${rejected ? 'bg-red-50 border-red-200/70' : 'bg-gray-50 border-gray-200/70'}`}>
          <p className={`text-sm font-bold ${rejected ? 'text-red-700' : 'text-gray-800'}`}>
            {rejected ? 'Last proof was rejected' : 'No proof submitted yet'}
          </p>
          <p className="mt-1 text-xs text-gray-600">
            {rejected
              ? <>Rejected {timeAgo(booking?.latestProof?.reviewedAt || booking?.latestProof?.createdAt)}. The customer can re-upload from My Rentals.</>
              : 'The customer needs to upload a screenshot of the transfer from My Rentals before pickup.'}
          </p>
          {rejected && booking?.latestProof?.rejectionReason && (
            <p className="mt-2 text-xs font-medium text-red-600">Reason: {booking.latestProof.rejectionReason}</p>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 text-sm font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-2xl transition-colors"
        >
          Close
        </button>
      </div>
    </BottomSheet>,
    document.body
  );
}
