import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, CheckCircle, MapPin, MailWarning } from 'lucide-react';
import { api } from '../utils/api';
import { PASSWORD_REQUIREMENTS } from '../components/Login';
import { useToast } from '../components/Toast';

// Reset-password landing page. Brevo links land here with our own single-use
// ?token= (preferred). Legacy Supabase links deliver the recovery credential
// in one of three shapes (see backend resetPasswordSchema):
//   - token_hash:   custom email template linking straight here (? or #)
//   - code:         default template — Supabase's /verify consumed the token
//                   and redirected here with ?code=
//   - access_token: legacy implicit flow — /verify redirected with
//                   #access_token= in the URL hash
// Read all of them from both the query string and the hash. When no
// credential is present (or the backend rejects it as invalid/expired),
// show a resend card instead of a dead-end error.
function readCredential(search, hash) {
  const q = new URLSearchParams(search);
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  if (q.get('token') || h.get('token')) {
    return { token: q.get('token') || h.get('token') };
  }
  if (q.get('token_hash') || h.get('token_hash')) {
    return { token_hash: q.get('token_hash') || h.get('token_hash') };
  }
  if (q.get('code') || h.get('code')) {
    return { code: q.get('code') || h.get('code') };
  }
  if (h.get('access_token') || q.get('access_token')) {
    return { access_token: h.get('access_token') || q.get('access_token') };
  }
  return null;
}

const isLinkError = (err) =>
  err?.status === 401 || /invalid|expir|already been used|required/i.test(err?.message || '');

// A wrong old-password guess is NOT a dead link — the server verifies the old
// password before consuming the single-use token, so the form stays alive.
const isWrongPasswordError = (err) =>
  /current password/i.test(err?.message || '');

