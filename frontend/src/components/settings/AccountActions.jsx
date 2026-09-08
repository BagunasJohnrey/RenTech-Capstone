import { useState } from 'react';
import { LogOut, KeyRound, Eye, EyeOff, ShieldCheck, CheckCircle } from 'lucide-react';
import { api } from '../../utils/api';
import { PASSWORD_REQUIREMENTS } from '../Login';

// Sign-out + change-password card rendered at the bottom of every
// Profile/Settings screen. The password change always verifies the current
// password first (server-side) — a stolen session can't lock the real user
// out by rotating the credential.
export default function AccountActions({ onRequestLogout }) {
  const [showForm, setShowForm] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const allMet = PASSWORD_REQUIREMENTS.every((r) => r.test(next || ''));
  const passwordsMatch = !!next && next === confirm;

  const resetForm = () => {
    setCurrent(''); setNext(''); setConfirm('');
    setError(''); setSuccess('');
  };

  const handleChange = (setter) => (e) => {
    if (error) setError('');
    setter(e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!allMet) { setError('New password does not meet the requirements'); return; }
    if (!passwordsMatch) { setError('New passwords do not match'); return; }
    if (next === current) { setError('Choose a different password from your current one'); return; }
    setLoading(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      setSuccess('Password updated! Other devices have been signed out.');
      resetForm();
      setTimeout(() => { setSuccess(''); setShowForm(false); }, 2500);
    } catch (err) {
      setError(err?.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15 transition-all';

  return (
    <div className="space-y-4">
      {/* Change Password */}
      <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <KeyRound size={16} className="text-gray-500" /> Change Password
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Confirm your current password to set a new one. Other devices will be signed out.
            </p>
          </div>
          {!showForm && (
            <button
              onClick={() => { resetForm(); setShowForm(true); }}
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-200 bg-gray-50 text-gray-700 font-bold text-sm rounded-full hover:bg-gray-100 transition-colors shrink-0"
            >
              <KeyRound size={15} /> Change Password
            </button>
          )}
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4 max-w-md">
            <div>
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">Current Password</label>
              <input
                type={show ? 'text' : 'password'}
                value={current}
                onChange={handleChange(setCurrent)}
                className={inputClass + ' pr-10'}
                placeholder="Your current password"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="relative">
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">New Password</label>
              <input
                type={show ? 'text' : 'password'}
                value={next}
                onChange={handleChange(setNext)}
                className={inputClass + ' pr-10'}
                placeholder="••••••••••••"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? 'Hide passwords' : 'Show passwords'}
                className="absolute right-3 top-[38px] text-gray-400 hover:text-gray-600"
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">Confirm New Password</label>
              <input
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={handleChange(setConfirm)}
                className={inputClass}
                placeholder="••••••••••••"
                autoComplete="new-password"
                required
              />
              {confirm && next !== confirm && (
                <p className="text-red-500 text-xs font-semibold mt-1.5">Passwords do not match</p>
              )}
            </div>

            <p className="text-[11px] text-gray-400 font-medium flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-gray-300" /> Password requirements
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {PASSWORD_REQUIREMENTS.map((req) => {
                const met = req.test(next || '');
                return (
                  <div key={req.label} className="flex items-center gap-1.5">
                    <CheckCircle size={11} className={met ? 'text-emerald-500' : 'text-gray-300'} />
                    <span className={`text-[11px] ${met ? 'text-emerald-600' : 'text-gray-400'}`}>{req.label}</span>
                  </div>
                );
              })}
            </div>

            {error && <p className="text-red-500 text-xs font-semibold">{error}</p>}
            {success && <p className="text-emerald-600 text-xs font-semibold">{success}</p>}

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="px-5 py-2.5 border border-gray-200 rounded-full text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !current || !allMet || !passwordsMatch}
                className="px-5 py-2.5 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20 disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save New Password'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Sign out */}
      <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="font-bold text-gray-900">Account Actions</h3>
          <p className="text-sm text-gray-500 mt-1">Sign out of your account and return to the landing page.</p>
        </div>
        <button
          onClick={onRequestLogout}
          className="flex items-center gap-2 px-5 py-2.5 border border-red-200 bg-red-50 text-[#bf4a53] font-bold text-sm rounded-full hover:bg-red-100 transition-colors shrink-0"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>
  );
}
