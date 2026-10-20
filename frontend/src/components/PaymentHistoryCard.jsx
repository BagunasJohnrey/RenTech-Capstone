import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, History } from 'lucide-react';
import ItemImage from './ItemImage';
import { paymentsService } from '../services/payments';
import { api } from '../utils/api';
import { peso } from '../utils/receipt';

const STATUS_META = {
  pending: { label: 'Under review', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Verified', cls: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-600' },
};

const formatDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Customer-facing history of manual-QR payment proofs: every screenshot they
// submitted with its review outcome (under review / verified / rejected) plus
// the reviewer's reason on rejections. Fetched from the customer-scoped
// /bookings/payment-proofs endpoint, so it can never include another customer's
// proofs. `refreshKey` lets the parent refetch right after a new submission.
export default function PaymentHistoryCard({ refreshKey = 0 }) {
  const [proofs, setProofs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [channelLabels, setChannelLabels] = useState({});

  useEffect(() => {
    let active = true;
    paymentsService.myProofs()
      .then((d) => { if (active) setProofs(Array.isArray(d?.proofs) ? d.proofs : []); })
      .catch(() => { /* keep the last good list; history is non-critical */ })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [refreshKey]);

  // Channel ids (qr-…) -> human labels from the admin QR list. Best effort:
  // an unknown id simply doesn't render rather than showing a raw slug.
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

  if (!loaded || proofs.length === 0) return null;

  const shown = expanded ? proofs : proofs.slice(0, 3);
  const channelLabel = (channel) => {
    if (!channel) return '';
    if (channelLabels[channel]) return channelLabels[channel];
    return /^(demo-)?qr-/.test(channel) ? '' : channel;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
            <History size={15} className="text-[#bf4a53]" /> Payment history
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">Your QR payment proofs and review results</p>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm divide-y divide-gray-100/80">
        {shown.map((p) => {
          const meta = STATUS_META[p.status] || STATUS_META.pending;
          const channel = channelLabel(p.channel);
          const tx = p.transaction;
          return (
            <div key={p.id} className="flex items-center gap-3 p-4">
              <ItemImage
                image={p.imagePath}
                alt="Payment proof"
                eager
                placeholderSize={16}
                className="w-11 h-11 rounded-xl object-cover shrink-0 bg-gray-50 border border-gray-100"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">
                  {tx?.item?.name || 'Booking'}
                  {tx?.txNumber != null && <span className="font-medium text-gray-400"> · #{tx.txNumber}</span>}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  <span className="font-bold text-gray-700">{peso(p.amount)}</span>
                  {channel && <> · {channel}</>}
                  {p.reference && <> · Ref {p.reference}</>}
                </p>
                <p className="text-[11px] text-gray-400 truncate mt-0.5">
                  {p.reviewedAt
                    ? `${p.status === 'rejected' ? 'Reviewed' : 'Verified'} ${formatDate(p.reviewedAt)}`
                    : `Submitted ${formatDate(p.createdAt)}`}
                </p>
                {p.status === 'rejected' && p.rejectionReason && (
                  <p className="text-[11px] text-red-500 font-medium truncate mt-0.5">{p.rejectionReason}</p>
                )}
              </div>
              <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
            </div>
          );
        })}
      </div>
      {proofs.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#bf4a53] hover:underline"
        >
          {expanded ? <><ChevronUp size={13} /> Show less</> : <><ChevronDown size={13} /> Show all {proofs.length}</>}
        </button>
      )}
    </div>
  );
}
