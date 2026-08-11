import { useState } from 'react';
import { ArrowRight, Heart, X, ScrollText, ShieldCheck } from 'lucide-react';
import { api } from '../utils/api';
import TermsContent from './TermsContent';

const ITEM_TYPES = ['Gown', 'Suit', 'Barong', 'Filipiniana', 'Costume'];

const validators = {
  name: (v) => (v && v.trim().length >= 2) || 'Enter your full name',
  phone: (v) => (v && v.replace(/\D/g, '').length === 11) || 'Phone must be exactly 11 digits',
  address: (v) => (v && v.trim().length >= 5) || 'Enter your full address',
};

function FieldError({ show, message }) {
  return show ? (
    <p className="text-red-500 text-[11px] font-semibold mt-1">{message}</p>
  ) : null;
}

export default function GoogleSignupDetails({ email, onComplete, onCancel }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [preferences, setPreferences] = useState([]);
  const [touched, setTouched] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const markTouched = (f) => setTouched((p) => ({ ...p, [f]: true }));
  const fieldState = (f) => {
    const value = f === 'name' ? name : f === 'phone' ? phone : address;
    const res = validators[f](value);
    return typeof res === 'string' ? { valid: false, error: res } : { valid: true, error: null };
  };
  const glowClass = (f) => {
    if (!touched[f]) return '';
    return fieldState(f).valid
      ? 'border-emerald-400 ring-2 ring-emerald-200 bg-emerald-50/40'
      : 'border-red-400 ring-2 ring-red-200 bg-red-50/40';
  };

  const togglePreference = (type) =>
    setPreferences((p) => (p.includes(type) ? p.filter((t) => t !== type) : [...p, type]));

  // Phase 3: cancel uses the cookie-based OAuth cancel endpoint
  // (backend reads the access token from the rt_access cookie).
  const handleCancel = async () => {
    try {
      await api.post('/auth/oauth/cancel');
    } catch {
      // best-effort cleanup; still return to the previous screen
    } finally {
      onCancel();
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const allTouched = { name: true, phone: true, address: true };
    setTouched(allTouched);
    if (!fieldState('name').valid || !fieldState('phone').valid || !fieldState('address').valid) {
      setError('Please fix the highlighted fields');
      return;
    }
    // A new account is created here — T&C consent is required first.
    if (!acceptedTerms) {
      setError('Please agree to the Terms and Conditions to create your account');
      return;
    }
    setLoading(true);
    try {
      // Phase 3: POST to the server-side details endpoint. Cookies handle auth.
      const result = await api.post('/auth/oauth/details', {
        name, phone, address, preferences,
      });
      // The backend returns the profile; notify the parent to set authed state.
      await onComplete(result.user);
    } catch (err) {
      setError(err.message || 'Failed to complete sign up');
      setLoading(false);
    }
  };

  const inputClass =
    'w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15 transition-all';

  return (
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#bf4a53] to-[#8f2a31] text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-32 -left-20 w-96 h-96 rounded-full bg-black/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <img src="/RenTech.png" alt="RENTECH" className="w-12 h-12 rounded-xl bg-white/15 p-1.5" />
          <span className="text-xl font-extrabold tracking-tight">RenTech</span>
        </div>
        <div className="relative">
          <h1 className="text-4xl font-extrabold leading-tight">Your perfect outfit, one tap away.</h1>
          <p className="mt-4 text-white/80 text-base max-w-md">
            Rent gowns, suits, barongs and more across Batangas. Finish setting up to manage bookings and get AI styling tips.
          </p>
        </div>
        <div className="relative flex items-center gap-2 text-white/70 text-xs">
          <Heart size={14} /> Loved by renters across Batangas
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-10 bg-[#fcfcfd]">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center justify-center gap-2 mb-6">
            <img src="/RenTech.png" alt="RENTECH" className="w-10 h-10" />
          </div>
          <h2 className="text-3xl font-extrabold text-gray-900">Just a few details</h2>
          <p className="text-gray-500 text-sm mt-1 mb-7">
            Finish setting up your RenTech account.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => markTouched('name')}
                className={inputClass + ' ' + glowClass('name')}
                placeholder="Juan Dela Cruz"
              />
              <FieldError show={touched.name && !fieldState('name').valid} message={fieldState('name').error} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Email</label>
              <input type="email" value={email} disabled className={inputClass + ' bg-gray-100 text-gray-400 cursor-not-allowed'} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Phone</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => markTouched('phone')}
                className={inputClass + ' ' + glowClass('phone')}
                placeholder="0917 123 4567"
              />
              <FieldError show={touched.phone && !fieldState('phone').valid} message={fieldState('phone').error} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Address</label>
              <input
                type="text"
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onBlur={() => markTouched('address')}
                className={inputClass + ' ' + glowClass('address')}
                placeholder="123 Rizal St, Balayan, Batangas"
              />
              <FieldError show={touched.address && !fieldState('address').valid} message={fieldState('address').error} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-500 uppercase">
                Interested in renting? <span className="text-gray-400 font-normal normal-case">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-2 mt-2">
                {ITEM_TYPES.map((type) => {
                  const active = preferences.includes(type);
                  return (
                    <button
                      type="button"
                      key={type}
                      onClick={() => togglePreference(type)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${active ? 'bg-[#bf4a53] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
            </div>

            {error && <p className="text-red-500 text-xs font-semibold text-center">{error}</p>}

            <label className={`flex items-start gap-2.5 cursor-pointer select-none rounded-xl border p-3.5 transition-colors ${acceptedTerms ? 'bg-emerald-50/60 border-emerald-200' : 'bg-gray-50 border-gray-200 hover:bg-gray-100/70'}`}>
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => {
                  if (e.target.checked) {
                    setAcceptedTerms(true);
                    setShowTerms(true);
                  } else {
                    setAcceptedTerms(false);
                  }
                }}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-[#bf4a53] focus:ring-[#bf4a53]"
              />
              <span className="text-xs text-gray-600 leading-relaxed">
                I have read and agree to the{' '}
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setShowTerms(true); }}
                  className="text-[#bf4a53] font-bold hover:underline inline"
                >
                  Terms and Conditions
                </button>{' '}
                and{' '}
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setShowTerms(true); }}
                  className="text-[#bf4a53] font-bold hover:underline inline"
                >
                  Privacy Policy
                </button>
                , including the Data Privacy Act of 2012 (RA 10173).
              </span>
            </label>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 py-3 text-sm font-bold text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !acceptedTerms}
                className="flex-1 py-3 bg-[#bf4a53] text-white font-bold text-sm rounded-xl hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? 'Creating...' : <>Finish <ArrowRight size={16} /></>}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Terms & Conditions / Privacy Policy modal */}
      {showTerms && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowTerms(false)}>
          <div
            className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start sm:items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-[#bf4a53]/10 border border-[#bf4a53]/20 flex items-center justify-center text-[#bf4a53] shrink-0">
                  <ScrollText size={18} />
                </span>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900 text-sm sm:text-base">Terms and Conditions</h3>
                  <p className="text-[11px] sm:text-xs text-gray-500">Effective date: August 2026</p>
                </div>
              </div>
              <button onClick={() => setShowTerms(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 shrink-0" aria-label="Close terms">
                <X size={18} />
              </button>
            </div>
            <div className="px-4 sm:px-6 py-5 overflow-y-auto">
              <TermsContent />
            </div>
            <div className="px-4 sm:px-6 py-4 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 bg-gray-50/60">
              <p className="text-[11px] sm:text-xs text-gray-500 flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
                We collect your data securely and never sell it.
              </p>
              <div className="flex gap-2 w-full sm:w-auto">
                <button onClick={() => setShowTerms(false)}
                  className="flex-1 sm:flex-none px-4 py-2.5 text-sm font-bold text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-100">
                  Close
                </button>
                <button
                  onClick={() => { setAcceptedTerms(true); setShowTerms(false); }}
                  className="flex-1 sm:flex-none px-4 py-2.5 text-sm font-bold text-white bg-[#bf4a53] rounded-xl hover:bg-red-700 transition-colors"
                >
                  I Agree
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
