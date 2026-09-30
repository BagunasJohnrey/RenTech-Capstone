import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle, Mail, XCircle } from 'lucide-react';
import { api } from '../utils/api';

// Email-verification landing page. Brevo links land here with our own
// single-use ?token= (preferred). Legacy Supabase links carry either a
// token_hash (custom template) or a ?code= (default template — Supabase's
// /verify consumed the token and redirected with a code). Either lives in the
// query string or the URL hash depending on flow — read both. Consuming the
// credential confirms the account; the backend best-effort mints session
// cookies so the user may land logged in.
export default function VerifyEmailView() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const brevoToken = searchParams.get('token') || hashParams.get('token');
  const tokenHash = searchParams.get('token_hash') || hashParams.get('token_hash');
  const code = searchParams.get('code') || hashParams.get('code');
  const credential = brevoToken ? { token: brevoToken } : tokenHash ? { token_hash: tokenHash } : code ? { code } : null;
  const [state, setState] = useState('verifying'); // verifying | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!credential) {
      setState('error');
      setMessage('This verification link is invalid or expired. Please sign up again.');
      return;
    }
    (async () => {
      try {
        await api.post('/auth/verify-email', credential);
        setState('success');
      } catch (err) {
        setState('error');
        setMessage(err?.message || 'This verification link is invalid or expired. Please ask for a new one.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brevoToken, tokenHash, code]);

  return (
    <div className="min-h-screen bg-[#fafbfc] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="p-4 rounded-full w-16 h-16 mx-auto flex items-center justify-center bg-white border border-gray-100 shadow-sm">
          {state === 'success' ? (
            <CheckCircle size={28} className="text-emerald-600" />
          ) : state === 'error' ? (
            <XCircle size={28} className="text-red-500" />
          ) : (
            <Mail size={28} className="text-[#bf4a53]" />
          )}
        </div>

        {state === 'verifying' && (
          <>
            <h1 className="text-2xl font-bold text-gray-900">Verifying your email…</h1>
            <p className="text-sm text-gray-500">Please wait a moment.</p>
            <div className="flex justify-center py-2">
              <LoaderSpinner />
            </div>
          </>
        )}

        {state === 'success' && (
          <>
            <h1 className="text-2xl font-bold text-gray-900">Email verified!</h1>
            <p className="text-sm text-gray-500">Your account is now active. Continue to the boutique.</p>
            <button
              onClick={() => navigate('/', { replace: true })}
              className="w-full py-3 bg-[#bf4a53] text-white font-bold text-sm rounded-xl hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20"
            >
              Continue to RenTech
            </button>
          </>
        )}

        {state === 'error' && (
          <>
            <h1 className="text-2xl font-bold text-gray-900">Verification failed</h1>
            <p className="text-sm text-red-500">{message}</p>
            <button
              onClick={() => navigate('/', { replace: true })}
              className="w-full py-3 bg-gray-900 text-white font-bold text-sm rounded-xl hover:bg-gray-800 transition-colors"
            >
              Back to Sign In
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function LoaderSpinner() {
  return (
    <div className="w-8 h-8 border-4 border-[#bf4a53]/20 border-t-[#bf4a53] rounded-full animate-spin" />
  );
}