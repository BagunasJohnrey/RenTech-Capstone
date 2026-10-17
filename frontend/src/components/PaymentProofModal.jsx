import { useEffect, useState } from 'react';
import { X, Loader2, Clock } from 'lucide-react';
import ManualQrPayment from './ManualQrPayment';
import { api } from '../utils/api';
import { downscaleToJpeg } from '../utils/file';
import { submitProof } from '../services/payments';

// Resume an abandoned/rejected manual payment from My Rentals. The booking
// already exists; this only uploads a fresh proof.
export default function PaymentProofModal({ tx, onClose, onSubmitted }) {
  const [qrCodes, setQrCodes] = useState([]);
  const [storeContact, setStoreContact] = useState('');
  const [channel, setChannel] = useState('');
  const [reference, setReference] = useState('');
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/settings/rental-defaults')
      .then((d) => {
        if (!active) return;
        const codes = Array.isArray(d?.manual_qr_codes) ? d.manual_qr_codes : [];
        setQrCodes(codes);
        setStoreContact(d?.store_contact || '');
        if (codes[0]) setChannel(codes[0].id);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const handleSubmit = async () => {
    if (!file) { setError('Please upload your payment screenshot.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Screenshot must be 5 MB or smaller.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const data = await downscaleToJpeg(file, 1280, 0.85);
      if (!data) throw new Error('Could not read that image — try another screenshot.');
      await submitProof(tx.id, {
        data, contentType: 'image/jpeg',
        reference: reference.trim() || undefined,
        channel: channel || undefined,
      });
      onSubmitted?.();
      onClose();
    } catch (err) {
      setError(err?.message || 'Upload failed — please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100/80">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Upload payment proof</h2>
            <p className="text-xs text-gray-500 mt-0.5">Booking #{(tx.txNumber ?? '')} — under review until verified.</p>
          </div>
          <button onClick={onClose} aria-label="Close payment proof" className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <ManualQrPayment
            qrCodes={qrCodes}
            channel={channel} onChannelChange={setChannel}
            reference={reference} onReferenceChange={setReference}
            file={file} onFileChange={setFile}
            disabled={submitting}
            storeContact={storeContact}
          />
          {error && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <Clock size={15} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-red-700">{error}</p>
            </div>
          )}
          <button onClick={handleSubmit} disabled={submitting}
            className="w-full py-3.5 rounded-2xl bg-[#bf4a53] text-white text-sm font-bold shadow-sm hover:bg-[#a83f47] disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
            {submitting ? (<><Loader2 size={16} className="animate-spin" /> Submitting…</>) : 'Submit for review'}
          </button>
        </div>
      </div>
    </div>
  );
}
