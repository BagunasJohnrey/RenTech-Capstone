import { useEffect, useState } from 'react';
import { AlertCircle, ChevronRight, ClipboardCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import ItemImage from './ItemImage';
import PaymentProofReviewModal from './PaymentProofReviewModal';
import AwaitingProofModal from './AwaitingProofModal';
import { Skeleton } from './Skeleton';
import { timeAgo } from './NotificationsDropdown';
import { customerLabel, itemLabel } from '../utils/format';
import { peso } from '../utils/receipt';
import { usePaymentProofs } from '../hooks/usePaymentProofs';
import { api } from '../utils/api';

const fmtDateTime = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// Staff Tasks queue: manual-QR proofs waiting for a human decision, plus the
// bookings whose customer still owes a proof (staff chase/cancel via the
// existing flows). Always visible at the top of Tasks — "All clear" is a
// meaningful, honest state, not a reason to hide the section.
export default function PaymentProofsQueue({ role, onChanged }) {
  const enabled = role === 'Staff' || role === 'Admin';
  const { data, loading, error, refresh } = usePaymentProofs(enabled);
  const [tab, setTab] = useState('attention');
  const [reviewProof, setReviewProof] = useState(null);
  const [awaitingBooking, setAwaitingBooking] = useState(null);
  const [retrying, setRetrying] = useState(false);
  // Channel ids (qr-…) are meaningless to staff — map them to the admin's
  // labels (GCash, Instapay, …) for the history log.
  const [channelLabels, setChannelLabels] = useState({});
  useEffect(() => {
    let active = true;
    api.get('/settings/rental-defaults')
      .then((d) => {
        if (!active) return;
        const codes = Array.isArray(d?.manual_qr_codes) ? d.manual_qr_codes : [];
        setChannelLabels(Object.fromEntries(codes.map((c) => [c.id, c.label])));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  const channelLabel = (channel) => {
    if (!channel) return '';
    if (channelLabels[channel]) return channelLabels[channel];
    // Unknown qr-… id: hide it rather than leaking an internal slug.
    return /^(demo-)?qr-/.test(channel) ? '' : channel;
  };

  const pending = data?.pending ?? [];
  const awaiting = data?.awaiting ?? [];
  const reviewed = data?.reviewed ?? [];
  const counts = data?.counts ?? { pending: pending.length, awaiting: awaiting.length, reviewed: reviewed.length };
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
          <p className="text-xs text-gray-500 font-medium mt-0.5">Manual QR proofs to verify, plus unpaid bookings still waiting on one</p>
        </div>
      </div>

      {!unknown && (
        <div className="inline-flex flex-wrap items-center gap-1 bg-gray-100/80 rounded-2xl px-1.5 py-1.5 mb-4">
          <button
            type="button"
            onClick={() => setTab('attention')}
            aria-pressed={tab === 'attention'}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-colors ${
              tab === 'attention' ? 'bg-[#bf4a53] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Needs attention ({total})
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            aria-pressed={tab === 'history'}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-colors ${
              tab === 'history' ? 'bg-[#bf4a53] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            History ({counts.reviewed})
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
      ) : tab === 'attention' ? (
        pending.length === 0 && awaiting.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-2">
              <ShieldCheck size={18} />
            </div>
            <p className="text-sm font-bold text-gray-700">All clear</p>
            <p className="text-xs text-gray-400 mt-0.5">No proofs to verify and no bookings waiting on one.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => {
              const tx = p.transaction;
              const meta = [p.reference, channelLabel(p.channel)].filter(Boolean).join(' · ');
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
            {awaiting.length > 0 && (
              <div className="pt-1 space-y-2">
                {pending.length > 0 && (
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 px-1 pt-1">
                    Waiting on customers
                  </p>
                )}
                {awaiting.map((t) => {
                  const rejected = t.latestProof?.status === 'rejected';
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setAwaitingBooking(t)}
                      title="View payment proof details"
                      className="w-full text-left flex items-center gap-3 p-3 bg-gray-50/80 rounded-2xl border border-gray-100/60 transition-all cursor-pointer hover:shadow-sm hover:scale-[1.005]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-sm font-bold text-gray-900 truncate">{customerLabel(t.customer) || 'Customer'}</p>
                          <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                            rejected ? 'bg-red-100 text-red-600' : 'bg-gray-200/80 text-gray-600'
                          }`}>
                            {rejected ? 'Resubmit needed' : 'No proof yet'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 truncate">
                          {itemLabel(t.item) || 'Booking'} · #{t.txNumber ?? '—'}
                        </p>
                        <p className="text-[11px] text-gray-500 truncate mt-0.5">
                          <span className="font-bold text-gray-900">{peso(t.downpayment)}</span> downpayment due
                          {' · '}{peso(t.totalPaid)} paid
                          {rejected && (t.latestProof?.reviewedAt || t.latestProof?.createdAt) && (
                            <> · rejected {timeAgo(t.latestProof.reviewedAt || t.latestProof.createdAt)}</>
                          )}
                        </p>
                        {rejected && t.latestProof?.rejectionReason && (
                          <p className="text-[11px] font-medium text-red-500 truncate mt-0.5">Reason: {t.latestProof.rejectionReason}</p>
                        )}
                      </div>
                      <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold text-[#bf4a53]">
                        View <ChevronRight size={13} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )
      ) : (
        reviewed.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-10 h-10 rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-2">
              <ShieldCheck size={18} />
            </div>
            <p className="text-sm font-bold text-gray-700">No reviews yet</p>
            <p className="text-xs text-gray-400 mt-0.5">Approved and rejected proofs will be listed here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {reviewed.map((p) => {
              const tx = p.transaction;
              const approved = p.status === 'approved';
              const channel = channelLabel(p.channel);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setReviewProof(p)}
                  title="View payment proof"
                  className="w-full flex items-start gap-3 p-3.5 bg-white rounded-2xl border border-gray-100/80 shadow-[0_1px_2px_rgba(0,0,0,0.02)] text-left transition-all hover:shadow-sm hover:border-gray-200"
                >
                  <span className="w-11 h-11 rounded-xl overflow-hidden bg-gray-50 border border-gray-100 shrink-0">
                    <ItemImage image={p.imagePath} alt="Payment proof" thumb placeholderSize={16} className="w-full h-full object-cover" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">{customerLabel(tx?.customer) || 'Customer'}</p>
                        <p className="text-xs text-gray-600 truncate">
                          {itemLabel(tx?.item) || 'Booking'} · #{tx?.txNumber ?? '—'}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        approved ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                      }`}>
                        {approved ? 'Verified' : 'Rejected'}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500 flex flex-wrap items-center gap-x-1.5">
                      <span className="font-bold text-gray-900">{peso(p.amount)}</span>
                      <span>{approved ? 'credited' : 'claimed'}</span>
                      {channel && <span>· {channel}</span>}
                      {p.reference && <span>· Ref {p.reference}</span>}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {approved ? 'Verified' : 'Rejected'} {fmtDateTime(p.reviewedAt || p.createdAt)}
                      {p.reviewedBy?.name && <> · by {p.reviewedBy.name}</>}
                    </p>
                    {p.status === 'rejected' && p.rejectionReason && (
                      <p className="text-[11px] font-medium text-red-500 mt-1">Reason: {p.rejectionReason}</p>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1" />
                </button>
              );
            })}
          </div>
        )
      )}

      {reviewProof && (
        <PaymentProofReviewModal
          proof={reviewProof}
          onClose={() => setReviewProof(null)}
          onDone={() => { setReviewProof(null); refresh(); onChanged?.(); }}
        />
      )}

      {awaitingBooking && (
        <AwaitingProofModal
          booking={awaitingBooking}
          onClose={() => setAwaitingBooking(null)}
        />
      )}
    </div>
  );
}
