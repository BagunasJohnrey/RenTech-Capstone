import { useState } from 'react';
import { Eye, EyeOff, CheckCircle, ArrowRight, ArrowLeft, Sparkles, ShoppingBag, ShieldCheck, Heart, MapPin } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import Field from './ui/Field';
import { Link, useNavigate } from 'react-router-dom';

const ITEM_TYPES = ['Gown', 'Suit', 'Barong', 'Filipiniana', 'Costume'];

// Real-time field validators. Return `true` when valid, or an error string.
export const validators = {
  name: (v) => (v && v.trim().length >= 2) || 'Enter your full name',
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '') || 'Enter a valid email address',
  phone: (v) => (v && v.replace(/\D/g, '').length === 11) || 'Phone must be exactly 11 digits',
  address: (v) => (v && v.trim().length >= 5) || 'Enter your full address',
  // Phase 4: password policy — 12+ chars, upper + lower + digit + symbol
  password: (v) => {
    if (!v || v.length < 12) return 'Must be at least 12 characters';
    if (!/[A-Z]/.test(v)) return 'Must contain an uppercase letter';
    if (!/[a-z]/.test(v)) return 'Must contain a lowercase letter';
    if (!/[0-9]/.test(v)) return 'Must contain a number';
    if (!/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\;'`~]/.test(v)) return 'Must contain a symbol (!@#$%^&*...)';
    return true;
  },
  confirm: (v, all) => v === all.password || 'Passwords do not match',
};

// Phase 4: password requirements checklist for the signup form.
export const PASSWORD_REQUIREMENTS = [
  { label: 'At least 12 characters', test: (v) => v.length >= 12 },
  { label: 'Contains uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'Contains lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'Contains a number', test: (v) => /[0-9]/.test(v) },
  { label: 'Contains a symbol', test: (v) => /[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\;'`~]/.test(v) },
];

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

function GoogleButton({ label, onClick, loading }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="w-full py-3 flex items-center justify-center gap-3 bg-white border border-gray-300 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
    >
      {loading ? 'Redirecting...' : <><GoogleGlyph /> {label}</>}
    </button>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 my-5">
      <div className="h-px flex-1 bg-gray-200" />
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">or</span>
      <div className="h-px flex-1 bg-gray-200" />
    </div>
  );
}

export default function Login({ onLogin, onVerifyMfa }) {
  const { signup: authSignup } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignup, setIsSignup] = useState(false);
  const [signupStep, setSignupStep] = useState(1);
  const [signupData, setSignupData] = useState({ name: '', email: '', phone: '', address: '', password: '', confirm: '', preferences: [] });
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [touched, setTouched] = useState({});
  const [googleLoading, setGoogleLoading] = useState(false);

  const updateSignup = (field, value) => setSignupData(prev => ({ ...prev, [field]: value }));
  const markTouched = (field) => setTouched(prev => ({ ...prev, [field]: true }));

  const fieldState = (field) => {
    const res = validators[field](signupData[field], signupData);
    return typeof res === 'string' ? { valid: false, error: res } : { valid: true, error: null };
  };

  const glowClass = (field) => {
    if (!touched[field]) return '';
    const { valid } = fieldState(field);
    return valid
      ? 'border-emerald-400 ring-2 ring-emerald-200 bg-emerald-50/40'
      : 'border-red-400 ring-2 ring-red-200 bg-red-50/40';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await onLogin(email, password);
       // W2.7: If MFA is required, the backend already stored the challenge
      // tokens in the rt_mfa_pending httpOnly cookie. We just show the TOTP prompt.
      if (result?.requiresMfa) {
        setMfaChallenge({ email: result.email || result.user?.email });
        return;
      }
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMfaLoading(true);
    try {
      // W2.7: MFA challenge tokens are stored in the rt_mfa_pending httpOnly
      // cookie by the backend — we only send the 6-digit code.
      // trustDevice opts into the 30-day rt_mfa_trusted cookie: future logins
      // on this browser skip the TOTP prompt.
      const result = await onVerifyMfa({ code: mfaCode, trustDevice });
      void result;
    } catch (err) {
      setError(err.message || 'Invalid code');
    } finally {
      setMfaLoading(false);
    }
  };

  const togglePreference = (type) => {
    setSignupData(prev => {
      const has = prev.preferences.includes(type);
      return { ...prev, preferences: has ? prev.preferences.filter(t => t !== type) : [...prev.preferences, type] };
    });
  };

  const handleSignupNext = () => {
    setError('');
    if (signupStep === 1) {
      const fields = ['name', 'email', 'phone', 'address'];
      const allTouched = { ...touched };
      fields.forEach(f => (allTouched[f] = true));
      setTouched(allTouched);
      if (fields.some(f => !fieldState(f).valid)) {
        setError('Please fix the highlighted fields');
        return;
      }
      setSignupStep(2);
    } else if (signupStep === 2) {
      const fields = ['password', 'confirm'];
      const allTouched = { ...touched };
      fields.forEach(f => (allTouched[f] = true));
      setTouched(allTouched);
      if (fields.some(f => !fieldState(f).valid)) {
        setError('Please fix the highlighted fields');
        return;
      }
      setLoading(true);
      authSignup({ email: signupData.email, password: signupData.password, name: signupData.name, phone: signupData.phone, address: signupData.address, preferences: signupData.preferences })
        .then(() => setSignupStep(3))
        .catch(err => setError(err.message || 'Signup failed'))
        .finally(() => setLoading(false));
    }
  };

  const handleSignupBack = () => {
    setError('');
    setSignupStep(s => Math.max(1, s - 1));
  };

  const handleFinishSignup = () => {
    setEmail(signupData.email);
    setPassword(signupData.password);
    setIsSignup(false);
    setSignupStep(1);
    setSignupData({ name: '', email: '', phone: '', address: '', password: '', confirm: '', preferences: [] });
  };

  const toggleMode = () => {
    setIsSignup(!isSignup);
    setError('');
    setSignupStep(1);
  };

  const handleGoogle = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      // Phase 3: redirect to the backend's server-side OAuth endpoint.
      // The backend handles the entire Google handshake and sets httpOnly
      // cookies — no tokens pass through the browser.
      window.location.href = '/api/auth/oauth/redirect?provider=google';
    } catch (err) {
      setError(err.message || 'Google sign-in failed');
      setGoogleLoading(false);
    }
  };

  const inputClass =
    'w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15 transition-all';

  // Form field helpers are defined at module scope below.

  return (
    <div className="min-h-screen flex bg-white overflow-x-hidden">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#bf4a53] to-[#8f2a31] text-white p-10 lg:p-16 flex-col justify-between relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-32 -left-20 w-96 h-96 rounded-full bg-black/10 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <img src="/RenTech.png" alt="RENTECH" className="w-12 h-12 rounded-xl bg-white/15 p-1.5" />
          <span className="text-xl font-extrabold tracking-tight">RenTech</span>
        </div>

        <div className="relative">
          <h1 className="text-4xl font-extrabold leading-tight">Your perfect outfit, one tap away.</h1>
          <p className="mt-4 text-white/80 text-base max-w-md">
            Rent gowns, suits, barongs and more across Batangas. Sign in to manage bookings, get AI styling tips, and track your rentals.
          </p>

          <ul className="mt-8 space-y-4">
            {[
              { icon: ShoppingBag, text: 'Browse a curated collection of rentals' },
              { icon: Sparkles, text: 'Get AI-powered styling recommendations' },
              { icon: MapPin, text: 'Pickup & returns based in Balayan, Batangas' },
              { icon: ShieldCheck, text: 'Secure bookings and account protection' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-white/90">
                <span className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
                  <Icon size={18} />
                </span>
                <span className="text-sm font-medium">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-2 text-white/70 text-xs">
          <Heart size={14} /> Loved by renters across Batangas
        </div>
      </div>

      {/* Form panel */}
      <div className="w-full lg:w-1/2 min-h-screen flex flex-col items-center px-4 py-8 sm:px-6 sm:py-10 lg:px-12 lg:py-12 bg-[#fcfcfd]">
        <div className="w-full max-w-md my-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 lg:rounded-none lg:shadow-none lg:border-0 lg:bg-transparent lg:p-0">
          {!isSignup ? (
            <>
              <div className="lg:hidden flex items-center justify-center mb-8">
                <span className="text-2xl font-extrabold tracking-tight text-gray-950">RENTECH<span className="text-[#bf4a53]">.</span></span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900">Welcome back</h2>
              <p className="text-gray-500 text-sm mt-1 mb-7">Sign in to your RenTech account to continue.</p>

               {/* Phase 5: MFA challenge screen */}
               {mfaChallenge && (
                 <div className="space-y-4">
                   <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900">Two-Factor Authentication</h2>
                   <p className="text-gray-500 text-sm mt-1 mb-4">
                     Enter the 6-digit code from your authenticator app to sign in as <span className="font-semibold">{mfaChallenge.email}</span>.
                   </p>
                   <form onSubmit={handleMfaSubmit} className="space-y-4">
                     <Field
                       label="Authentication Code"
                       type="text"
                       required
                       value={mfaCode}
                       onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                       className={inputClass}
                       placeholder="000000"
                       autoComplete="one-time-code"
                     />
                     {error && (
                       <div className="text-red-500 text-xs font-semibold text-center">
                         <p>{error}</p>
                       </div>
                     )}
                     <label className="flex items-start gap-2 text-sm text-gray-500 cursor-pointer select-none">
                       <input
                         type="checkbox"
                         checked={trustDevice}
                         onChange={(e) => setTrustDevice(e.target.checked)}
                         className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#bf4a53] focus:ring-[#bf4a53]"
                       />
                       <span>Trust this device for 30 days — skip this code on your next sign-in on this browser.</span>
                     </label>
                     <button
                       type="submit"
                       disabled={mfaLoading || mfaCode.length !== 6}
                       className="w-full py-3 bg-gray-900 text-white font-bold text-sm rounded-xl hover:bg-gray-800 transition-colors shadow-sm shadow-gray-900/20 disabled:opacity-50"
                     >
                       {mfaLoading ? 'Verifying...' : 'Verify'}
                     </button>
                   </form>
                   <button
                     type="button"
                     onClick={() => setMfaChallenge(null)}
                     className="text-sm text-gray-400 hover:text-gray-600 font-medium w-full"
                   >
                     Back to sign in
                   </button>
                 </div>
               )}

               {!mfaChallenge && (
               <>
               <GoogleButton label="Continue with Google" onClick={handleGoogle} loading={googleLoading} />
               <Divider />

              <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@example.com" autoComplete="email" />
                <Field label="Password" required className={inputClass + ' pr-10'} placeholder="••••••••"
                  type={showPassword ? 'text' : 'password'}
                  value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                  endAccessory={
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />
                 {error && (
                   <div className="text-red-500 text-xs font-semibold text-center space-y-1">
                     <p>{error}</p>
                     {error.toLowerCase().includes('create one') && (
                       <button
                         type="button"
                         onClick={() => { setError(''); setIsSignup(true); setSignupStep(1); }}
                         className="text-[#bf4a53] font-bold hover:underline"
                       >
                         Create an account
                       </button>
                     )}
                   </div>
                 )}
                 <button type="submit" disabled={loading}
                   className="w-full py-3 bg-gray-900 text-white font-bold text-sm rounded-xl hover:bg-gray-800 transition-colors shadow-sm shadow-gray-900/20 disabled:opacity-50">
                   {loading ? 'Signing in...' : 'Sign In'}
                 </button>
                 <div className="flex items-center justify-between text-sm">
                   <button
                     type="button"
                     onClick={() => navigate('/forgot-password')}
                     className="text-[#bf4a53] hover:underline font-semibold"
                   >
                     Forgot password?
                   </button>
                 </div>
              </form>
              <p className="text-center text-gray-500 text-sm mt-6">
                Don't have an account?{' '}
                <button onClick={toggleMode} className="text-[#bf4a53] font-bold hover:underline">Sign Up</button>
              </p>
            </>
          )}
        </>
      ) : (
            <>
              <div className="lg:hidden flex items-center justify-center mb-8">
                <span className="text-2xl font-extrabold tracking-tight text-gray-950">RENTECH<span className="text-[#bf4a53]">.</span></span>
              </div>
              <div className="mb-1">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900">Create your account</h2>
                <p className="text-gray-500 text-sm mt-1 mb-6">Join RenTech to start renting in minutes.</p>
                {/* Labeled stepper */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    {[1, 2, 3].map((step) => (
                      <div key={step} className={`h-1.5 flex-1 rounded-full transition-all ${signupStep >= step ? 'bg-[#bf4a53]' : 'bg-gray-200'}`} />
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                    <span className={signupStep >= 1 ? 'text-[#bf4a53]' : 'text-gray-400'}>Details</span>
                    <span className={signupStep >= 2 ? 'text-[#bf4a53]' : 'text-gray-400'}>Password</span>
                    <span className={signupStep >= 3 ? 'text-[#bf4a53]' : 'text-gray-400'}>Done</span>
                  </div>
                </div>
              </div>

              {signupStep === 1 && (
                <div className="space-y-5">
                  <GoogleButton label="Sign up with Google" onClick={handleGoogle} loading={googleLoading} />
                  <Divider />

                  <div className="space-y-4">
                    <Field label="Full Name" type="text" required value={signupData.name}
                      onChange={(e) => updateSignup('name', e.target.value)} onBlur={() => markTouched('name')}
                      className={inputClass + ' ' + glowClass('name')} placeholder="Juan Dela Cruz" autoComplete="name"
                      error={touched.name && !fieldState('name').valid ? fieldState('name').error : undefined} />
                    <Field label="Email" type="email" required value={signupData.email}
                      onChange={(e) => updateSignup('email', e.target.value)} onBlur={() => markTouched('email')}
                      className={inputClass + ' ' + glowClass('email')} placeholder="you@example.com" autoComplete="email"
                      error={touched.email && !fieldState('email').valid ? fieldState('email').error : undefined} />
                    <Field label="Phone" type="tel" required value={signupData.phone}
                      onChange={(e) => updateSignup('phone', e.target.value)} onBlur={() => markTouched('phone')}
                      className={inputClass + ' ' + glowClass('phone')} placeholder="0917 123 4567" autoComplete="tel" inputMode="tel"
                      error={touched.phone && !fieldState('phone').valid ? fieldState('phone').error : undefined} />
                    <Field label="Address" type="text" required value={signupData.address}
                      onChange={(e) => updateSignup('address', e.target.value)} onBlur={() => markTouched('address')}
                      className={inputClass + ' ' + glowClass('address')} placeholder="123 Rizal St, Balayan, Batangas" autoComplete="street-address"
                      error={touched.address && !fieldState('address').valid ? fieldState('address').error : undefined} />
                  </div>

                  <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                      Interested in renting? <span className="text-gray-400 font-normal normal-case">(optional)</span>
                    </label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {ITEM_TYPES.map(type => {
                        const active = signupData.preferences.includes(type);
                        return (
                          <button type="button" key={type} onClick={() => togglePreference(type)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${active ? 'bg-[#bf4a53] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'}`}>
                            {type}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {error && <p className="text-red-500 text-xs font-semibold text-center">{error}</p>}
                  <button onClick={handleSignupNext}
                    className="w-full py-3 bg-[#bf4a53] text-white font-bold text-sm rounded-xl hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20 flex items-center justify-center gap-2">
                    Next <ArrowRight size={16} />
                  </button>
                </div>
              )}

              {signupStep === 2 && (
                <div className="space-y-5">
                  <Field label="Password" required placeholder="••••••••" autoComplete="new-password"
                    type={showSignupPassword ? 'text' : 'password'} value={signupData.password}
                    onChange={(e) => updateSignup('password', e.target.value)} onBlur={() => markTouched('password')}
                    className={inputClass + ' pr-10 ' + glowClass('password')}
                    error={touched.password && !fieldState('password').valid ? fieldState('password').error : undefined}
                    endAccessory={
                      <button type="button" onClick={() => setShowSignupPassword(!showSignupPassword)}
                        aria-label={showSignupPassword ? 'Hide password' : 'Show password'} aria-pressed={showSignupPassword}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showSignupPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    } />
                  <Field label="Confirm Password" required placeholder="••••••••" autoComplete="new-password"
                    type={showSignupPassword ? 'text' : 'password'} value={signupData.confirm}
                    onChange={(e) => updateSignup('confirm', e.target.value)} onBlur={() => markTouched('confirm')}
                    className={inputClass + ' ' + glowClass('confirm')}
                    error={touched.confirm && !fieldState('confirm').valid ? fieldState('confirm').error : undefined} />
                   <p className="text-[11px] text-gray-400 font-medium flex items-center gap-1.5 mb-2">
                     <ShieldCheck size={12} className="text-gray-300" />
                     Password requirements
                   </p>
                   <div className="space-y-1.5 mb-4">
                     {PASSWORD_REQUIREMENTS.map((req) => {
                       const met = req.test(signupData.password || '');
                       return (
                         <div key={req.label} className="flex items-center gap-2">
                           <CheckCircle size={12} className={met ? 'text-emerald-500' : 'text-gray-300'} />
                           <span className={`text-xs ${met ? 'text-emerald-600' : 'text-gray-400'}`}>{req.label}</span>
                         </div>
                       );
                     })}
                   </div>
                  {error && <p className="text-red-500 text-xs font-semibold text-center">{error}</p>}
                  <div className="flex gap-3">
                    <button onClick={handleSignupBack}
                      className="flex-1 py-3 text-sm font-bold text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 flex items-center justify-center gap-1">
                      <ArrowLeft size={16} /> Back
                    </button>
                    <button onClick={handleSignupNext} disabled={loading}
                      className="flex-1 py-3 bg-[#bf4a53] text-white font-bold text-sm rounded-xl hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20 disabled:opacity-50">
                      {loading ? 'Creating...' : 'Create Account'}
                    </button>
                  </div>
                </div>
              )}

              {signupStep === 3 && (
                <div className="space-y-6 text-center py-6">
                  <div className="p-4 bg-emerald-50 rounded-full w-16 h-16 mx-auto flex items-center justify-center">
                    <CheckCircle size={28} className="text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-xl">Welcome, {signupData.name.split(' ')[0]}!</h3>
                    <p className="text-sm text-gray-500 mt-2">You're all set. Start browsing our collection and book your perfect outfit.</p>
                  </div>
                  <button onClick={handleFinishSignup}
                    className="w-full py-3 bg-[#bf4a53] text-white font-bold text-sm rounded-xl hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20">
                    Start Browsing
                  </button>
                </div>
              )}

              {signupStep !== 3 && (
                <p className="text-center text-gray-500 text-sm mt-6">
                  Already have an account?{' '}
                  <button onClick={toggleMode} className="text-[#bf4a53] font-bold hover:underline">Sign In</button>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
