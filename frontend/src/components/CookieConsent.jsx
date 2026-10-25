import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowUpRight, Check, X } from 'lucide-react';

const STORAGE_KEY = 'rentech_cookie_consent';
const DISMISS_KEY = 'rentech_cookie_notice_dismissed';
const CONSENT_VERSION = 1;
const CONSENT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function readConsent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (
      saved?.version === CONSENT_VERSION &&
      typeof saved?.decidedAt === 'number' &&
      Date.now() - saved.decidedAt < CONSENT_TTL_MS
    ) {
      return saved.choice ?? null;
    }
  } catch {}
  return null;
}

function wasDismissedThisSession() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export default function CookieConsent() {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (readConsent() || wasDismissedThisSession()) return undefined;
    const timer = window.setTimeout(() => setVisible(true), 500);
    return () => window.clearTimeout(timer);
  }, []);

  const finish = (choice) => {
    try {
      if (choice) {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ choice, version: CONSENT_VERSION, decidedAt: Date.now() }),
        );
      } else {
        sessionStorage.setItem(DISMISS_KEY, '1');
      }
    } catch {}
    setClosing(true);
    window.setTimeout(() => setVisible(false), 180);
  };

  if (!visible || pathname === '/privacy') return null;

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-[95] md:inset-auto md:bottom-6 md:left-6 md:w-[24rem] ${
        closing
          ? 'translate-y-3 opacity-0 transition-all duration-200 md:-translate-x-2 md:translate-y-0'
          : 'animate-in fade-in slide-in-from-bottom-4 duration-300 md:slide-in-from-bottom-0 md:slide-in-from-left-4 motion-reduce:animate-none'
      }`}
    >
      <div
        role="dialog"
        aria-labelledby="cookie-consent-title"
        aria-describedby="cookie-consent-description"
        className="relative max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain rounded-t-[1.5rem] border-t border-gray-200/70 bg-white shadow-[0_-20px_60px_rgba(15,23,42,0.16)] md:max-h-[calc(100dvh-3rem)] md:rounded-[1.5rem] md:border md:shadow-[0_24px_80px_-24px_rgba(15,23,42,0.45)]"
      >
        <div className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 md:p-6">
          <div className="pr-10">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#bf4a53]">Cookie notice</p>
            <h2
              id="cookie-consent-title"
              className="mt-1.5 text-[17px] font-extrabold leading-tight tracking-tight text-gray-950"
            >
              We value your privacy
            </h2>
          </div>

          <button
            type="button"
            onClick={() => finish(null)}
            aria-label="Close cookie notice"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40"
          >
            <X size={16} aria-hidden="true" />
          </button>

          <p id="cookie-consent-description" className="mt-4 text-[12.5px] leading-relaxed text-gray-600">
            We use essential cookies to keep you signed in, secure your account, and remember your preferences.
            No advertising or tracking cookies are used.
          </p>

          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-bold text-gray-600 underline-offset-2 transition-colors hover:text-[#bf4a53] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40"
          >
            Read our Privacy Policy
            <ArrowUpRight size={12} aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>

          <button
            type="button"
            onClick={() => finish('all')}
            className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#bf4a53] px-4 py-2.5 text-xs font-bold text-white shadow-sm shadow-[#bf4a53]/25 transition-colors hover:bg-[#a83f47] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus-visible:ring-offset-2"
          >
            <Check size={14} aria-hidden="true" />
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
