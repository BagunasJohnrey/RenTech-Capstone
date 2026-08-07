import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, LogIn } from 'lucide-react';

// Error page shown when a Google OAuth sign-in fails for a user-facing reason
// (e.g. 409 "an account with this email already exists"). The backend redirects
// /api/auth/oauth/callback here instead of dumping raw JSON.
export default function OAuthErrorView() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const message = params.get('message') || 'Something went wrong during Google sign-in. Please try again.';

  return (
    <div className="min-h-screen bg-[#fafbfc] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="p-4 rounded-full w-16 h-16 mx-auto flex items-center justify-center bg-white border border-gray-100 shadow-sm">
          <AlertCircle size={28} className="text-red-500" />
        </div>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sign-in issue</h1>
          <p className="mt-3 text-sm text-gray-600 leading-relaxed">{message}</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => navigate('/', { replace: true })}
            className="flex-1 py-3 text-sm font-bold text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 flex items-center justify-center gap-2"
          >
            <ArrowLeft size={16} /> Back to Home
          </button>
          <button
            onClick={() => navigate('/', { replace: true })}
            className="flex-1 py-3 bg-[#bf4a53] text-white font-bold text-sm rounded-xl hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20 flex items-center justify-center gap-2"
          >
            <LogIn size={16} /> Go to Sign In
          </button>
        </div>
      </div>
    </div>
  );
}