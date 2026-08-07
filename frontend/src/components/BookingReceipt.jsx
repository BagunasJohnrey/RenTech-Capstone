import { useState } from 'react';
import { Download } from 'lucide-react';
import BookingQR from './BookingQR';
import { txRentalFee, txDownpayment, txBalance, getBookingCode, peso } from '../utils/receipt';
import { useFeatureFlags } from '../hooks/useFeatureFlags';

// Shared booking receipt — used by the customer flow, the staff rental flow,
// and (read-only) the transaction detail modal. A compact header, a detail
// list, and (optionally) a scannable QR. `qrPayload` defaults to the booking
// code; pass a shareable URL to deep-link scanners.

function Row({ label, value, className = '' }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={className}>{value}</span>
    </div>
  );
}

export default function BookingReceipt({ tx, qrPayload, showQR = true, title }) {
  const flags = useFeatureFlags();
  // Data URI of the rendered QR — offered as a "Save QR" download.
  const [qrSaveUrl, setQrSaveUrl] = useState(null);
  if (!tx) return null;

  const fee = txRentalFee(tx);
  const down = txDownpayment(tx);
  const balance = txBalance(tx);
  const promoDiscount = Math.max(0, fee - down - balance);
  const customerName = tx.customer?.name ?? tx.customer ?? '—';
  const itemName = tx.item?.name ?? tx.item ?? '';
  const size = tx.size;
  const qrOn = showQR && flags.qr_codes;

  return (
    <div className="bg-white border border-gray-100/80 rounded-2xl p-5 space-y-2.5 text-sm shadow-sm">
      {title && <p className="font-bold text-gray-900 text-base">{title}</p>}
      {itemName && <p className="font-bold text-gray-900 text-base mb-2">{itemName}</p>}
      <div className="space-y-2">
        <Row label="Customer" value={customerName} className="font-semibold" />
        <Row label="Size" value={size} />
        <Row label="Total" value={peso(fee)} className="font-semibold" />
        {promoDiscount > 0 && <Row label="Promo discount" value={`−${peso(promoDiscount)}`} className="text-emerald-600 font-semibold" />}
        <Row label="Downpayment" value={peso(down)} className="text-[#bf4a53] font-bold" />
        <Row label="Balance" value={peso(balance)} className="font-bold" />
      </div>
      <div className="border-t border-gray-100 pt-2.5 mt-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Transaction ID</p>
          <p className="font-mono text-[11px] text-gray-500 break-all">{tx.id}</p>
        </div>
        {qrOn && (
          <div className="shrink-0 text-center">
            <BookingQR tx={tx} payload={qrPayload} size={84} showCode={false} title="Scan to open this booking" onDataUrl={setQrSaveUrl} />
            <p className="mt-1 font-mono text-[10px] font-bold text-gray-400">{getBookingCode(tx)}</p>
            {qrSaveUrl && (
              <a
                href={qrSaveUrl}
                download={`${getBookingCode(tx)}.png`}
                className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-[#bf4a53] hover:underline"
                title="Download a copy of this QR code">
                <Download size={11} /> Save QR
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}