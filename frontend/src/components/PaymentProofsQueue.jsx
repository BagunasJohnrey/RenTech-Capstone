import { useState } from 'react';
import { AlertCircle, ChevronRight, ClipboardCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import ItemImage from './ItemImage';
import PaymentProofReviewModal from './PaymentProofReviewModal';
import { Skeleton } from './Skeleton';
import { timeAgo } from './NotificationsDropdown';
import { customerLabel, itemLabel } from '../utils/format';
import { peso } from '../utils/receipt';
import { usePaymentProofs } from '../hooks/usePaymentProofs';

// Staff Tasks queue: manual-QR proofs waiting for a human decision, plus the
// bookings whose customer still owes a proof (staff chase/cancel via the
// existing flows). Always visible at the top of Tasks — "All clear" is a
// meaningful, honest state, not a reason to hide the section.
export default function PaymentProofsQueue({ role }) {
  const enabled = role === 'Staff' || role === 'Admin';
  const { data, loading, error, refresh } = usePaymentProofs(enabled);
  const [tab, setTab] = useState('pending');
  const [reviewProof, setReviewProof] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const pending = data?.pending ?? [];
  const awaiting = data?.awaiting ?? [];
  const counts = data?.counts ?? { pending: pending.length, awaiting: awaiting.length };
  const total = counts.pending + counts.awaiting;
  // No queue has ever loaded — the count is unknown, not zero. Never render a
  // "0" (or "All clear") here: a first-load failure must not look like an
  // empty verification queue.
  const unknown = data == null;
  const loadFailed = !!error && unknown;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-gray-100/50 shadow-sm p-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-2xl bg-[#bf4a53]/10 text-[#bf4a53] flex items-center justify-center shrink-0">
          <ClipboardCheck size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-lg text-gray-900">Payments to verify</h3>
            {unknown ? (
              <Skeleton className="w-[22px] h-5 rounded-full" />
            ) : (
              <span
                className={`inline-flex items-center justify-center text-[10px] font-bold min-w-[22px] h-5 rounded-full px-1.5 ${
                  total > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'
                }`}
              >
                {total}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 font-medium mt-0.5">Manual QR / transfer proofs submitted by customers</p>
        </div>
      </div>

      {!unknown && (
        <div className="inline-flex items-center gap-1 bg-gray-100/80 rounded-2xl px-1.5 py-1.5 mb-4">
          <button
            type="button"
            onClick={() => setTab('pending')}
            aria-pressed={tab === 'pending'}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-colors ${
              tab === 'pending' ? 'bg-[#bf4a53] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Pending ({counts.pending})
          </button>
          <button
            type="button"
            onClick={() => setTab('awaiting')}
            aria-pressed={tab === 'awaiting'}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-colors ${
              tab === 'awaiting' ? 'bg-[#bf4a53] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Awaiting proof ({counts.awaiting})
          </button>
        </div>
      )}

      {loadFailed ? (
        <div className="text-center py-8" role="alert">
          <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-2">
            <AlertCircle size={18} />
          </div>
          <p className="text-sm font-bold text-gray-700">Couldn't load the verification queue</p>
          <p className="text-xs text-gray-400 mt-0.5">Trouble reaching the server — nothing is confirmed either way.</p>
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-[#bf4a53] hover:bg-[#a83f47] rounded-full px-3.5 py-2 transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={12} className={retrying ? 'animate-spin' : ''} />
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : loading ? (
        <div className="space-y-2" aria-label="Loading payment proofs">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-gray-100 rounded-2xl h-16" />
          ))}
        </div>
      ) : tab === 'pending' ? (
        pending.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-2">
              <ShieldCheck size={18} />
            </div>
            <p className="text-sm font-bold text-gray-700">All clear</p>
            <p className="text-xs text-gray-400 mt-0.5">No payments waiting for review.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => {
              const tx = p.transaction;
              const meta = [p.reference, p.channel].filter(Boolean).join(' · ');
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setReviewProof(p)}
                  className="w-full flex items-center gap-3 p-3 bg-amber-50/60 rounded-2xl border border-amber-100/60 text-left transition-all hover:shadow-sm hover:scale-[1.005]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900 truncate">{customerLabel(tx?.customer) || 'Customer'}</p>
                    <p className="text-xs text-gray-600 truncate">
                      {itemLabel(tx?.item) || 'Booking'} · #{tx?.txNumber ?? '—'}
                    </p>
                    <p className="text-[11px] text-gray-500 truncate mt-0.5">
                      <span className="font-bold text-amber-700">{peso(p.amount)} claimed</span>
                      {meta && <> · {meta}</>} · {timeAgo(p.createdAt)}
                    </p>
                  </div>
                  <ItemImage
                    image={p.imagePath}
                    alt=""
                    thumb
                    placeholderSize={18}
                    className="w-12 h-12 rounded-xl object-cover shrink-0 bg-white border border-amber-100"
                  />
                  <ChevronRight size={16} className="text-gray-300 shrink-0" />
                </button>
              );
            })}
          </div>
        )
      ) : awaiting.length === 0 ? (
        <div className="text-center py-8">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-2">
            <ShieldCheck size={18} />
          </div>
          <p className="text-sm font-bold text-gray-700">All clear</p>
          <p className="text-xs text-gray-400 mt-0.5">No bookings are waiting on a payment proof.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {awaiting.map((t) => (
            <div key={t.id} className="flex items-center gap-3 p-3 bg-gray-50/80 rounded-2xl border border-gray-100/60">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-gray-900 truncate">{customerLabel(t.customer) || 'Customer'}</p>
                <p className="text-xs text-gray-600 truncate">
                  {itemLabel(t.item) || 'Booking'} · #{t.txNumber ?? '—'} · {peso(t.downpayment)} downpayment
                </p>
                {t.latestProof?.rejectionReason && (
                  <p className="text-[11px] font-medium text-red-500 truncate mt-0.5">Rejected: {t.latestProof.rejectionReason}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {reviewProof && (
        <PaymentProofReviewModal
          proof={reviewProof}
          onClose={() => setReviewProof(null)}
          onDone={() => { setReviewProof(null); refresh(); }}
        />
      )}
    </div>
  );
}
