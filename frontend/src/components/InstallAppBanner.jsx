import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Download, Share, CheckCircle2 } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';

// Post-login "install the app" banner — mobile only, all roles. Chromium gets
// a one-tap Install button (deferred beforeinstallprompt); iOS Safari never
// fires that event, so it gets the manual Share → Add to Home Screen steps.
// Dismissal snoozes for 30 days; a completed install hides it permanently.
export default function InstallAppBanner({ onOpenGuide }) {
  const { show, canInstall, isIos, installing, install, dismiss } = usePwaInstall();
  const [done, setDone] = useState(false);
  // Closing animation: fade + slide up for 150ms before the snooze hides it.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  // Gentle entrance: the banner eases in over 5s instead of popping.
  const [entered, setEntered] = useState(false);
  // Delayed debut: appear 10s after login, then auto-hide 10s later.
  const [visible, setVisible] = useState(false);

  const handleDismiss = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(dismiss, 150);
  }, [dismiss]);

  // 10s after login the banner appears; 10s after that it auto-hides with
  // the same animated close as the X button. Dismissal keeps its 30-day
  // snooze. Timers only run while the banner is eligible.
  useEffect(() => {
    if (!show) return;
    const showT = setTimeout(() => {
      setVisible(true);
      requestAnimationFrame(() => setEntered(true));
    }, 10000);
    const outT = setTimeout(handleDismiss, 20000);
    return () => {
      clearTimeout(showT);
      clearTimeout(outT);
    };
  }, [show, handleDismiss]);

  if (!show || !visible) return null;

  const handleInstall = async () => {
    if (!canInstall) {
      onOpenGuide?.();
      return;
    }
    const ok = await install();
    if (ok) setDone(true);
  };

  return (
    <div
      className={`md:hidden fixed left-4 right-4 z-[90] top-[calc(env(safe-area-inset-top)+76px)] transition-all ease-in ${
        closing
          ? 'opacity-0 -translate-y-3 duration-150'
          : entered
            ? 'opacity-100 translate-y-0 duration-5000'
            : 'opacity-0 -translate-y-2 duration-5000'
      }`}
      role="region"
      aria-label="Install app"
      aria-live="polite"
    >
      <div className="relative overflow-hidden bg-gradient-to-br from-[#bf4a53] to-[#8f2a31] rounded-2xl border border-white/20 shadow-xl shadow-red-900/25 p-3.5 flex items-center gap-3 text-white">
        <div aria-hidden="true" className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-white/10 pointer-events-none" />
        <div aria-hidden="true" className="absolute -bottom-10 -left-6 w-32 h-32 rounded-full bg-black/10 pointer-events-none" />
        <img
          src="/pwa-192x192.png"
          alt=""
          aria-hidden="true"
          className="relative w-11 h-11 rounded-xl shrink-0 border border-white/30 bg-white/15 p-0.5"
        />
        <div className="relative min-w-0 flex-1">
          <p className="text-sm font-bold text-white leading-tight">Install RenTech app</p>
          {done ? (
            <p className="text-[11px] text-emerald-200 font-semibold mt-0.5 flex items-center gap-1">
              <CheckCircle2 size={11} /> Installed — open it from your home screen
            </p>
          ) : isIos && !canInstall ? (
            <p className="text-[11px] text-white/85 mt-0.5 leading-snug">
              Tap <Share size={10} className="inline -mt-0.5" /> Share, then{' '}
              <span className="font-bold text-white">Add to Home Screen</span> for fullscreen access.
            </p>
          ) : (
            <p className="text-[11px] text-white/85 mt-0.5">Faster access, fullscreen, works offline.</p>
          )}
        </div>
        {!done && (
          <button
            type="button"
            onClick={handleInstall}
            disabled={installing}
            className="relative shrink-0 inline-flex items-center gap-1.5 px-4 py-2 bg-white text-[#bf4a53] rounded-full text-xs font-bold hover:bg-red-50 transition-colors shadow-sm disabled:opacity-70"
          >
            <Download size={13} />
            {installing ? 'Adding…' : 'Install'}
          </button>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss install prompt"
          className="relative shrink-0 p-1.5 text-white/70 hover:text-white hover:bg-white/15 rounded-full transition-colors"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
