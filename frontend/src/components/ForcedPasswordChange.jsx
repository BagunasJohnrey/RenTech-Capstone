import { useState } from 'react';
import { Eye, EyeOff, ShieldCheck, CheckCircle, KeyRound, LogOut } from 'lucide-react';
import { PASSWORD_REQUIREMENTS } from './Login';
import Field from './ui/Field';

// First-login staff: the account was created by an admin with a one-time
// password; the staff member must choose their own password before the app
// unlocks. Mounted as a full-screen gate from App.jsx when
// profile.mustChangePassword is true.
export default function ForcedPasswordChange({ email, onComplete, onLogout }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const allMet = PASSWORD_REQUIREMENTS.every((r) => r.test(next || ''));
  const passwordsMatch = next && next === confirm;

  // A failed submit's error must never linger beside fresh input — clear it
  // as soon as the user edits any field (submit failures re-set it).
  const handleChange = (setter) => (e) => {
    if (error) setError('');
    setter(e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!allMet) {
      setError('New password does not meet the requirements below');
      return;
    }
    if (!passwordsMatch) {
      setError('New passwords do not match');
      return;
    }
    if (next === current) {
      setError('Choose a different password from the one-time password');
      return;
    }
    setLoading(true);
    try {
      await onComplete({ currentPassword: current, newPassword: next });
    } catch (err) {
      setError(err?.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15 transition-all';

  return (
    <div className="min-h-screen bg-[#fcfcfd] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-[#bf4a53]/10 border border-[#bf4a53]/20 flex items-center justify-center text-[#bf4a53] shrink-0">
              <KeyRound size={20} />
            </span>
            <div>
              <h2 className="text-xl font-extrabold text-gray-900">Set your password</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                First sign-in as <span className="font-semibold text-gray-700">{email}</span>
              </p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5">
            <p className="text-xs text-amber-800 leading-relaxed">
              This account was created with a one-time password. For security, choose your own
              password before continuing — you'll use it every sign-in after this.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field
              label="One-time password"
              required
              type={show ? 'text' : 'password'}
              value={current}
              onChange={handleChange(setCurrent)}
              className={inputClass + ' pr-10'}
              placeholder="Provided by your admin"
              autoComplete="current-password"
              endAccessory={
                <button type="button" onClick={() => setShow(!show)}
                  aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            />
            <Field
              label="New password"
              required
              type={show ? 'text' : 'password'}
              value={next}
              onChange={handleChange(setNext)}
              className={inputClass}
              placeholder="••••••••••••"
              autoComplete="new-password"
            />
            <Field
              label="Confirm new password"
              required
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={handleChange(setConfirm)}
              className={inputClass}
              placeholder="••••••••••••"
              autoComplete="new-password"
              error={confirm && next !== confirm ? 'Passwords do not match' : undefined}
            />

            <p className="text-[11px] text-gray-400 font-medium flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-gray-300" />
              Password requirements
            </p>
            <div className="space-y-1.5">
              {PASSWORD_REQUIREMENTS.map((req) => {
                const met = req.test(next || '');
                return (
                  <div key={req.label} className="flex items-center gap-2">
                    <CheckCircle size={12} className={met ? 'text-emerald-500' : 'text-gray-300'} />
                    <span className={`text-xs ${met ? 'text-emerald-600' : 'text-gray-400'}`}>{req.label}</span>
                  </div>
                );
              })}
            </div>

            {error && <p className="text-red-500 text-xs font-semibold text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading || !current || !allMet || !passwordsMatch}
              className="w-full py-3 bg-[#bf4a53] text-white font-bold text-sm rounded-xl hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Password & Continue'}
            </button>
          </form>

          {onLogout && (
            <button
              onClick={onLogout}
              className="w-full flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-gray-600 font-medium"
            >
              <LogOut size={14} /> Sign out instead
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
