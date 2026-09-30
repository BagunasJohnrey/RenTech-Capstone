import { useState } from 'react';
import { X, Download, Share, CheckCircle2 } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';

// Post-login "install the app" banner — mobile only, all roles. Chromium gets
// a one-tap Install button (deferred beforeinstallprompt); iOS Safari never
// fires that event, so it gets the manual Share → Add to Home Screen steps.
// Dismissal snoozes for 30 days; a completed install hides it permanently.
export default function InstallAppBanner() {
  const { show, canInstall, isIos, installing, install, dismiss } = usePwaInstall();
  const [done, setDone] = useState(false);

  if (!show) return null;

  const handleInstall = async () => {
    const ok = await install();
    if (ok) setDone(true);
  };

  return (
    <div className="md:hidden shrink-0 px-4 pt-3" role="region" aria-label="Install app">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3.5 flex items-center gap-3">
        <img
          src="/pwa-192x192.png"
          alt=""
          aria-hidden="true"
          className="w-11 h-11 rounded-xl shrink-0 border border-gray-100"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900 leading-tight">Install RenTech app</p>
          {done ? (
            <p className="text-[11px] text-emerald-600 font-semibold mt-0.5 flex items-center gap-1">
              <CheckCircle2 size={11} /> Installed — open it from your home screen
            </p>
          ) : isIos && !canInstall ? (
            <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
              Tap <Share size={10} className="inline -mt-0.5" /> Share, then{' '}
              <span className="font-semibold text-gray-700">Add to Home Screen</span> for fullscreen access.
            </p>
          ) : (
            <p className="text-[11px] text-gray-500 mt-0.5">Faster access, fullscreen, works offline.</p>
          )}
        </div>
        {!done && canInstall && (
          <button
            type="button"
            onClick={handleInstall}
            disabled={installing}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 bg-[#bf4a53] text-white rounded-full text-xs font-bold hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20 disabled:opacity-50"
          >
            <Download size={13} />
            {installing ? 'Adding…' : 'Install'}
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="shrink-0 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
