import { useState } from 'react';
import { ArrowRight, Heart } from 'lucide-react';
import { api } from '../utils/api';

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
                disabled={loading}
                className="flex-1 py-3 bg-[#bf4a53] text-white font-bold text-sm rounded-xl hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? 'Creating...' : <>Finish <ArrowRight size={16} /></>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
