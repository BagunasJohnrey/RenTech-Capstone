import { useState, useEffect } from 'react';
import { ShieldCheck, MessageSquare, CreditCard, RefreshCw, Sparkles } from 'lucide-react';
import { settingsService } from '../../services/settings';
import SettingsCard from './SettingsCard';

const INTEGRATIONS = [
  { key: 'gemini', name: 'Gemini AI Stylist', desc: 'Primary AI for outfit suggestions & business insights.', icon: Sparkles, iconClass: 'bg-purple-50 text-purple-600' },
  { key: 'groq', name: 'Groq AI', desc: 'Low-latency AI fallback (tier 2) for stylist & reports.', icon: Sparkles, iconClass: 'bg-violet-50 text-violet-600' },
  { key: 'openrouter', name: 'OpenRouter AI', desc: 'Free-model AI fallback (tier 3) for stylist & reports.', icon: Sparkles, iconClass: 'bg-fuchsia-50 text-fuchsia-600' },
  { key: 'semaphore', name: 'Semaphore SMS Gateway', desc: 'Automated return reminders & booking confirmations.', icon: MessageSquare, iconClass: 'bg-blue-50 text-blue-600' },
  { key: 'paymongo', name: 'PayMongo Payments', desc: 'Secure GCash & Credit Card downpayments.', icon: CreditCard, iconClass: 'bg-emerald-50 text-emerald-600' },
];

// Admin Integrations tab: live connectivity status for AI, SMS and payments.
export default function IntegrationsTab() {
  const [integrations, setIntegrations] = useState(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);

  const loadIntegrations = async () => {
    setIntegrationsLoading(true);
    try {
      const data = await settingsService.getIntegrationsStatus();
      setIntegrations(data);
    } catch {
      setIntegrations(null);
    } finally {
      setIntegrationsLoading(false);
    }
  };

  useEffect(() => {
    loadIntegrations();
  }, []);

  return (
    <SettingsCard
      icon={ShieldCheck}
      iconClass="bg-emerald-50 text-emerald-600"
      title="System Integrations"
      desc="Live connectivity status for AI, SMS and payments"
      action={
        <button
          onClick={loadIntegrations}
          disabled={integrationsLoading}
          className="shrink-0 flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-full bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={integrationsLoading ? 'animate-spin' : ''} />
          {integrationsLoading ? 'Checking…' : 'Refresh'}
        </button>
      }
    >
      <div className="space-y-3">
        {INTEGRATIONS.map(({ key, name, desc, icon: Icon, iconClass }) => {
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
                  {integrationsLoading && !status ? (
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
                  {(online || integrationsLoading) && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${online ? 'bg-emerald-400' : 'bg-amber-400'}`} />}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${
                    online ? 'bg-emerald-500' : simulated ? 'bg-amber-400' : offline ? 'bg-red-500' : 'bg-gray-300'
                  }`} />
                </span>
                {integrationsLoading && !status ? 'Checking'
                  : online ? 'Live'
                  : simulated ? 'Simulated'
                  : offline ? 'Error'
                  : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </SettingsCard>
  );
}