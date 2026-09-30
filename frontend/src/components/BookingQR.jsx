import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { getBookingCode } from '../utils/receipt';

// Real, scannable QR for a booking. Uses the server-rendered data URI when the
// backend supplied one (tx.qrCodeDataUri), otherwise generates the image on the
// client. The payload is the booking code (RT-XXXXXXXX); `payload` overrides it
// (e.g. a shareable URL for the customer receipt). `onDataUrl` (optional)
// receives the data URI once it's ready so parents can offer a "save QR"
// download without regenerating the image.
export default function BookingQR({ tx, payload, size = 128, className = '', showCode = true, title, onDataUrl }) {
  const [img, setImg] = useState(null);
  // Depend on the stable booking identity — NOT the tx object, which the
  // parent replaces with a fresh (enriched) copy ~500ms after mount. The old
  // dep regenerated an identical QR on every enrichment (visible flash).
  const code = payload || getBookingCode(tx);
  const serverUri = tx?.qrCodeDataUri;

  useEffect(() => {
    let active = true;
    if (serverUri) {
      setImg(serverUri);
      if (onDataUrl) onDataUrl(serverUri);
      return;
    }
    setImg(null);
    QRCode.toDataURL(code, { width: size * 2, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (active) {
          setImg(url);
          if (onDataUrl) onDataUrl(url);
        }
      })
      .catch(() => { if (active) setImg(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx?.id, serverUri, code, size]);

  if (!tx?.id) return null;

  return (
    <div className={`flex flex-col items-center ${className}`}>
      {img && (
        <img
          src={img}
          alt={`Booking QR code ${code}`}
          title={title}
          width={size}
          height={size}
          className="rounded-xl bg-white p-1"
          draggable={false}
        />
      )}
      {showCode && (
        <p className="mt-2 font-mono text-[11px] font-bold tracking-wide text-gray-500">{code}</p>
      )}
    </div>
  );
}
