import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, MessageSquare, CreditCard, RefreshCw, Sparkles, Mail, QrCode } from 'lucide-react';
import { settingsService } from '../../services/settings';
import { useToast } from '../Toast';
import { readCache, writeCache, formatCheckedAgo, CACHE_KEYS } from '../../utils/cache';
import CollapsibleCard from './CollapsibleCard';

const INTEGRATIONS = [
  { key: 'gemini', name: 'Gemini AI Stylist', desc: 'Primary AI for outfit suggestions & business insights.', icon: Sparkles, iconClass: 'bg-purple-50 text-purple-600' },
  { key: 'groq', name: 'Groq AI', desc: 'Low-latency AI fallback (tier 2) for stylist & reports.', icon: Sparkles, iconClass: 'bg-violet-50 text-violet-600' },
  { key: 'openrouter', name: 'OpenRouter AI', desc: 'Free-model AI fallback (tier 3) for stylist & reports.', icon: Sparkles, iconClass: 'bg-fuchsia-50 text-fuchsia-600' },
  { key: 'semaphore', name: 'Semaphore SMS Gateway', desc: 'Automated return reminders & booking confirmations.', icon: MessageSquare, iconClass: 'bg-blue-50 text-blue-600' },
  { key: 'brevo', name: 'Brevo Email', desc: 'Verification, password reset & booking/pickup/return emails.', icon: Mail, iconClass: 'bg-rose-50 text-[#bf4a53]' },
  { key: 'paymongo', name: 'PayMongo Payments', desc: 'GCash & credit card downpayments via hosted checkout.', icon: CreditCard, iconClass: 'bg-emerald-50 text-emerald-600' },
  { key: 'maya', name: 'Maya QR / QRPh', desc: 'Maya wallet & QRPh downpayments via scan or redirect.', icon: QrCode, iconClass: 'bg-sky-50 text-sky-600' },
];

