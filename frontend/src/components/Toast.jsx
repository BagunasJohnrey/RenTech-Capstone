import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';

const ToastContext = createContext(null);

let idCounter = 0;

const AUTO_DISMISS_MS = 4500;

// Per-type chrome matching the app's card language: white rounded-2xl card,
// tinted icon tile, colored edge + progress bar, Plus Jakarta semibold text.
const TYPES = {
  success: {
    Icon: CheckCircle2,
    tile: 'bg-emerald-50 text-emerald-600',
    bar: 'bg-emerald-500/70',
  },
  error: {
    Icon: XCircle,
    tile: 'bg-red-50 text-red-500',
    bar: 'bg-red-500/70',
  },
  info: {
    Icon: Info,
    tile: 'bg-blue-50 text-blue-600',
    bar: 'bg-blue-500/70',
  },
  warning: {
    Icon: AlertTriangle,
    tile: 'bg-amber-50 text-amber-600',
    bar: 'bg-amber-500/70',
  },
};

// Global toast/notification system. Renders a fixed stack of messages and
// exposes error/success/info/warning helpers via useToast(). Tap to dismiss;
// auto-dismisses after 4.5s with a shrinking progress bar. Dismissal plays a
// 150ms fade/slide-out before the node is removed.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const leavingTimers = useRef({});

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    delete leavingTimers.current[id];
  }, []);

  const dismiss = useCallback((id) => {
    // Already leaving (double-tap) — the removal timer below handles it.
    if (leavingTimers.current[id]) return;
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    leavingTimers.current[id] = setTimeout(() => remove(id), 160);
  }, [remove]);

  // Clearing timers on unmount so a late fire can't setState after unmount.
  useEffect(() => () => Object.values(leavingTimers.current).forEach(clearTimeout), []);

  const push = useCallback((type, message) => {
    const id = ++idCounter;
    setToasts((list) => [...list.slice(-3), { id, type: TYPES[type] ? type : 'info', message }]);
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    return id;
  }, [dismiss]);

  const toast = {
    error: (message) => push('error', message),
    success: (message) => push('success', message),
    info: (message) => push('info', message),
    warning: (message) => push('warning', message),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <style>{`@keyframes rentech-toast-bar { from { width: 100%; } to { width: 0%; } }`}</style>
      <div className="fixed top-4 right-4 left-4 sm:left-auto z-[99999] flex flex-col gap-2 sm:w-80 pointer-events-none" role="status" aria-live="polite">
        {toasts.map((t) => {
          const meta = TYPES[t.type] ?? TYPES.info;
          const Icon = meta.Icon;
          return (
            <div
              key={t.id}
              onClick={() => dismiss(t.id)}
              className={`pointer-events-auto relative overflow-hidden bg-white rounded-2xl shadow-xl shadow-gray-900/10 border border-gray-100 px-2 py-2 flex items-center gap-2.5 cursor-pointer transition-all duration-150 ${t.leaving ? 'opacity-0 -translate-y-1' : 'animate-in fade-in slide-in-from-top-2'}`}
            >
              <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${meta.tile}`}>
                <Icon size={17} />
              </span>
              <p className="flex-1 min-w-0 text-[13px] font-semibold text-gray-800 leading-snug">{t.message}</p>
              <span className="p-1 text-gray-300 shrink-0" aria-hidden="true">
                <X size={14} />
              </span>
              <span
                className={`absolute bottom-0 left-0 h-0.5 ${meta.bar}`}
                style={{ animation: `rentech-toast-bar ${AUTO_DISMISS_MS}ms linear forwards` }}
                aria-hidden="true"
              />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) return { error() {}, success() {}, info() {}, warning() {} };
  return ctx;
}
