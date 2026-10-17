import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, MessageSquare, CreditCard, RefreshCw, Sparkles, Mail, QrCode } from 'lucide-react';
import { settingsService } from '../../services/settings';
import { useToast } from '../Toast';
import { readCache, writeCache, formatCheckedAgo, CACHE_KEYS } from '../../utils/cache';
import CollapsibleCard from './CollapsibleCard';
import Toggle from './Toggle';
import PaymentQrManager from './PaymentQrManager';

// Human labels for the active gateway, used in toasts + the selector copy.
const GATEWAY_LABELS = { paymongo: 'PayMongo', maya: 'Maya QRPh', manual: 'Manual QR' };

const INTEGRATIONS = [
  { key: 'gemini', name: 'Gemini AI Stylist', desc: 'Primary AI for outfit suggestions & business insights.', icon: Sparkles, iconClass: 'bg-purple-50 text-purple-600' },
  { key: 'groq', name: 'Groq AI', desc: 'Low-latency AI fallback (tier 2) for stylist & reports.', icon: Sparkles, iconClass: 'bg-violet-50 text-violet-600' },
  { key: 'openrouter', name: 'OpenRouter AI', desc: 'Free-model AI fallback (tier 3) for stylist & reports.', icon: Sparkles, iconClass: 'bg-fuchsia-50 text-fuchsia-600' },
  { key: 'semaphore', name: 'Semaphore SMS Gateway', desc: 'Automatic return reminders & booking confirmations. Off pauses autos only — manual staff sends still work.', icon: MessageSquare, iconClass: 'bg-blue-50 text-blue-600' },
  { key: 'brevo', name: 'Brevo Email', desc: 'Booking/pickup/return & reminder emails. Off pauses those — verification + password-reset emails still send.', icon: Mail, iconClass: 'bg-rose-50 text-[#bf4a53]' },
  { key: 'paymongo', name: 'PayMongo Payments', desc: 'GCash & credit card downpayments via hosted checkout.', icon: CreditCard, iconClass: 'bg-emerald-50 text-emerald-600' },
  { key: 'maya', name: 'Maya QR / QRPh', desc: 'Maya wallet & QRPh downpayments via scan or redirect.', icon: QrCode, iconClass: 'bg-sky-50 text-sky-600' },
];

// Card groups render in this order (badge count still uses INTEGRATIONS).
const GROUPS = [
  { title: 'Automatic Messaging', sub: 'Global switches — pausing stops automatic sends', keys: ['semaphore', 'brevo'] },
  { title: 'AI Providers', sub: 'Stylist suggestions & business reports', keys: ['gemini', 'groq', 'openrouter'] },
  { title: 'Payments', sub: 'Downpayment gateways (the selector above chooses the active one)', keys: ['paymongo', 'maya'] },
];
const INTEGRATION_BY_KEY = Object.fromEntries(INTEGRATIONS.map((i) => [i.key, i]));

// One-line probe verdict (connection state only — never mixed with the
// kill-switch, so a contradiction like "Offline — Connected" is impossible).
function StatusLine({ status }) {
  if (!status) return <p className="text-[11px] text-gray-400 mt-1">Not checked yet</p>;
  const live = status.configured && status.reachable;
  const sim = status.simulated && !status.configured;
  const invalidKey = !live && !sim && status.detail?.includes('401');
  return (
    <p className="text-[11px] mt-1 truncate font-medium" title={status.detail}>
      <span className={live ? 'text-emerald-600' : sim ? 'text-amber-600' : 'text-red-500'}>
        {live ? 'Connected' : sim ? 'Not configured — simulated' : invalidKey ? 'Invalid key' : 'Offline'}
      </span>
      {live && status.latencyMs != null && <span className="text-gray-400"> · {status.latencyMs}ms</span>}
      {!live && status.detail && !sim && <span className="text-gray-400"> — {status.detail}</span>}
    </p>
  );
}

