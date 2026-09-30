import { useState } from 'react';
import { ShieldCheck, Loader2, X } from 'lucide-react';
import { api } from '../utils/api';

// In-session MFA step-up prompt. Opens automatically when any request 403s
// with code mfa_challenge_required (see api.js broadcast): the admin re-enters
// an authenticator code (or a backup code) for the CURRENT session — no sign
// out / sign back in needed. On success the server mints a fresh
// rt_mfa_verified marker and we broadcast rentech:mfa-verified so the tab
// that failed can retry.
export default function MfaStepUpModal({ onClose, onVerified }) {
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!code.trim() || loading) return;
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/mfa/step-up', { code: code.trim(), trustDevice });
      window.dispatchEvent(new CustomEvent('rentech:mfa-verified'));
      onVerified?.();
    } catch (err) {
      setError(err?.message || 'Invalid code — try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Verify it's you">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <span className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <ShieldCheck size={20} />
          </span>
          <button onClick={onClose} aria-label="Close verification prompt" className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
            <X size={16} />
          </button>
        </div>
        <div>
          <h2 className="text-lg font-extrabold text-gray-900">Verify it&rsquo;s you</h2>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">
            Your session lost its two-factor verification (this happens when your sign-in expires in the background).
            Enter a code from your authenticator app — or one of your backup codes — to continue. No need to sign out.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.slice(0, 32))}
            placeholder="6-digit code or backup code"
            autoComplete="one-time-code"
            autoFocus
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
          />
          {error && <p className="text-red-500 text-xs font-semibold text-center">{error}</p>}
          <label className="flex items-start gap-2 text-xs text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#bf4a53] focus:ring-[#bf4a53]"
            />
            <span>Trust this device for 30 days — skip this prompt after background sign-in renewals.</span>
          </label>
          <button
            type="submit"
            disabled={!code.trim() || loading}
            className="w-full py-3 bg-gray-900 text-white font-bold text-sm rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      </div>
    </div>
  );
}
