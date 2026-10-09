import { CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';

// Post-send confirmation for manual SMS. The backend reports the real
// provider outcome (`sent` only when Semaphore returned a message_id,
// `queued` otherwise) — this dialog surfaces it honestly instead of the
// old `alert('SMS sent successfully')` that fired on any HTTP 200,
// including queued/dropped sends.
export default function SmsResultModal({ result, onClose }) {
  if (!result) return null;
  const isSent = result.status === 'sent';
  const isQueued = result.status === 'queued';

  const tone = isSent
    ? { ring: 'bg-emerald-50 text-emerald-600', title: 'SMS sent', sub: 'The provider confirmed delivery to the network.' }
    : isQueued
      ? { ring: 'bg-amber-50 text-amber-600', title: 'SMS queued — not confirmed', sub: 'Accepted, but the provider gave no delivery confirmation. Check the SMS Log; retry if it never flips to Sent.' }
      : { ring: 'bg-red-50 text-red-500', title: 'SMS failed to send', sub: result.error || 'The provider rejected the send. Nothing was delivered.' };

  const Icon = isSent ? CheckCircle2 : isQueued ? AlertTriangle : XCircle;

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}>
        <div className="p-6 flex flex-col items-center text-center">
          <span className={`w-14 h-14 rounded-2xl flex items-center justify-center ${tone.ring}`}>
            <Icon size={26} />
          </span>
          <h3 className="font-bold text-lg text-gray-900 mt-3">{tone.title}</h3>
          <p className="text-xs text-gray-500 font-medium mt-1 leading-relaxed">{tone.sub}</p>
          {result.to && (
            <p className="text-xs text-gray-400 font-medium mt-2">
              To: <strong className="text-gray-700">{result.to}</strong>
            </p>
          )}
          {result.message && (
            <div className="w-full mt-3 bg-gray-50 rounded-2xl p-3.5 text-left">
              <p className="text-[13px] text-gray-700 leading-relaxed break-words">{result.message}</p>
            </div>
          )}
          <button onClick={onClose}
            className="mt-5 w-full py-2.5 text-sm font-bold text-white bg-gray-900 hover:bg-gray-700 rounded-full transition-colors">
            Done
          </button>
        </div>
        <button onClick={onClose} aria-label="Close"
          className="absolute top-4 right-4 text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
