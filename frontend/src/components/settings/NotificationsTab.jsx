import { useState, useEffect } from 'react';
import { Bell, MessageSquare, Pencil, RotateCcw, Check, X, Loader2, Clock, AlertTriangle, Mail } from 'lucide-react';
import { api } from '../../utils/api';
import SettingsCard from './SettingsCard';
import SettingRow from './SettingRow';
import Toggle from './Toggle';
import { SkeletonList } from '../Skeleton';
import { LS_NOTIF, DEFAULT_NOTIF, loadJSON } from './constants';

const TEMPLATE_KEYS = ['booking_confirmation', 'due_reminder', 'late_return'];

const TEMPLATE_LABELS = {
  booking_confirmation: 'Booking Confirmation',
  due_reminder: 'Due Reminder',
  late_return: 'Late Return',
};

const AVAILABLE_PLACEHOLDERS = '{customer}, {item}, {date}, {days}';

// Stock messages (mirror backend/prisma/seed.ts) — Reset restores these so a
// template can never be deleted into a silent-SMS state; services fall back to
// the same text when no row exists.
const DEFAULT_TEMPLATES = {
  booking_confirmation: 'Hi {customer}, your booking for {item} is confirmed! Pickup date: {date}. Rental period: 3 days. Thank you for choosing Mylene\'s Boutique!',
  due_reminder: 'Hi {customer}, this is a reminder that your rental of {item} is due on {date}. Please return on time. Thank you!',
  late_return: 'Hi {customer}, your rental of {item} is now overdue ({days} day(s)). Please return as soon as possible. Thank you!',
};

