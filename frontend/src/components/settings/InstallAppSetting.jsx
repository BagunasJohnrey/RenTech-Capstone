import { Download, CheckCircle2, Share } from 'lucide-react';
import { usePwaInstall } from '../../hooks/usePwaInstall';

// "Install App" card in Settings, rendered right above Sign Out for every
// role — a persistent entry point to the PWA install for users who dismissed
// (or never saw) the auto banner.
export default function InstallAppSetting() {
  const { canInstall, isIos, installed, installing, install } = usePwaInstall();

  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 flex flex-col sm:flex-row sm:items-center gap-4">
      <img
        src="/pwa-192x192.png"
        alt=""
        aria-hidden="true"
        className="w-12 h-12 rounded-2xl shrink-0 border border-gray-100"
      />
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-gray-900">Install App</h3>
        {installed ? (
          <p className="text-sm text-emerald-600 font-semibold mt-1 flex items-center gap-1.5">
            <CheckCircle2 size={14} /> Installed on this device
          </p>
        ) : isIos && !canInstall ? (
          <p className="text-sm text-gray-500 mt-1 leading-snug">
            On iPhone: tap <Share size={12} className="inline -mt-0.5" /> Share, then{' '}
            <span className="font-semibold text-gray-700">Add to Home Screen</span> for
            fullscreen, faster access.
          </p>
        ) : (
          <p className="text-sm text-gray-500 mt-1">
            Add RenTech to your home screen for fullscreen, faster access — works offline.
          </p>
        )}
      </div>
      {!installed && canInstall && (
        <button
          type="button"
          onClick={install}
          disabled={installing}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20 disabled:opacity-50 shrink-0"
        >
          <Download size={15} />
          {installing ? 'Adding…' : 'Install'}
        </button>
      )}
    </div>
  );
}