export default function ForgotPasswordView() {
  const navigate = useNavigate();
  const location = useLocation();
  const { error: toastError, success: toastSuccess } = useToast();
  const credential = readCredential(location.search, location.hash);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  // Inline (non-toast) error kept on the form — used when the old-password
  // confirmation fails so the user can correct it without losing the link.
  const [formError, setFormError] = useState('');
  // Invalid/expired link state — offers a resend instead of a dead end.
  // The address typed on the login forgot-step is remembered per-tab, so a
  // resend is one click; otherwise (e.g. link opened on another device) the
  // user types it here.
  const [linkDead, setLinkDead] = useState(!credential);
  const [resendEmail, setResendEmail] = useState(() => {
    try { return sessionStorage.getItem('rentech_reset_email') || ''; } catch { return ''; }
  });
  const [editEmail, setEditEmail] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!credential) {
      setLinkDead(true);
      return;
    }
    if (password !== confirm) {
      toastError('Passwords do not match');
      return;
    }
    const allMet = PASSWORD_REQUIREMENTS.every((req) => req.test(password));
    if (!allMet) {
      toastError('Password does not meet all requirements');
      return;
    }
    setLoading(true);
    try {
      // The old password is sent only when the user typed one — the backend
      // verifies it WITHOUT consuming the link, so a typo is recoverable.
      await api.post('/auth/reset-password', {
        ...credential,
        ...(currentPassword ? { currentPassword } : {}),
        password,
      });
      try { sessionStorage.removeItem('rentech_reset_email'); } catch { /* private mode */ }
      toastSuccess('Password reset successfully');
      navigate('/');
    } catch (err) {
      if (isWrongPasswordError(err)) {
        // The link is still valid (the server checks the old password before
        // consuming the token) — stay on the form so they can fix the typo.
        setFormError(err?.message || 'Current password is incorrect');
      } else if (isLinkError(err)) {
        setLinkDead(true);
      } else {
        toastError(err?.message || 'Failed to reset password');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendSubmit = async (e) => {
    e.preventDefault();
    setResendLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: resendEmail });
      setResendSent(true);
    } catch (err) {
      toastError(err?.message || 'Failed to send reset link');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fafbfc] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          {linkDead ? (
            <MailWarning size={40} className="mx-auto text-[#bf4a53] mb-2" />
          ) : (
            <ShieldCheck size={40} className="mx-auto text-[#bf4a53] mb-2" />
          )}
          <h1 className="text-2xl font-bold text-gray-900">
            {linkDead ? 'Link Invalid or Expired' : 'Reset Password'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {linkDead
              ? 'Reset links expire after about an hour and work only once. Request a fresh one below.'
              : 'Enter your new password below.'}
          </p>
        </div>

        {linkDead ? (
          <form onSubmit={handleResendSubmit} className="space-y-4 bg-white rounded-2xl border border-gray-100 p-6 sm:p-8 shadow-sm">
            {!resendSent ? (
              <>
                {resendEmail && !editEmail ? (
                  <p className="text-sm text-gray-600 text-center">
                    Send a fresh link to<br />
                    <span className="font-semibold text-gray-900">{resendEmail}</span>?
                  </p>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Email</label>
                    <input
                      type="email"
                      value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#bf4a53]/30 focus:border-[#bf4a53]"
                      required
                    />
                  </div>
                )}
                <button
                  type="submit"
                  disabled={resendLoading || !resendEmail}
                  className="w-full py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {resendLoading ? 'Sending...' : 'Send a New Reset Link'}
                </button>
                {resendEmail && !editEmail && (
                  <button
                    type="button"
                    onClick={() => setEditEmail(true)}
                    className="text-xs text-center text-gray-400 hover:text-gray-600 font-medium w-full"
                  >
                    Use a different address
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-600 text-center">
                If <span className="font-semibold text-gray-900">{resendEmail}</span> is registered,
                a fresh reset link is on its way. Check your inbox (and spam folder).
              </p>
            )}
          </form>
        ) : (
          <form onSubmit={handleResetSubmit} className="space-y-4 bg-white rounded-2xl border border-gray-100 p-6 sm:p-8 shadow-sm">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => { setCurrentPassword(e.target.value); if (formError) setFormError(''); }}
                placeholder="Your current password"
                autoComplete="current-password"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#bf4a53]/30 focus:border-[#bf4a53]"
              />
              <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                Confirm the password you use now — <span className="font-semibold text-gray-500">leave blank if you've forgotten it</span>; your email link already confirms it's you.
              </p>
            </div>
            {formError && (
              <p className="text-xs text-red-500 font-semibold bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">{formError}</p>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#bf4a53]/30 focus:border-[#bf4a53]"
                required
                minLength={12}
              />
            </div>
            <div className="space-y-1.5 mb-2">
              {PASSWORD_REQUIREMENTS.map((req) => {
                const met = req.test(password || '');
                return (
                  <div key={req.label} className="flex items-center gap-2">
                    <CheckCircle size={12} className={met ? 'text-emerald-500' : 'text-gray-300'} />
                    <span className={`text-xs ${met ? 'text-emerald-600' : 'text-gray-400'}`}>{req.label}</span>
                  </div>
                );
              })}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••••"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#bf4a53]/30 focus:border-[#bf4a53]"
                required
                minLength={12}
              />
            </div>
            {password !== confirm && password.length >= 12 && (
              <p className="text-xs text-red-500">Passwords do not match</p>
            )}
            <button
              type="submit"
              disabled={loading || password !== confirm || !PASSWORD_REQUIREMENTS.every((r) => r.test(password))}
              className="w-full py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        )}

        <button
          onClick={() => navigate('/?forgot=1')}
          className="text-sm text-center text-gray-400 hover:text-gray-600 font-medium w-full"
        >
          Back to sign in
        </button>

        <p className="text-center text-[11px] text-gray-300 flex items-center justify-center gap-1">
          <MapPin size={10} /> Balayan, Batangas
        </p>
      </div>
    </div>
  );
}
