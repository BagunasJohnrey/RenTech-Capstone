import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, CheckCircle, MapPin } from 'lucide-react';
import { api } from '../utils/api';
import { PASSWORD_REQUIREMENTS } from '../components/Login';
import { useToast } from '../components/Toast';

// Reset-password landing page. Only reachable from the recovery email/action
// link, which carries a token_hash in either the query string or URL hash
// depending on the Supabase auth flow type — read both so the form always
// opens. The "request a reset link" step lives inline in <Login />.
export default function ForgotPasswordView() {
  const navigate = useNavigate();
  const location = useLocation();
  const { error: toastError, success: toastSuccess } = useToast();
  const searchParams = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const tokenHash = searchParams.get('token_hash') || hashParams.get('token_hash');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    if (!tokenHash) {
      toastError('This reset link is invalid or expired. Please request a new one.');
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
      await api.post('/auth/reset-password', { token_hash: tokenHash, password });
      toastSuccess('Password reset successfully');
      navigate('/');
    } catch (err) {
      toastError(err?.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fafbfc] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <ShieldCheck size={40} className="mx-auto text-[#bf4a53] mb-2" />
          <h1 className="text-2xl font-bold text-gray-900">Reset Password</h1>
          <p className="text-sm text-gray-500 mt-1">Enter your new password below.</p>
        </div>

        <form onSubmit={handleResetSubmit} className="space-y-4 bg-white rounded-2xl border border-gray-100 p-6 sm:p-8 shadow-sm">
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

        <button
          onClick={() => navigate('/')}
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