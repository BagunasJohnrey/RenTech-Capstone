// App-wide "server data changed" signal. useDataVersion fires it when the
// /dashboard/version fingerprint moves (another device or the scheduler
// changed something); widgets with their own fetches (today digest, KPIs,
// payment-proof queue) listen and refetch silently — no Refresh button.
const EVENT = 'rentech:data-changed';

export function emitDataChanged(detail) {
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail })); } catch { /* SSR/tests */ }
}

export function onDataChanged(fn) {
  const handler = (e) => fn(e.detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
