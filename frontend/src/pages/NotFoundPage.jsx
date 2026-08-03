import { Compass } from 'lucide-react';

// Fallback for any URL that doesn't match a page/detail route. Renders
// standalone (no app shell) with an obvious way back to the landing page.
export default function NotFoundPage({ onGoHome, signedIn }) {
  return (
    <div className="min-h-screen bg-[#fcfcfd] flex items-center justify-center p-6">
      <div className="text-center max-w-md animate-in fade-in zoom-in-95 duration-300">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-gray-100 border border-gray-200 flex items-center justify-center mb-6">
          <Compass size={28} className="text-gray-400" />
        </div>
        <h1 className="text-6xl font-extrabold text-gray-900 tracking-tight">404</h1>
        <p className="mt-3 text-gray-500 font-medium">Page not found. The link you entered doesn't exist or has moved.</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
          <button
            onClick={onGoHome}
            className="w-full sm:w-auto px-6 py-3 bg-[#bf4a53] text-white font-bold rounded-full shadow-md shadow-red-500/20 hover:bg-red-700 transition-colors"
          >
            {signedIn ? 'Go to My Dashboard' : 'Go to Landing Page'}
          </button>
        </div>
        <p className="mt-6 text-xs text-gray-400">
          {signedIn ? 'Tip: use the sidebar to navigate instead of typing URLs.' : 'Browse our collection or sign in to book a rental.'}
        </p>
      </div>
    </div>
  );
}
