import { useState } from 'react';
import { LogOut, KeyRound, Eye, EyeOff, ShieldCheck, CheckCircle } from 'lucide-react';
import { api } from '../../utils/api';
import { PASSWORD_REQUIREMENTS } from '../Login';
import CollapsibleCard from './CollapsibleCard';

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
  const metCount = PASSWORD_REQUIREMENTS.filter((r) => r.test(next || '')).length;
  const strength = metCount === 0
    ? { label: 'Not started', bar: 'bg-gray-200', text: 'text-gray-400' }
    : metCount <= 2
      ? { label: 'Weak', bar: 'bg-red-400', text: 'text-red-500' }
      : metCount <= 4
        ? { label: 'Good', bar: 'bg-amber-400', text: 'text-amber-600' }
        : { label: 'Strong', bar: 'bg-emerald-500', text: 'text-emerald-600' };

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
      {/* Change Password — collapsible; the header reveals the form directly.
          Controlled: success auto-collapses via the existing timeout. */}
      <CollapsibleCard
        icon={KeyRound}
        title="Change Password"
        subtitle="Confirm your current password to set a new one. Other devices will be signed out."
        open={showForm}
        onOpenChange={(v) => { if (!v) resetForm(); setShowForm(v); }}
      >
        <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-5">
          {/* Left — inputs (stacked on mobile, 3/5 width on desktop) */}
          <div className="space-y-4 lg:col-span-3 min-w-0">
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
                className={inputClass + ' pr-11'}
                placeholder="••••••••••••"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? 'Hide passwords' : 'Show passwords'}
                className="absolute right-2 top-[34px] min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-gray-400 hover:text-gray-600"
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

            {error && <p className="text-red-500 text-xs font-semibold">{error}</p>}
            {success && <p className="text-emerald-600 text-xs font-semibold">{success}</p>}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-1">
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="px-5 py-2.5 min-h-[44px] border border-gray-200 rounded-full text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !current || !allMet || !passwordsMatch}
                className="px-5 py-2.5 min-h-[44px] bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20 disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save New Password'}
              </button>
            </div>
          </div>

          {/* Right — strength + requirements side panel (below inputs on mobile) */}
          <aside className="lg:col-span-2 min-w-0">
            <div className="rounded-2xl border border-gray-100 bg-[#fafafa] p-4 sm:p-5 space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                    <ShieldCheck size={12} className="text-gray-300" /> Password strength
                  </p>
                  <span className={`text-[11px] font-extrabold ${strength.text}`}>{strength.label}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-200 overflow-hidden" role="progressbar"
                  aria-valuenow={metCount} aria-valuemin={0} aria-valuemax={PASSWORD_REQUIREMENTS.length}
                  aria-label="Password strength">
                  <div className={`h-full rounded-full transition-all duration-300 ${strength.bar}`}
                    style={{ width: `${(metCount / PASSWORD_REQUIREMENTS.length) * 100}%` }} />
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5 tabular-nums">{metCount} of {PASSWORD_REQUIREMENTS.length} requirements met</p>
              </div>

              <div className="border-t border-gray-200/70" />

              <ul className="space-y-2">
                {PASSWORD_REQUIREMENTS.map((req) => {
                  const met = req.test(next || '');
                  return (
                    <li key={req.label} className="flex items-center gap-2">
                      <CheckCircle size={14} className={`shrink-0 ${met ? 'text-emerald-500' : 'text-gray-300'}`} />
                      <span className={`text-xs font-medium ${met ? 'text-emerald-700' : 'text-gray-500'}`}>{req.label}</span>
                    </li>
                  );
                })}
              </ul>

              <div className="border-t border-gray-200/70" />

              <p className="text-[11px] text-gray-400 leading-relaxed">
                Saving signs out your other devices automatically, so a forgotten session can't stay open.
              </p>
            </div>
          </aside>
        </form>
      </CollapsibleCard>

      {/* Sign out — fixed end-of-settings zone (never collapsible): red wash
          sets it apart from the collapsible cards above, solid button. */}
      <div className="rounded-3xl border border-red-100 shadow-sm overflow-hidden bg-gradient-to-br from-red-50/90 via-white to-white">
        <div className="px-4 sm:px-5 md:px-8 py-5 md:py-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-11 h-11 rounded-2xl bg-[#bf4a53] text-white flex items-center justify-center shadow-sm shadow-red-500/25 shrink-0">
              <LogOut size={19} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 text-[15px] md:text-base leading-tight">Sign Out</h3>
              <p className="text-xs text-gray-500 font-medium mt-0.5">End this session and return to the landing page.</p>
              <p className="text-[11px] text-gray-400 mt-1">Bookings, photos and preferences stay saved.</p>
            </div>
          </div>
          <button
            onClick={onRequestLogout}
            className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 min-h-[48px] bg-[#bf4a53] text-white font-bold text-sm rounded-2xl hover:bg-[#a63f47] active:bg-[#93363d] transition-colors shadow-sm shadow-red-500/25 shrink-0"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
