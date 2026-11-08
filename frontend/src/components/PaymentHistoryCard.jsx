import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronRight, History, X, Upload, AlertTriangle, Clock, CheckCircle2, Maximize2 } from 'lucide-react';
import ItemImage from './ItemImage';
import BottomSheet from './BottomSheet';
import PhotoViewer from './PhotoViewer';
import PaymentProofModal from './PaymentProofModal';
import { paymentsService } from '../services/payments';
import { api } from '../utils/api';
import { peso } from '../utils/receipt';
import { rowActivation, ROW_FOCUS } from '../utils/a11y';

const STATUS_META = {
  pending: { label: 'Under review', cls: 'bg-amber-100 text-amber-700', Icon: Clock, box: 'border-amber-200 bg-amber-50 text-amber-800' },
  approved: { label: 'Verified', cls: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle2, box: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-600', Icon: AlertTriangle, box: 'border-red-200 bg-red-50 text-red-700' },
};

const formatDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// A rejected proof can be re-uploaded only while it is still the newest proof
// for its booking (no later submission pending/approved) and the booking is open.
function canReupload(proof, all) {
  if (proof.status !== 'rejected') return false;
  const txId = proof.transaction?.id;
  if (!txId) return false;
  if (['Cancelled', 'Returned'].includes(proof.transaction?.status)) return false;
  const newest = all.find((p) => p.transaction?.id === txId); // list is newest-first
  return newest?.id === proof.id;
}

// Customer-facing history of manual-QR payment proofs: every screenshot they
// submitted with its review outcome (under review / verified / rejected) plus
// the reviewer's reason on rejections. Each row opens a detail sheet with the
// full screenshot; rejected proofs offer "Re-upload payment proof".
// `refreshKey` lets the parent refetch right after a new submission.
export default function PaymentHistoryCard({ refreshKey = 0, onSubmitted }) {
  const [proofs, setProofs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [channelLabels, setChannelLabels] = useState({});
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(false);
  const [uploadTx, setUploadTx] = useState(null);
  const [localKey, setLocalKey] = useState(0);

  useEffect(() => {
    let active = true;
    paymentsService.myProofs()
      .then((d) => { if (active) setProofs(Array.isArray(d?.proofs) ? d.proofs : []); })
      .catch(() => { /* keep the last good list; history is non-critical */ })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [refreshKey, localKey]);

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
  const startUpload = (p) => {
    setSelected(null);
    setUploadTx({ id: p.transaction.id, txNumber: p.transaction.txNumber });
  };

  const sel = selected;
  const selMeta = sel ? (STATUS_META[sel.status] || STATUS_META.pending) : null;
  const selChannel = sel ? channelLabel(sel.channel) : '';

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
            <History size={15} className="text-[#bf4a53]" /> Payment history
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">Your QR payment proofs and review results — tap one for details</p>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm divide-y divide-gray-100/80 overflow-hidden">
        {shown.map((p) => {
          const meta = STATUS_META[p.status] || STATUS_META.pending;
          const channel = channelLabel(p.channel);
          const tx = p.transaction;
          const reupload = canReupload(p, proofs);
          return (
            <div
              key={p.id}
              {...rowActivation(() => setSelected(p))}
              aria-label={`Payment proof for ${tx?.item?.name || 'booking'}, ${meta.label}`}
              className={`flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition-colors ${ROW_FOCUS}`}
            >
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
                  <p className="text-[11px] text-red-500 font-medium truncate mt-0.5">Reason: {p.rejectionReason}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                {!reupload && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                )}
                {reupload && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); startUpload(p); }}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-[#bf4a53] hover:bg-[#a83f47] px-2.5 py-1 rounded-full transition-colors"
                  >
                    <Upload size={11} /> Re-upload
                  </button>
                )}
              </div>
              <ChevronRight size={16} className="text-gray-300 shrink-0" aria-hidden="true" />
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

      {sel && (
        <BottomSheet onClose={() => setSelected(null)} labelledby="dialog-title-proof-detail" z="z-[210]" maxWidth="sm:max-w-lg" panelWidth="md:w-[560px]">
          <div data-sheet-scroll className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between p-5 border-b border-gray-100/80">
              <div className="min-w-0">
                <h2 id="dialog-title-proof-detail" className="text-lg font-bold text-gray-900 truncate">Payment proof</h2>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {sel.transaction?.item?.name || 'Booking'}{sel.transaction?.txNumber != null && ` · Booking #${sel.transaction.txNumber}`}
                </p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close payment proof" className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className={`rounded-2xl border p-4 flex items-start gap-3 ${selMeta.box}`}>
                <selMeta.Icon size={18} className="shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-bold">
                    {sel.status === 'rejected' ? 'Payment proof rejected' : sel.status === 'approved' ? 'Payment verified' : 'Payment under review'}
                  </p>
                  {sel.status === 'rejected' && sel.rejectionReason && (
                    <p className="text-xs mt-0.5 break-words">Reason: <span className="font-semibold">{sel.rejectionReason}</span></p>
                  )}
                  {sel.status === 'pending' && <p className="text-xs mt-0.5">Staff are checking your screenshot. You'll be notified once it's verified.</p>}
                  {sel.status === 'approved' && <p className="text-xs mt-0.5">Your payment was credited to this booking.</p>}
                </div>
              </div>

              {sel.imagePath && (
              <button
                type="button"
                onClick={() => setZoom(true)}
                className="relative block w-full rounded-2xl overflow-hidden border border-gray-100 bg-gray-50 group"
                aria-label="View payment screenshot full size"
              >
                <ItemImage image={sel.imagePath} alt="Payment screenshot" eager className="w-full max-h-[340px] object-contain bg-gray-50" />
                <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 text-[10px] font-bold bg-black/60 text-white px-2 py-1 rounded-full">
                  <Maximize2 size={11} /> Tap to zoom
                </span>
              </button>
              )}

              <dl className="bg-white border border-gray-100/80 rounded-2xl divide-y divide-gray-100 text-sm">
                {[
                  ['Amount', peso(sel.amount)],
                  ['Channel', selChannel || '—'],
                  ['Reference', sel.reference || '—'],
                  ['Submitted', formatDate(sel.createdAt)],
                  sel.reviewedAt && [sel.status === 'rejected' ? 'Reviewed' : 'Verified', formatDate(sel.reviewedAt)],
                ].filter(Boolean).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between px-4 py-2.5">
                    <dt className="text-gray-500">{k}</dt>
                    <dd className="font-bold text-gray-900 text-right break-all">{v}</dd>
                  </div>
                ))}
              </dl>

              {canReupload(sel, proofs) && (
                <button
                  type="button"
                  onClick={() => startUpload(sel)}
                  className="w-full py-3.5 rounded-2xl bg-[#bf4a53] text-white text-sm font-bold shadow-sm hover:bg-[#a83f47] transition-colors flex items-center justify-center gap-2"
                >
                  <Upload size={16} /> Re-upload payment proof
                </button>
              )}
            </div>
          </div>
        </BottomSheet>
      )}

      {sel && zoom && sel.imagePath && (
        <PhotoViewer
          photos={[{ image: sel.imagePath, label: 'Payment screenshot', alt: 'Payment screenshot' }]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setZoom(false)}
        />
      )}

      {uploadTx && (
        <PaymentProofModal
          tx={uploadTx}
          z="z-[220]"
          onClose={() => setUploadTx(null)}
          onSubmitted={() => { setLocalKey((k) => k + 1); onSubmitted?.(); }}
        />
      )}
    </div>
  );
}
