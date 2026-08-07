import { useState, useEffect } from 'react';
import { Bell, MessageSquare } from 'lucide-react';
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

// Admin Notifications tab: which automated SMS the boutique sends + the
// editable SMS templates (backed by the sms-templates table).
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

  // Build template map from backend only (no mock fallback)
  const templateContent = {};
  for (const t of backendTemplates) {
    templateContent[t.name] = t.content;
  }

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
    setTemplateSaveMsg('');
    try {
      if (existing) {
        await api.put(`/settings/sms-templates/${existing.id}`, { content: templateEditValue });
      } else {
        await api.post('/settings/sms-templates', { name: key, content: templateEditValue });
      }
      const data = await api.get('/settings/sms-templates').catch(() => null);
      if (Array.isArray(data)) setBackendTemplates(data);
      setEditingTemplate(null);
      setTemplateSaveMsg(`Template '${key}' saved!`);
    } catch (err) {
      setTemplateSaveMsg(`Failed to save '${key}': ${err?.message || 'server error'}`);
    }
    setTimeout(() => setTemplateSaveMsg(''), 2500);
  };

  const resetTemplate = async (key) => {
    const existing = findBackend(key);
    setTemplateSaveMsg('');
    try {
      if (existing) {
        await api.delete(`/settings/sms-templates/${existing.id}`);
        setBackendTemplates(backendTemplates.filter((t) => t.id !== existing.id));
      }
      setTemplateSaveMsg(`'${key}' cleared.`);
    } catch (err) {
      setTemplateSaveMsg(`Failed to clear '${key}': ${err?.message || 'server error'}`);
    }
    setTimeout(() => setTemplateSaveMsg(''), 2500);
  };

  const resetAllTemplates = async () => {
    setTemplateSaveMsg('');
    try {
      for (const t of backendTemplates) {
        await api.delete(`/settings/sms-templates/${t.id}`);
      }
      setBackendTemplates([]);
      setEditingTemplate(null);
      setTemplateSaveMsg('All templates cleared.');
    } catch (err) {
      setTemplateSaveMsg(`Failed to clear templates: ${err?.message || 'server error'}`);
    }
    setTimeout(() => setTemplateSaveMsg(''), 2500);
  };

  return (
    <>
      {/* Notification Preferences */}
      <SettingsCard
        icon={Bell}
        iconClass="bg-red-50 text-[#bf4a53]"
        title="Notification Preferences"
        desc="Which automated SMS the boutique sends out"
      >
        <div className="space-y-3 max-w-2xl">
          {[
            { key: 'booking', label: 'Booking Confirmation', desc: 'SMS when a new rental is created.' },
            { key: 'reminder', label: 'Due Reminder', desc: 'Remind customer 1 day before due date.' },
            { key: 'lateReturn', label: 'Late Return Alert', desc: 'Notify when a rental becomes overdue.' },
          ].map(({ key, label, desc }) => (
            <SettingRow key={key} label={label} desc={desc}>
              <Toggle on={notifPrefs[key]} onClick={() => toggleNotif(key)} />
            </SettingRow>
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
          <button onClick={resetAllTemplates} className="shrink-0 text-xs font-bold text-red-500 hover:text-red-600">Clear all</button>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5 bg-gray-50 rounded-2xl px-4 py-3">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Placeholders:</span>
          {AVAILABLE_PLACEHOLDERS.split(',').map((p) => (
            <code key={p} className="px-2 py-0.5 bg-white border border-gray-200 rounded-lg font-mono text-[11px] text-gray-600">{p.trim()}</code>
          ))}
        </div>
        {templatesLoading ? (
          <SkeletonList count={3} />
        ) : TEMPLATE_KEYS.map((key) => (
          <div key={key} className="border border-gray-200 rounded-2xl p-4 md:p-5">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-3">
              <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                {TEMPLATE_LABELS[key]}
                <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{key}</span>
              </h4>
              <div className="flex gap-2">
                {editingTemplate === key ? (
                  <>
                    <button onClick={cancelEditTemplate} className="text-xs font-semibold text-gray-500 hover:underline">Cancel</button>
                    <button onClick={() => saveTemplate(key)} className="text-xs font-semibold text-[#bf4a53] hover:underline">Save</button>
                  </>
                ) : (
                  <button onClick={() => startEditTemplate(key)} className="text-xs font-semibold text-[#bf4a53] hover:underline">Edit</button>
                )}
                <button onClick={() => resetTemplate(key)} className="text-xs font-semibold text-gray-400 hover:text-gray-600">Clear</button>
              </div>
            </div>
            {editingTemplate === key ? (
              <textarea
                value={templateEditValue}
                onChange={(e) => setTemplateEditValue(e.target.value)}
                placeholder="Type the SMS template content here..."
                className="w-full p-3 bg-gray-50 rounded-xl border text-sm min-h-[100px] focus:outline-none focus:border-[#bf4a53]"
              />
            ) : templateContent[key] ? (
              <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-xl whitespace-pre-wrap">{templateContent[key]}</p>
            ) : (
              <p className="text-sm text-gray-400 bg-gray-50 p-3 rounded-xl italic">No template saved yet. Click Edit to create one.</p>
            )}
          </div>
        ))}
        {templateSaveMsg && <p className="text-xs text-emerald-600 font-bold">{templateSaveMsg}</p>}
      </SettingsCard>
    </>
  );
}