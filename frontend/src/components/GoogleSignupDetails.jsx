import { useState } from 'react';
import RequiredMark from './ui/RequiredMark';
import CharCount from './ui/CharCount';
import { ArrowRight } from 'lucide-react';
import { api } from '../utils/api';
import TermsModal from './TermsModal';
import AuthBrandPanel, { AuthMobileHero } from './AuthBrandPanel';
import PhoneInput from './ui/PhoneInput';
import {
  INPUT_LIMITS,
  sanitizeName,
  sanitizePhone,
  sanitizeAddress,
  validateName,
  validatePhone,
  validateAddress,
} from '../utils/inputLimits';

const ITEM_TYPES = ['Gown', 'Suit', 'Barong', 'Filipiniana', 'Costume'];

const validators = {
  name: (v) => validateName(v),
  phone: (v) => validatePhone(v),
  address: (v) => validateAddress(v),
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
  // The agree checkbox unlocks only after the terms were scrolled to the end.
  const [termsRead, setTermsRead] = useState(false);

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
      <AuthBrandPanel showFeatures={false} subtitle="Rent gowns, suits, barongs and more across Batangas. Finish setting up to manage bookings and get AI styling tips." />

      <div className="w-full lg:w-1/2 flex flex-col items-center lg:justify-center px-4 pb-8 sm:px-6 sm:pb-10 lg:p-10 bg-[#fdf6f7] lg:bg-[#fcfcfd]">
        <div className="self-stretch -mx-4 sm:-mx-6 lg:hidden">
          <AuthMobileHero />
        </div>
        <div className="relative w-full max-w-md -mt-10 lg:mt-0 bg-white rounded-2xl shadow-lg shadow-[#bf4a53]/10 border border-[#f3dfe1] p-6 sm:p-8 lg:rounded-none lg:shadow-none lg:border-0 lg:bg-transparent lg:p-0">
          <h2 className="text-3xl font-extrabold text-gray-900">Just a few details</h2>
          <p className="text-gray-500 text-sm mt-1 mb-7">
            Finish setting up your RenTech account.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Full Name<RequiredMark show={!fieldState('name').valid} /></label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(sanitizeName(e.target.value))}
                onBlur={() => markTouched('name')}
                className={inputClass + ' ' + glowClass('name')}
                placeholder="Juan Dela Cruz"
                maxLength={INPUT_LIMITS.NAME_MAX}
              />
              <CharCount value={name} max={INPUT_LIMITS.NAME_MAX} />
              <FieldError show={touched.name && !fieldState('name').valid} message={fieldState('name').error} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Email</label>
              <input type="email" value={email} disabled className={inputClass + ' bg-gray-100 text-gray-400 cursor-not-allowed'} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Phone<RequiredMark show={!fieldState('phone').valid} /></label>
              <PhoneInput
                required
                value={phone}
                onChange={(e) => setPhone(sanitizePhone(e.target.value))}
                onBlur={() => markTouched('phone')}
                className={inputClass + ' ' + glowClass('phone')}
                aria-label="Phone"
              />
              <FieldError show={touched.phone && !fieldState('phone').valid} message={fieldState('phone').error} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Address<RequiredMark show={!fieldState('address').valid} /></label>
              <input
                type="text"
                required
                value={address}
                onChange={(e) => setAddress(sanitizeAddress(e.target.value))}
                onBlur={() => markTouched('address')}
                className={inputClass + ' ' + glowClass('address')}
                placeholder="123 Rizal St, Balayan, Batangas"
                maxLength={INPUT_LIMITS.ADDRESS_MAX}
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

            <label onClick={() => { if (!termsRead) setShowTerms(true); }} className={`flex items-start gap-2.5 cursor-pointer select-none rounded-xl border p-3.5 transition-colors ${acceptedTerms ? 'bg-emerald-50/60 border-emerald-200' : 'bg-gray-50 border-gray-200 hover:bg-gray-100/70'}`}>
              <input
                type="checkbox"
                checked={acceptedTerms}
                disabled={!termsRead}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-[#bf4a53] focus:ring-[#bf4a53] disabled:opacity-50 disabled:cursor-not-allowed"
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
                {!termsRead && (
                  <span className="block text-[10px] font-semibold text-amber-700 mt-1">Open the terms and scroll to the end to enable this box.</span>
                )}
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
        <TermsModal
          alreadyRead={termsRead}
          onRead={() => setTermsRead(true)}
          onAgree={() => { setTermsRead(true); setAcceptedTerms(true); setShowTerms(false); }}
          onClose={() => setShowTerms(false)}
        />
      )}
    </div>
  );
}
