import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import { ToastProvider } from './components/Toast'
import RentechApp from './App'
import './index.css'

// PWA service-worker lifecycle:
//   DEV  - never register. If a preview/production build previously ran on
//          this origin, force-unregister so the dev tab always serves live
//          code instead of a cached production bundle.
//   PROD - register; poll for updates every 60 s while the tab is open, and
//          apply a fresh SW the moment one's downloaded (no user prompt).
if (import.meta.env.DEV) {
  navigator.serviceWorker?.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
} else {
  const registerServiceWorker = () => {
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        const updateSW = registerSW({
          immediate: true,
          onRegisteredSW(_swUrl, registration) {
            if (registration) setInterval(() => registration.update(), 60 * 1000);
          },
          onNeedRefresh() {
            navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
            updateSW(true);
          },
        });
      })
      .catch(() => { /* no SW in this build — not fatal */ });
  };
  // Wait for the page to load and the main thread to go idle: installing the
  // SW (and its caches) must not compete with the first render on mobile.
  const scheduleServiceWorker = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(registerServiceWorker, { timeout: 4000 });
    } else {
      setTimeout(registerServiceWorker, 1500);
    }
  };
  if (document.readyState === 'complete') scheduleServiceWorker();
  else window.addEventListener('load', scheduleServiceWorker, { once: true });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <RentechApp />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)