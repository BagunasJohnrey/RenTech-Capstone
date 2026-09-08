import { useCallback, useEffect, useRef, useState } from 'react';

// PWA install prompt state. The browser fires `beforeinstallprompt` (Chromium
// Android/desktop) when the app is installable; iOS Safari never fires it and
// needs manual "Add to Home Screen" instructions instead.
const SNOOZE_KEY = 'rentech_pwa_install_dismissed';
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // re-show a month after dismiss

const isIosDevice = () =>
  typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

const isMobileDevice = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  return /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

const isStandalone = () => {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari pseudo-standard property.
  return window.navigator?.standalone === true;
};

function isSnoozed() {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < SNOOZE_MS;
  } catch {
    return false;
  }
}

export function usePwaInstall() {
  const deferredRef = useRef(null);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [dismissed, setDismissed] = useState(() => isSnoozed());
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const onPrompt = (e) => {
      // Hold the event so the banner's Install button can trigger it later.
      e.preventDefault();
      deferredRef.current = e;
      setCanInstall(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      deferredRef.current = null;
      setCanInstall(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      // private mode — in-memory dismissal for this visit
    }
    setDismissed(true);
  }, []);

  const install = useCallback(async () => {
    const evt = deferredRef.current;
    if (!evt) return false;
    setInstalling(true);
    try {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      if (outcome === 'accepted') {
        setInstalled(true);
        setCanInstall(false);
        return true;
      }
      dismiss();
      return false;
    } finally {
      setInstalling(false);
    }
  }, [dismiss]);

  const mobile = isMobileDevice();
  const ios = isIosDevice();
  // iOS never fires beforeinstallprompt — show the manual-steps variant.
  const show = mobile && !installed && !dismissed && (canInstall || ios);

  return { show, canInstall, isIos: ios, installed, installing, install, dismiss };
}
