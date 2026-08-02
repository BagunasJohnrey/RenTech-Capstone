import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);

let idCounter = 0;

// Global toast/notification system. Renders a fixed stack of messages and
// exposes error/success/info helpers via useToast().
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type, message) => {
    const id = ++idCounter;
    setToasts((list) => [...list, { id, type, message }]);
    setTimeout(() => dismiss(id), 4000);
    return id;
  }, [dismiss]);

  const toast = {
    error: (message) => push('error', message),
    success: (message) => push('success', message),
    info: (message) => push('info', message),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed top-4 right-4 z-[99999] flex flex-col gap-2 w-80 max-w-[90vw] pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto rounded-xl shadow-lg px-4 py-3 text-sm font-medium border cursor-pointer animate-in fade-in slide-in-from-top-2 ${
              t.type === 'error'
                ? 'bg-red-50 text-red-700 border-red-200'
                : t.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-white text-gray-700 border-gray-200'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) return { error() {}, success() {}, info() {} };
  return ctx;
}
