import { ShieldAlert, ArrowLeft } from 'lucide-react';

// Shown when a signed-in user opens a URL that belongs to a different role
// (e.g. a customer typing /admin/inventory). No silent redirect — the user
// sees exactly why access was denied and gets a button back to their area.
export default function UnauthorizedPage({ signedInRole, requiredRole, onHome }) {
  return (
    <div className="min-h-screen bg-[#fcfcfd] flex items-center justify-center p-6">
      <div className="text-center max-w-md animate-in fade-in zoom-in-95 duration-300">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mb-6">
          <ShieldAlert size={30} className="text-[#bf4a53]" />
        </div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">Unauthorized Access</h1>
        <p className="mt-3 text-gray-500 font-medium leading-relaxed">
          This area is restricted to <span className="font-bold text-gray-800">{requiredRole}</span> accounts.
          You're signed in as <span className="font-bold text-gray-800">{signedInRole || 'a guest'}</span>.
        </p>
        <button
          onClick={onHome}
          className="mt-8 inline-flex items-center gap-2 px-6 py-3 bg-[#bf4a53] text-white font-bold rounded-full shadow-md shadow-red-500/20 hover:bg-red-700 transition-colors"
        >
          <ArrowLeft size={16} />
          Go to My Dashboard
        </button>
        <p className="mt-6 text-xs text-gray-400">Need access? Ask the boutique owner to switch your account role.</p>
      </div>
    </div>
  );
}
