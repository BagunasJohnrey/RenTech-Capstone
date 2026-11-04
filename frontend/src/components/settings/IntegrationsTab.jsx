import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, MessageSquare, RefreshCw, Sparkles, Mail } from 'lucide-react';
import { settingsService } from '../../services/settings';
import { useToast } from '../Toast';
import { readCache, writeCache, formatCheckedAgo, CACHE_KEYS } from '../../utils/cache';
import CollapsibleCard from './CollapsibleCard';
import Toggle from './Toggle';
import PaymentQrManager from './PaymentQrManager';

const INTEGRATIONS = [
  { key: 'gemini', name: 'Gemini AI Stylist', desc: 'Primary AI for outfit suggestions & business insights.', icon: Sparkles, iconClass: 'bg-purple-50 text-purple-600' },
  { key: 'groq', name: 'Groq AI', desc: 'Backup AI for the stylist & reports when Gemini is down.', icon: Sparkles, iconClass: 'bg-violet-50 text-violet-600' },
  { key: 'semaphore', name: 'Semaphore SMS Gateway', desc: 'Booking confirmations, due & overdue reminders.', icon: MessageSquare, iconClass: 'bg-blue-50 text-blue-600' },
  { key: 'resend', name: 'Resend Email', desc: 'Booking, pickup, return & reminder emails.', icon: Mail, iconClass: 'bg-rose-50 text-[#bf4a53]' },
];

// Card groups render in this order (badge count still uses INTEGRATIONS).
const GROUPS = [
  { title: 'Automatic Messaging', sub: 'Global switches — off pauses automatic sends only', keys: ['semaphore', 'resend'] },
  { title: 'AI Providers', sub: 'Stylist suggestions & business reports', keys: ['gemini', 'groq'] },
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

// Connection-only card (AI providers): name + pill on top, description and
// probe line below — stacks cleanly in the 3-across desktop grid.
function ConnectionCard({ name, desc, icon: Icon, iconClass, status, coldLoading }) {
  return (
    <div className="p-4 rounded-2xl bg-gray-50/70 border border-gray-100 min-w-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>
            <Icon size={18} />
          </span>
          <p className="font-bold text-sm text-gray-900 min-w-0">{name}</p>
        </div>
        <StatusPill status={status} coldLoading={coldLoading} />
      </div>
      <p className="text-xs text-gray-500 mt-2.5">{desc}</p>
      {coldLoading && !status
        ? <p className="text-[11px] text-gray-400 mt-1">Checking…</p>
        : <StatusLine status={status} />}
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
          <span className={`hidden sm:inline text-[10px] font-extrabold uppercase tracking-wide ${switchOn ? 'text-emerald-600' : 'text-gray-400'}`}>
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

  // Read the live rules so the messaging kill-switches show the real
  // settings, not guesses.
  useEffect(() => {
    let cancelled = false;
    settingsService.getRules()
      .then((rules) => {
        if (cancelled) return;
        if (rules?.messaging_sms_enabled !== undefined) setSmsEnabled(rules.messaging_sms_enabled !== 'false');
        if (rules?.messaging_email_enabled !== undefined) setEmailEnabled(rules.messaging_email_enabled !== 'false');
      })
      .catch(() => { /* keep the safe defaults */ });
    return () => { cancelled = true; };
  }, []);


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
  const liveLabel = integrations
    ? `${INTEGRATIONS.filter(({ key }) => integrations?.[key]?.configured && integrations?.[key]?.reachable && integrations?.[key]?.enabled !== false).length} of ${INTEGRATIONS.length} live`
    : null;
  const statusLabel = integrations
    ? (integrationsLoading ? `Refreshing… · Status ${formatCheckedAgo(probeAt)}` : `Status ${formatCheckedAgo(probeAt)}`)
    : null;

  return (
    <CollapsibleCard
      icon={ShieldCheck}
      iconClass="bg-emerald-50 text-emerald-600"
      title="System Integrations"
      subtitle="QR payments, messaging switches and live service status"
      storageKey="settings-integrations-open"
      badge={liveLabel ? (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] text-[11px] font-bold tabular-nums">
          {liveLabel}
        </span>
      ) : null}
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
            aria-label="Refresh status"
            className="shrink-0 flex items-center justify-center gap-1.5 text-xs font-bold px-4 py-2.5 min-h-[44px] rounded-full bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={integrationsLoading ? 'animate-spin' : ''} />
            <span>{integrationsLoading ? (integrations ? 'Refreshing…' : 'Checking…') : 'Refresh'}</span>
          </button>
        </div>
      }
    >
      {statusLabel && (
        <div className="lg:hidden flex flex-wrap items-center gap-x-2 gap-y-1 -mt-1 mb-4">
          {statusLabel && <span className="text-[11px] font-semibold text-gray-400 tabular-nums">{statusLabel}</span>}
        </div>
      )}
      <div className="space-y-5">
        <PaymentQrManager />
        {GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 sm:gap-2 mb-2 px-1">
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest shrink-0">{group.title}</h4>
              <p className="text-[11px] text-gray-400 sm:truncate">{group.sub}</p>
            </div>
            <div className={`grid gap-3 lg:grid-cols-2 ${group.keys.length === 3 ? 'xl:grid-cols-3' : ''}`}>
              {group.keys.map((key) => {
                const { name, desc, icon, iconClass } = INTEGRATION_BY_KEY[key];
                const status = integrations?.[key];
                const cold = integrationsLoading && !integrations;
                if (key === 'semaphore' || key === 'resend') {
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