// Muted secondary probe summary used under the paused note.
function probeSummary(status) {
  if (!status) return 'never checked';
  if (status.configured && status.reachable) {
    return status.latencyMs != null ? `Connected · ${status.latencyMs}ms` : 'Connected';
  }
  if (status.simulated && !status.configured) return 'Not configured (simulated)';
  return status.detail || 'Unreachable';
}

function StatusPill({ status, coldLoading }) {
  const live = status?.configured && status?.reachable;
  const sim = status?.simulated && !status?.configured;
  const err = status && !status.reachable && status.configured;
  return (
    <span className={`shrink-0 flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${
      live ? 'bg-emerald-50 text-emerald-600'
      : sim ? 'bg-amber-50 text-amber-600'
      : err ? 'bg-red-50 text-red-500'
      : 'bg-gray-100 text-gray-400'
    }`}>
      <span className={`relative flex h-2 w-2`}>
        {(live || coldLoading) && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${live ? 'bg-emerald-400' : 'bg-amber-400'}`} />}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${
          live ? 'bg-emerald-500' : sim ? 'bg-amber-400' : err ? 'bg-red-500' : 'bg-gray-300'
        }`} />
      </span>
      {coldLoading && !status ? 'Checking'
        : live ? 'Live'
        : sim ? 'Simulated'
        : err ? 'Error'
        : '—'}
    </span>
  );
}

// Connection-only row (AI + payments): icon, text, probe line, pill.
function ConnectionCard({ name, desc, icon: Icon, iconClass, status, coldLoading }) {
  return (
    <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-gray-50/70 border border-gray-100">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <p className="font-bold text-sm text-gray-900">{name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
          {coldLoading && !status
            ? <p className="text-[11px] text-gray-400 mt-1">Checking…</p>
            : <StatusLine status={status} />}
        </div>
      </div>
      <StatusPill status={status} coldLoading={coldLoading} />
    </div>
  );
}