// Admin Notifications tab: this admin account's own SMS/email prefs + the
// editable SMS templates (backed by the sms-templates table). These toggles
// are per-account — customer messaging is controlled on each customer's profile.
export default function NotificationsTab({ profile }) {
  // Notification Preferences (profile-backed; falls back to localStorage default)
  const [notifPrefs, setNotifPrefs] = useState(() =>
    (profile?.notifyPrefs && typeof profile.notifyPrefs === 'object')
      ? { ...DEFAULT_NOTIF, ...profile.notifyPrefs }
      : loadJSON(LS_NOTIF, DEFAULT_NOTIF));
  const [notifMsg, setNotifMsg] = useState('');

  // SMS Templates state – array of { id, name, content } from backend
  const [backendTemplates, setBackendTemplates] = useState([]);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [templateEditValue, setTemplateEditValue] = useState('');
  const [templateSaveMsg, setTemplateSaveMsg] = useState('');
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(null);
  const [activeTemplateTab, setActiveTemplateTab] = useState('booking_confirmation');

  useEffect(() => {
    setTemplatesLoading(true);
    api.get('/settings/sms-templates')
      .then(data => {
        if (Array.isArray(data)) {
          setBackendTemplates(data);
        }
      })
      .catch(() => {})
      .finally(() => setTemplatesLoading(false));
  }, []);

  // Effective content: saved row wins, otherwise the stock default (never blank).
  const templateContent = {};
  for (const key of TEMPLATE_KEYS) {
    const saved = backendTemplates.find((t) => t.name === key)?.content;
    templateContent[key] = saved || DEFAULT_TEMPLATES[key];
  }
  const isCustomized = (key) => !!backendTemplates.find((t) => t.name === key)?.content;

  // Look up backend template record by name
  const findBackend = (name) => backendTemplates.find(t => t.name === name);

  const toggleNotif = (key) => {
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    localStorage.setItem(LS_NOTIF, JSON.stringify(next));
    setNotifPrefs(next);
    setNotifMsg('Preferences updated!');
    // Persist to the profile so the SMS scheduler honors the opt-out.
    api.put('/auth/me', { notifyPrefs: next }).catch(() => {});
    setTimeout(() => setNotifMsg(''), 2000);
  };

  const startEditTemplate = (key) => {
    setEditingTemplate(key);
    setTemplateEditValue(templateContent[key] || '');
    setTemplateSaveMsg('');
  };

  const cancelEditTemplate = () => {
    setEditingTemplate(null);
    setTemplateEditValue('');
  };

  // FIX E2: only report success after the request resolves; surface failures.
  const saveTemplate = async (key) => {
    const existing = findBackend(key);
    const content = templateEditValue.trim();
    if (!content) {
      setTemplateSaveMsg('Template cannot be empty — Reset restores the stock message instead.');
      setTimeout(() => setTemplateSaveMsg(''), 2500);
      return;
    }
    setTemplateSaveMsg('');
    setSavingKey(key);
    try {
      if (existing) {
        await api.put(`/settings/sms-templates/${existing.id}`, { content });
      } else {
        await api.post('/settings/sms-templates', { name: key, content });
      }
      const data = await api.get('/settings/sms-templates').catch(() => null);
      if (Array.isArray(data)) setBackendTemplates(data);
      setEditingTemplate(null);
      setTemplateSaveMsg(`Template '${key}' saved!`);
    } catch (err) {
      setTemplateSaveMsg(`Failed to save '${key}': ${err?.message || 'server error'}`);
    } finally {
      setSavingKey(null);
    }
    setTimeout(() => setTemplateSaveMsg(''), 2500);
  };

  // Reset restores the stock message (overwrites any custom content with the
  // default). Templates are never deleted — the services would silently fall
  // back anyway, so the visible state always matches what customers receive.
  const resetTemplate = async (key) => {
    const existing = findBackend(key);
    setTemplateSaveMsg('');
    setSavingKey(key);
    try {
      const content = DEFAULT_TEMPLATES[key];
      if (existing) {
        await api.put(`/settings/sms-templates/${existing.id}`, { content });
      } else {
        await api.post('/settings/sms-templates', { name: key, content });
      }
      const data = await api.get('/settings/sms-templates').catch(() => null);
      if (Array.isArray(data)) setBackendTemplates(data);
      if (editingTemplate === key) setTemplateEditValue(content);
      setTemplateSaveMsg(`'${key}' reset to the stock message.`);
    } catch (err) {
      setTemplateSaveMsg(`Failed to reset '${key}': ${err?.message || 'server error'}`);
    } finally {
      setSavingKey(null);
    }
    setTimeout(() => setTemplateSaveMsg(''), 2500);
  };

  const resetAllTemplates = async () => {
    setTemplateSaveMsg('');
    setSavingKey('__all');
    try {
      for (const key of TEMPLATE_KEYS) {
        const existing = findBackend(key);
        const content = DEFAULT_TEMPLATES[key];
        if (existing) {
          await api.put(`/settings/sms-templates/${existing.id}`, { content });
        } else {
          await api.post('/settings/sms-templates', { name: key, content });
        }
      }
      const data = await api.get('/settings/sms-templates').catch(() => null);
      if (Array.isArray(data)) setBackendTemplates(data);
      setEditingTemplate(null);
      setTemplateSaveMsg('All templates reset to stock messages.');
    } catch (err) {
      setTemplateSaveMsg(`Failed to reset templates: ${err?.message || 'server error'}`);
    } finally {
      setSavingKey(null);
    }
    setTimeout(() => setTemplateSaveMsg(''), 2500);
  };

  return (
    <>
      {/* Notification Preferences — this account only */}
      <SettingsCard
        icon={Bell}
        iconClass="bg-red-50 text-[#bf4a53]"
        title="My Notification Preferences"
        desc="Which automated SMS and emails this account receives. Customer messaging is controlled on each customer's own profile."
      >
        {/* Mobile-first: single column → 2-col on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { key: 'booking', label: 'Booking Confirmation', desc: 'SMS you receive when one of your rentals is created.', icon: Bell, colors: 'bg-red-50 text-[#bf4a53]' },
            { key: 'reminder', label: 'Due Reminder', desc: 'Reminders you receive before your due date.', icon: Clock, colors: 'bg-amber-50 text-amber-600' },
            { key: 'lateReturn', label: 'Late Return Alert', desc: 'Overdue alerts you receive for your rentals.', icon: AlertTriangle, colors: 'bg-orange-50 text-orange-600' },
            { key: 'email', label: 'Brevo Emails', desc: 'Emails sent to you alongside SMS.', icon: Mail, colors: 'bg-blue-50 text-blue-600' },
          ].map(({ key, label, desc, icon: Icon, colors }) => (
            <button
              key={key}
              onClick={() => toggleNotif(key)}
              className={`flex items-center gap-3.5 p-4 rounded-2xl border transition-all text-left ${
                notifPrefs[key]
                  ? 'border-gray-200 bg-white hover:shadow-sm'
                  : 'border-gray-100 bg-gray-50/60'
              }`}
            >
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${colors}`}>
                <Icon size={18} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{label}</p>
                <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{desc}</p>
              </div>
              <Toggle on={notifPrefs[key]} onClick={() => toggleNotif(key)} />
            </button>
          ))}
        </div>
        {notifMsg && <p className="text-xs text-emerald-600 font-bold">{notifMsg}</p>}
      </SettingsCard>

      {/* SMS Templates */}
      <SettingsCard
        icon={MessageSquare}
        iconClass="bg-blue-50 text-blue-600"
        title="SMS Templates"
        desc="Customize the SMS customers receive — placeholders are filled in automatically"
        action={
          <button
            onClick={resetAllTemplates}
            disabled={savingKey === '__all'}
            className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800 active:scale-[0.97] transition-all disabled:opacity-50"
            title="Restore all three stock messages"
          >
            {savingKey === '__all'
              ? <Loader2 size={12} className="animate-spin" />
              : <RotateCcw size={12} />}
            {savingKey === '__all' ? 'Resetting…' : 'Reset all'}
          </button>
        }
      >
        {/* Placeholder chips — shared on both layouts */}
        <div className="flex flex-wrap items-center gap-1.5 bg-gray-50 rounded-2xl px-4 py-3">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Placeholders:</span>
          {AVAILABLE_PLACEHOLDERS.split(',').map((p) => (
            <code key={p} className="px-2 py-0.5 bg-white border border-gray-200 rounded-lg font-mono text-[11px] text-gray-600">{p.trim()}</code>
          ))}
        </div>

        {templatesLoading ? (
          <SkeletonList count={3} />
        ) : (
          <>
            {/* Mobile: card grid */}
            <div className="grid gap-4 md:hidden">
              {TEMPLATE_KEYS.map((key) => {
                const editing = editingTemplate === key;
                const customized = isCustomized(key);
                const busy = savingKey === key;
                return (
                  <div key={key} className="border border-gray-200 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-gray-900 truncate flex-1">{TEMPLATE_LABELS[key]}</h4>
                      {customized
                        ? <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full shrink-0">Custom</span>
                        : <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">Stock</span>}
                    </div>
                    <p className="text-[11px] font-mono text-gray-400">{key}</p>
                    {editing ? (
                      <textarea
                        value={templateEditValue}
                        onChange={(e) => setTemplateEditValue(e.target.value)}
                        placeholder="Type the SMS template content here..."
                        rows={4}
                        autoFocus
                        className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm min-h-[100px] focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/20 transition-all"
                      />
                    ) : (
                      <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-xl whitespace-pre-wrap leading-relaxed">{templateContent[key]}</p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {editing ? (
                        <>
                          <button
                            onClick={cancelEditTemplate}
                            disabled={busy}
                            className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 active:scale-[0.99] transition-all disabled:opacity-50"
                          >
                            <X size={13} /> Cancel
                          </button>
                          <button
                            onClick={() => saveTemplate(key)}
                            disabled={busy}
                            className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold text-white bg-[#bf4a53] hover:bg-red-700 active:scale-[0.99] transition-all disabled:opacity-50"
                          >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            {busy ? 'Saving…' : 'Save'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditTemplate(key)}
                            className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold text-gray-700 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 active:scale-[0.99] transition-all"
                          >
                            <Pencil size={13} /> Edit
                          </button>
                          <button
                            onClick={() => resetTemplate(key)}
                            disabled={busy}
                            className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold text-gray-500 bg-gray-50 hover:bg-gray-100 hover:text-gray-700 active:scale-[0.99] transition-all disabled:opacity-50"
                            title="Restore the stock message"
                          >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                            {busy ? 'Resetting…' : 'Reset'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: tabbed editor */}
            <div className="hidden md:block">
              {/* Tab bar */}
              <div className="flex gap-2 mb-4">
                {TEMPLATE_KEYS.map((key) => {
                  const customized = isCustomized(key);
                  const isActive = activeTemplateTab === key;
                  return (
                    <button
                      key={key}
                      onClick={() => { setActiveTemplateTab(key); if (editingTemplate === key) cancelEditTemplate(); }}
                      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                        isActive
                          ? 'bg-[#bf4a53] text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800'
                      }`}
                    >
                      {TEMPLATE_LABELS[key]}
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : customized
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-gray-200 text-gray-500'
                      }`}>
                        {customized ? 'Custom' : 'Stock'}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Editor panel */}
              {(() => {
                const key = activeTemplateTab;
                const editing = editingTemplate === key;
                const busy = savingKey === key;
                return (
                  <div className="border border-gray-200 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-gray-900">{TEMPLATE_LABELS[key]}</h4>
                      <code className="text-[11px] font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded-lg">{key}</code>
                    </div>
                    {editing ? (
                      <textarea
                        value={templateEditValue}
                        onChange={(e) => setTemplateEditValue(e.target.value)}
                        placeholder="Type the SMS template content here..."
                        rows={4}
                        autoFocus
                        className="w-full p-4 bg-white border border-gray-200 rounded-xl text-sm min-h-[120px] focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/20 transition-all leading-relaxed"
                      />
                    ) : (
                      <p className="text-sm text-gray-700 bg-gray-50 p-4 rounded-xl whitespace-pre-wrap leading-relaxed min-h-[120px]">
                        {templateContent[key]}
                      </p>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      {editing ? (
                        <>
                          <button
                            onClick={cancelEditTemplate}
                            disabled={busy}
                            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 active:scale-[0.99] transition-all disabled:opacity-50"
                          >
                            <X size={13} /> Cancel
                          </button>
                          <button
                            onClick={() => saveTemplate(key)}
                            disabled={busy}
                            className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-[#bf4a53] hover:bg-red-700 active:scale-[0.99] transition-all disabled:opacity-50"
                          >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            {busy ? 'Saving…' : 'Save'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditTemplate(key)}
                            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-gray-700 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 active:scale-[0.99] transition-all"
                          >
                            <Pencil size={13} /> Edit
                          </button>
                          <button
                            onClick={() => resetTemplate(key)}
                            disabled={busy}
                            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-gray-500 bg-gray-50 hover:bg-gray-100 hover:text-gray-700 active:scale-[0.99] transition-all disabled:opacity-50"
                            title="Restore the stock message"
                          >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                            {busy ? 'Resetting…' : 'Reset'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </>
        )}
        {templateSaveMsg && <p className="text-xs text-emerald-600 font-bold">{templateSaveMsg}</p>}
      </SettingsCard>
    </>
  );
}