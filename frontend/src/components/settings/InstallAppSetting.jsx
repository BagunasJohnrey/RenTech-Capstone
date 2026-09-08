import { useState } from 'react';
import { Download, CheckCircle2, Share, MoreVertical, Smartphone } from 'lucide-react';
import { usePwaInstall } from '../../hooks/usePwaInstall';

// "Install App" card in Settings, rendered right above Sign Out for every
// role — a persistent entry point to the PWA install for users who dismissed
// (or never saw) the auto banner.
//
// One-tap install (beforeinstallprompt) only exists on Chromium
// (Android/desktop Chrome, Edge, Samsung Internet). iOS Safari and Firefox
// never fire it, so those always need the manual steps below — browsers do
// not allow a page to add itself to the home screen without the user's tap.
const STEPS = {
  ios: [
    { icon: Share, text: 'Tap Share in the Safari toolbar' },
    { icon: Smartphone, text: 'Tap Add to Home Screen' },
    { icon: CheckCircle2, text: 'Tap Add to confirm' },
  ],
  android: [
    { icon: MoreVertical, text: 'Tap the ⋮ menu in Chrome' },
    { icon: Download, text: 'Tap Add to Home screen (or Install app)' },
    { icon: CheckCircle2, text: 'Tap Install / Add to confirm' },
  ],
};

export default function InstallAppSetting() {
  const { canInstall, isIos, installed, installing, install } = usePwaInstall();
  const [platform, setPlatform] = useState(isIos ? 'ios' : 'android');
  const oneTap = !installed && canInstall;

  const handleCardClick = (e) => {
    // Whole card is a shortcut for the 1-tap prompt; the real Install button
    // stays the keyboard/screen-reader path. Ignore clicks from inner buttons
    // so the prompt only fires once.
    if (!oneTap || installing) return;
    if (e.target.closest('button')) return;
    install();
  };

  return (
    <div
      onClick={handleCardClick}
      title={oneTap ? 'Tap anywhere to install' : undefined}
      className={`bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-6 space-y-4 ${oneTap ? 'cursor-pointer hover:shadow-md hover:border-[#bf4a53]/30 transition-shadow' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <img
          src="/pwa-192x192.png"
          alt=""
          aria-hidden="true"
          className="w-12 h-12 rounded-2xl shrink-0 border border-gray-100"
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 leading-tight">Install App</h3>
          <p className="text-xs text-gray-500 mt-0.5">Fullscreen, faster access — works offline.</p>
        </div>
        {installed ? (
          <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[11px] font-bold">
            <CheckCircle2 size={12} /> Installed
          </span>
        ) : oneTap ? (
          <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] text-[11px] font-bold">
            1-tap install
          </span>
        ) : (
          <span className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 text-[11px] font-bold">
            Manual setup
          </span>
        )}
      </div>

      {installed ? (
        <p className="text-sm text-emerald-600 font-semibold flex items-center gap-1.5">
          <CheckCircle2 size={14} /> Installed on this device
        </p>
      ) : (
        <>
          {/* 1-tap install button when the browser allows it */}
          {oneTap && (
            <button
              type="button"
              onClick={install}
              disabled={installing}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#bf4a53] text-white rounded-2xl text-sm font-bold hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53] focus-visible:ring-offset-2"
            >
              <Download size={16} />
              {installing ? 'Adding…' : 'Add to Home Screen'}
            </button>
          )}

          {/* Platform guides */}
          <div>
            <div role="tablist" aria-label="Install instructions by platform" className="flex gap-1 bg-gray-100 rounded-xl p-1">
              {[
                { key: 'ios', label: 'iPhone' },
                { key: 'android', label: 'Android' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={platform === key}
                  onClick={() => setPlatform(key)}
                  className={`flex-1 min-h-[36px] rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60 ${
                    platform === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <ol className="mt-3 space-y-2.5">
              {STEPS[platform].map(({ icon: Icon, text }, i) => (
                <li key={text} className="flex items-center gap-3">
                  <span aria-hidden="true" className="shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-[11px] font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <Icon size={15} aria-hidden="true" className="shrink-0 text-[#bf4a53]" />
                  <span className="text-sm text-gray-700">{text}</span>
                </li>
              ))}
            </ol>
            {oneTap && (
              <p className="mt-3 text-xs text-gray-400">
                Using Chrome on Android? The button above installs it in one tap — no manual steps needed.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