// Admin Integrations tab: live connectivity status for AI, SMS and payments.
// Stale-while-revalidate: the last-known status paints instantly with a
// "Status X ago" label, then refreshes silently in the background. Manual
// Refresh forces a live re-probe (bypasses the 60s server cache).
export default function IntegrationsTab() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [integrations, setIntegrations] = useState(() => readCache(CACHE_KEYS.INTEGRATIONS)?.data ?? null);
  const [checkedAt, setCheckedAt] = useState(() => readCache(CACHE_KEYS.INTEGRATIONS)?.at ?? null);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  // Which gateway new downpayments use. Backed by the `payment_gateway`
  // business rule; defaults to PayMongo so a deploy of this feature is a no-op
  // until an admin deliberately flips it.
  const [gateway, setGateway] = useState('paymongo');
  const [gatewaySaving, setGatewaySaving] = useState(false);
  // Re-render every 30s so the "Status X ago" label stays fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const loadIntegrations = useCallback(async (fresh = false) => {
    setIntegrationsLoading(true);
    try {
      const data = await settingsService.getIntegrationsStatus(fresh ? { fresh: true } : undefined);
      setIntegrations(data);
      const at = Date.now();
      setCheckedAt(at);
      writeCache(CACHE_KEYS.INTEGRATIONS, data);
    } catch {
      // Keep showing the cached status on failure — a failed probe shouldn't
      // blank the last-known state. Only clear when nothing was ever cached.
      setIntegrations((prev) => prev);
    } finally {
      setIntegrationsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIntegrations(false);
  }, [loadIntegrations]);

  // Read the live rule so the selector shows the real setting, not a guess.
  useEffect(() => {
    let cancelled = false;
    settingsService.getRules()
      .then((rules) => {
        if (!cancelled && rules?.payment_gateway) setGateway(rules.payment_gateway);
      })
      .catch(() => { /* keep the safe default */ });
    return () => { cancelled = true; };
  }, []);

  const handleGatewayChange = async (value) => {
    const previous = gateway;
    setGateway(value);
    setGatewaySaving(true);
    try {
      await settingsService.updateRules({ payment_gateway: value });
      toastSuccess(`Downpayments now use ${value === 'maya' ? 'Maya QRPh' : 'PayMongo'}.`);
    } catch (err) {
      setGateway(previous);
      toastError(err?.message || 'Could not change the payment gateway.');
    } finally {
      setGatewaySaving(false);
    }
  };

  // Prefer the server's probe time (survives its 60s cache); fall back to
  // when this client last received a response.
  const probeAt = integrations?.checkedAt ?? checkedAt;
  const statusLabel = integrations
    ? (integrationsLoading ? `Refreshing… · Status ${formatCheckedAgo(probeAt)}` : `Status ${formatCheckedAgo(probeAt)}`)
    : null;

  return (
    <CollapsibleCard
      icon={ShieldCheck}
      iconClass="bg-emerald-50 text-emerald-600"
      title="System Integrations"
      subtitle="Live connectivity status for AI, SMS, email and payments"
      storageKey="settings-integrations-open"
      badge={
        integrations ? (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] text-[11px] font-bold tabular-nums">
            {INTEGRATIONS.filter(({ key }) => integrations?.[key]?.configured && integrations?.[key]?.reachable).length} of {INTEGRATIONS.length} live
          </span>
        ) : null
      }
      headerAction={
        <div className="flex items-center gap-2">
          {statusLabel && (
            <span className="hidden lg:block text-[11px] font-semibold text-gray-400 tabular-nums" title={probeAt ? new Date(probeAt).toLocaleString('en-PH') : undefined}>
              {statusLabel}
            </span>
          )}
          <button
            onClick={() => loadIntegrations(true)}
            disabled={integrationsLoading}
            className="shrink-0 flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 min-h-[44px] rounded-full bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={integrationsLoading ? 'animate-spin' : ''} />
            {integrationsLoading ? (integrations ? 'Refreshing…' : 'Checking…') : 'Refresh'}
          </button>
        </div>
      }
    >
      {statusLabel && (
        <p className="lg:hidden text-[11px] font-semibold text-gray-400 tabular-nums -mt-1">{statusLabel}</p>
      )}
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-white border border-[#bf4a53]/20 xl:col-span-2">
          <div className="min-w-0">
            <p className="font-bold text-sm text-gray-900">Payment Gateway</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Used for new booking downpayments. Takes effect immediately; existing bookings are unaffected.
            </p>
          </div>
          <select
            aria-label="Payment Gateway"
            value={gateway}
            onChange={(e) => handleGatewayChange(e.target.value)}
            disabled={gatewaySaving}
            className="shrink-0 text-xs font-bold px-3 py-2 rounded-full bg-gray-100 text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 disabled:opacity-50"
          >
            <option value="paymongo">PayMongo</option>
            <option value="maya">Maya QRPh</option>
          </select>
        </div>
        {INTEGRATIONS.map(({ key, name, desc, icon: Icon, iconClass }) => {
          const coldLoading = integrationsLoading && !integrations;
          const status = integrations?.[key];
          const online = status?.configured && status?.reachable;
          const simulated = status?.simulated && !status?.configured;
          const offline = status && !status.reachable && status.configured;
          return (
            <div key={key} className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-gray-50/70 border border-gray-100">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>
                  <Icon size={18} />
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-sm text-gray-900">{name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  {coldLoading && !status ? (
                    <p className="text-[11px] text-gray-400 mt-1">Checking…</p>
                  ) : status ? (
                    <p className="text-[11px] mt-1 truncate font-medium"
                      title={status.detail}>
                      <span className={online ? 'text-emerald-600' : simulated ? 'text-amber-600' : 'text-red-500'}>
                        {online ? 'Connected'
                          : simulated ? 'Not configured — simulated'
                          : status.detail?.includes('401') ? 'Invalid key'
                          : 'Offline'}
                      </span>
                      {online && status.latencyMs != null && <span className="text-gray-400"> · {status.latencyMs}ms</span>}
                      {!online && status.detail && !simulated && <span className="text-gray-400"> — {status.detail}</span>}
                    </p>
                  ) : (
                    <p className="text-[11px] text-gray-400 mt-1">Not checked yet</p>
                  )}
                </div>
              </div>
              <span className={`shrink-0 flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${
                online ? 'bg-emerald-50 text-emerald-600'
                : simulated ? 'bg-amber-50 text-amber-600'
                : offline ? 'bg-red-50 text-red-500'
                : 'bg-gray-100 text-gray-400'
              }`}>
                <span className={`relative flex h-2 w-2`}>
                  {(online || coldLoading) && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${online ? 'bg-emerald-400' : 'bg-amber-400'}`} />}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${
                    online ? 'bg-emerald-500' : simulated ? 'bg-amber-400' : offline ? 'bg-red-500' : 'bg-gray-300'
                  }`} />
                </span>
                {coldLoading && !status ? 'Checking'
                  : online ? 'Live'
                  : simulated ? 'Simulated'
                  : offline ? 'Error'
                  : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </CollapsibleCard>
  );
}