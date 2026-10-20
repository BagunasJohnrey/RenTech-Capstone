import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ScanLine, X, Upload } from 'lucide-react';
import { publicUrlFor } from '../utils/images';

// Shared customer-facing QR panel (booking flow step 2 + My Rentals resume).
export default function ManualQrPayment({
  qrCodes = [],
  channel, onChannelChange,
  reference, onReferenceChange,
  file, onFileChange,
  disabled = false,
  storeContact = '',
}) {
  const [lightbox, setLightbox] = useState(null);
  const [preview, setPreview] = useState(null);
  const selected = qrCodes.find((q) => q.id === channel) || qrCodes[0] || null;

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (qrCodes.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
        <ScanLine size={28} className="mx-auto text-amber-500" />
        <p className="mt-2 text-sm font-bold text-gray-900">Payment QR not yet set up</p>
        <p className="mt-1 text-xs text-gray-600">
          Please contact the boutique{storeContact ? ` at ${storeContact}` : ''} to complete your downpayment.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {qrCodes.length > 1 && (
        <div>
          <label htmlFor="qr-channel" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
            Payment channel
          </label>
          <select
            id="qr-channel"
            value={selected?.id || ''}
            disabled={disabled}
            onChange={(e) => onChannelChange(e.target.value)}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] transition-colors disabled:opacity-60"
          >
            {qrCodes.map((qr) => (
              <option key={qr.id} value={qr.id}>{qr.label}</option>
            ))}
          </select>
        </div>
      )}

      {selected && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
          <button type="button" onClick={() => setLightbox(selected)} disabled={disabled}
            className="block mx-auto w-44 h-44 rounded-xl border border-gray-100 overflow-hidden bg-gray-50">
            {selected.imagePath ? (
              <img src={publicUrlFor(selected.imagePath)} alt={`${selected.label} QR code`} className="w-full h-full object-contain" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-gray-100 px-2">
                <ScanLine size={22} className="text-gray-400" />
                <span className="text-[9px] font-semibold text-gray-500 leading-tight">QR image unavailable — contact the boutique</span>
              </div>
            )}
          </button>
          <p className="mt-3 text-sm font-bold text-gray-900">{selected.label}</p>
          {selected.accountName && <p className="text-xs text-gray-500">{selected.accountName}</p>}
          <button type="button" onClick={() => setLightbox(selected)} disabled={disabled}
            className="mt-2 text-xs font-semibold text-[#bf4a53] hover:underline">
            Open full-size QR ↗
          </button>
          <p className="mt-2 text-[11px] text-gray-400 leading-snug">
            Scan or save this QR, then verify the recipient in your payment app before sending.
          </p>
        </div>
      )}

      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
          Transaction or reference number <span className="font-medium normal-case">(optional)</span>
        </label>
        <input type="text" value={reference} maxLength={40} disabled={disabled}
          onChange={(e) => onReferenceChange(e.target.value)}
          placeholder="e.g. 000123456789"
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-900 placeholder-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] transition-colors" />
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Payment screenshot</label>
        {file ? (
          <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-2xl p-3">
            <img src={preview} alt="Payment screenshot preview" className="w-14 h-14 rounded-xl object-cover border border-gray-100" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{file.name}</p>
              <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
            <button type="button" onClick={() => onFileChange(null)} disabled={disabled} aria-label="Remove screenshot"
              className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <X size={16} />
            </button>
          </div>
        ) : (
          <label className={`flex flex-col items-center justify-center gap-1.5 w-full px-4 py-5 text-center rounded-2xl border-2 border-dashed cursor-pointer transition-colors ${
            disabled ? 'border-gray-200 text-gray-300' : 'border-gray-300 text-gray-500 hover:border-[#bf4a53] hover:text-[#bf4a53]'
          }`}>
            <Upload size={22} />
            <span className="text-sm font-bold">Upload screenshot</span>
            <span className="text-[11px] font-medium text-gray-400">PNG, JPG or WebP · max 5 MB</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={disabled}
              onChange={(e) => onFileChange(e.target.files?.[0] || null)} />
          </label>
        )}
      </div>

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
                <p className="px-4 text-xs font-semibold text-gray-400">QR image unavailable — contact the boutique</p>
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
