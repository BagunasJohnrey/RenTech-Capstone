import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import { ToastProvider } from './components/Toast'
import CookieConsent from './components/CookieConsent'
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

// Stale-deploy recovery: every Vercel deploy replaces the hashed /assets/*
// chunks, so a tab (or SW-precached index.html) from the previous deploy 404s
// on its next lazy import ("Failed to fetch dynamically imported module").
// Drop the service worker + its caches so the reload fetches the current
// index.html from the network, then reload — at most once per 30 s so a
// genuinely missing chunk can't cause a reload loop.
if (!import.meta.env.DEV) {
  const RELOAD_KEY = 'rentech_chunk_reload_at';
  window.addEventListener('vite:preloadError', (event) => {
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* storage blocked */ }
    if (Date.now() - last < 30_000) return; // already tried — let the error surface
    event.preventDefault();
    try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
    const unregister = navigator.serviceWorker?.getRegistrations()
      .then(rs => Promise.all(rs.map(r => r.unregister()))) ?? Promise.resolve();
    const clearCaches = window.caches?.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k)))) ?? Promise.resolve();
    Promise.allSettled([unregister, clearCaches]).finally(() => window.location.reload());
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <RentechApp />
          <CookieConsent />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)