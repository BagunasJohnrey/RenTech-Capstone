import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ScanLine, X } from 'lucide-react';
import { publicUrlFor } from '../utils/images';

// Staff counter QR panel: the boutique's own payment QR shown to the customer,
// who pays from their own app. The staff member then verifies the transfer in
// person and records it — this panel only displays the QR, it never fetches or
// submits. Mirrors the QR card markup in ManualQrPayment (customer flow).
export default function ManualQrPanel({ qrCodes = [], channel, onChannelChange, note = '' }) {
  const [lightbox, setLightbox] = useState(null);
  const selected = qrCodes.find((q) => q.id === channel) || qrCodes[0] || null;

  if (qrCodes.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
        <ScanLine size={28} className="mx-auto text-amber-500" />
        <p className="mt-2 text-sm font-bold text-gray-900">Payment QR not yet set up</p>
        <p className="mt-1 text-xs text-gray-600">
          Record the payment once the customer has paid, or ask an admin to add the boutique QR in Settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {qrCodes.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {qrCodes.map((qr) => (
            <button key={qr.id} type="button" onClick={() => onChannelChange?.(qr.id)}
              className={`shrink-0 px-4 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                selected?.id === qr.id
                  ? 'border-[#bf4a53] bg-red-50 text-[#bf4a53]'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}>
              {qr.label}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
          <button type="button" onClick={() => setLightbox(selected)}
            className="block mx-auto w-44 h-44 rounded-xl border border-gray-100 overflow-hidden bg-gray-50">
            {selected.imagePath ? (
              <img src={publicUrlFor(selected.imagePath)} alt={`${selected.label} QR code`} className="w-full h-full object-contain" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-gray-100 px-2">
                <ScanLine size={22} className="text-gray-400" />
                <span className="text-[9px] font-semibold text-gray-500 leading-tight">QR image unavailable — ask an admin to re-upload it</span>
              </div>
            )}
          </button>
          <p className="mt-3 text-sm font-bold text-gray-900">{selected.label}</p>
          {selected.accountName && <p className="text-xs text-gray-500">{selected.accountName}</p>}
          <button type="button" onClick={() => setLightbox(selected)}
            className="mt-2 text-xs font-semibold text-[#bf4a53] hover:underline">
            Open full-size QR
          </button>
          <p className="mt-2 text-[11px] text-gray-400 leading-snug">
            Scan or save this QR, then verify the recipient in your payment app before sending.
          </p>
        </div>
      )}

      {note && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200/70 rounded-xl px-3.5 py-2.5 leading-snug">
          {note}
        </p>
      )}

      {lightbox && createPortal(
        <div className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-gray-900">{lightbox.label}</p>
              <button type="button" onClick={() => setLightbox(null)} aria-label="Close QR"
                className="p-2 rounded-xl text-gray-400 hover:bg-gray-100"><X size={18} /></button>
            </div>
            {lightbox.imagePath ? (
              <img src={publicUrlFor(lightbox.imagePath)} alt={`${lightbox.label} QR code full size`}
                className="w-full rounded-2xl border border-gray-100" />
            ) : (
              <div className="w-full aspect-square rounded-2xl border border-gray-100 bg-gray-50 flex flex-col items-center justify-center gap-2">
                <ScanLine size={32} className="text-gray-300" />
                <p className="px-4 text-xs font-semibold text-gray-400">QR image unavailable — ask an admin to re-upload it</p>
              </div>
            )}
            {lightbox.accountName && <p className="mt-2 text-center text-xs text-gray-500">{lightbox.accountName}</p>}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