// Messaging card: the switch is the primary control on top; connection state
// is a secondary line below the divider — and never renders while paused.
function MessagingCard({ name, desc, icon: Icon, iconClass, status, coldLoading, switchOn, onToggle, toggleLabel, pausedHint }) {
  return (
    <div className={`rounded-2xl border p-4 transition-colors ${switchOn ? 'bg-white border-gray-200' : 'bg-gray-50/70 border-gray-100'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${switchOn ? iconClass : 'bg-gray-100 text-gray-400'}`}>
            <Icon size={18} />
          </span>
          <div className="min-w-0">
            <p className="font-bold text-sm text-gray-900">{name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 shrink-0" title={switchOn ? 'Automatic sending is on' : 'Automatic sending is paused globally'}>
          <span className={`text-[10px] font-extrabold uppercase tracking-wide ${switchOn ? 'text-emerald-600' : 'text-gray-400'}`}>
            {switchOn ? 'On' : 'Off'}
          </span>
          <Toggle on={switchOn} onClick={onToggle} label={toggleLabel} />
        </span>
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100">
        {coldLoading && !status ? (
          <p className="text-[11px] text-gray-400">Checking…</p>
        ) : !switchOn ? (
          <p className="text-[11px] font-medium text-gray-500">
            Paused by admin — nothing is being sent. {pausedHint}{' '}
            <span className="text-gray-400">Connection last checked: {probeSummary(status)}</span>
          </p>
        ) : (
          <StatusLine status={status} />
        )}
      </div>
    </div>
  );
}

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
  // Global messaging kill-switches (admin-only, backed by BusinessRule).
  // Absent rule = on. Effective send = global ON && per-account pref ON.
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [switchSaving, setSwitchSaving] = useState(null);
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

  // Read the live rules so the gateway selector AND the kill-switches show
  // the real settings, not guesses.
  useEffect(() => {
    let cancelled = false;
    settingsService.getRules()
      .then((rules) => {
        if (cancelled) return;
        if (rules?.payment_gateway) setGateway(rules.payment_gateway);
        if (rules?.messaging_sms_enabled !== undefined) setSmsEnabled(rules.messaging_sms_enabled !== 'false');
        if (rules?.messaging_email_enabled !== undefined) setEmailEnabled(rules.messaging_email_enabled !== 'false');
      })
      .catch(() => { /* keep the safe defaults */ });
    return () => { cancelled = true; };
  }, []);

  const handleGatewayChange = async (value) => {
    const previous = gateway;
    setGateway(value);
    setGatewaySaving(true);
    try {
      await settingsService.updateRules({ payment_gateway: value });
      toastSuccess(`Downpayments now use ${GATEWAY_LABELS[value] ?? value}.`);
    } catch (err) {
      setGateway(previous);
      toastError(err?.message || 'Could not change the payment gateway.');
    } finally {
      setGatewaySaving(false);
    }
  };

  // Global kill-switch flip (admin-only rule). Optimistic with rollback so
  // the switch never lies; refreshes the status probe so the badge follows.
  const handleMessagingToggle = async (which) => {
    if (switchSaving) return;
    const isSms = which === 'sms';
    const key = isSms ? 'messaging_sms_enabled' : 'messaging_email_enabled';
    const prev = isSms ? smsEnabled : emailEnabled;
    const next = !prev;
    (isSms ? setSmsEnabled : setEmailEnabled)(next);
    setSwitchSaving(which);
    try {
      await settingsService.updateRules({ [key]: next ? 'true' : 'false' });
      toastSuccess(
        next
          ? `${isSms ? 'Automated SMS' : 'Lifecycle emails'} re-enabled.`
          : `${isSms ? 'Automated SMS' : 'Lifecycle emails'} paused globally.${
              isSms ? '' : ' Verification + password-reset emails still send.'
            }`,
      );
      loadIntegrations(true);
    } catch (err) {
      (isSms ? setSmsEnabled : setEmailEnabled)(prev);
      toastError(err?.message || 'Could not change the messaging switch.');
    } finally {
      setSwitchSaving(null);
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
      subtitle="Global switches for automatic messaging, plus live status for AI, SMS, email and payments"
      storageKey="settings-integrations-open"
      badge={
        integrations ? (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] text-[11px] font-bold tabular-nums">
            {INTEGRATIONS.filter(({ key }) => integrations?.[key]?.configured && integrations?.[key]?.reachable && integrations?.[key]?.enabled !== false).length} of {INTEGRATIONS.length} live
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
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-white border border-[#bf4a53]/20">
          <div className="min-w-0">
            <p className="font-bold text-sm text-gray-900">Payment Gateway</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Used for new booking downpayments. Takes effect immediately; existing bookings are unaffected.
            </p>
            {gateway === 'manual' && (
              <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
                Customers pay by scanning your QR and uploading a screenshot for staff review.
              </p>
            )}
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
            <option value="manual">Manual QR (InstaPay / bank app)</option>
          </select>
        </div>
        {gateway === 'manual' && <PaymentQrManager />}
        {GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <div className="flex items-baseline justify-between gap-2 mb-2 px-1">
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest shrink-0">{group.title}</h4>
              <p className="text-[11px] text-gray-400 truncate">{group.sub}</p>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {group.keys.map((key) => {
                const { name, desc, icon, iconClass } = INTEGRATION_BY_KEY[key];
                const status = integrations?.[key];
                const cold = integrationsLoading && !integrations;
                if (key === 'semaphore' || key === 'brevo') {
                  const isSms = key === 'semaphore';
                  return (
                    <MessagingCard
                      key={key}
                      name={name}
                      desc={desc}
                      icon={icon}
                      iconClass={iconClass}
                      status={status}
                      coldLoading={cold}
                      switchOn={isSms ? smsEnabled : emailEnabled}
                      onToggle={() => handleMessagingToggle(isSms ? 'sms' : 'email')}
                      toggleLabel={isSms ? 'Automated SMS kill-switch' : 'Lifecycle email kill-switch'}
                      pausedHint={isSms
                        ? 'Manual staff sends still work.'
                        : 'Verification + password-reset emails still send.'}
                    />
                  );
                }
                return (
                  <ConnectionCard
                    key={key}
                    name={name}
                    desc={desc}
                    icon={icon}
                    iconClass={iconClass}
                    status={status}
                    coldLoading={cold}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </CollapsibleCard>
  );
}