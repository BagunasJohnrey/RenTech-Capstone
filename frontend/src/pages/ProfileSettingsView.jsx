import { useState, useEffect } from 'react';
import { User, ShieldCheck, Plus, Trash2, Users, LogOut, MessageSquare, AlertCircle, Building2, DollarSign, Bell, Ruler, Tag, RefreshCw, Key, Copy } from 'lucide-react';
import { api } from '../utils/api';
import PromoCodesManager from '../components/PromoCodesManager';
import { SkeletonList } from '../components/Skeleton';
import HelpGuide from './HelpGuide';
import { promoService } from '../services/promo';
import { settingsService } from '../services/settings';
import { SIZE_PRESETS } from '../utils/sizePresets';

const ITEM_TYPES = ['Gown', 'Suit', 'Barong', 'Filipiniana', 'Costume'];

const LS_BUSINESS = 'rental_business_profile';
const LS_POLICIES = 'rental_policies';
const LS_NOTIF = 'rental_notif_prefs';
const LS_SIZES = 'rentech_pref_sizes';

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

const DEFAULT_BUSINESS = { name: 'RenTech Boutique', address: '', contact: '', taxId: '' };
const DEFAULT_POLICIES = { defaultDays: 3, latePenalty: 500, depositPct: 50 };
const DEFAULT_NOTIF = { booking: true, reminder: true, lateReturn: true };

const TEMPLATE_KEYS = ['booking_confirmation', 'due_reminder', 'late_return'];

const TEMPLATE_LABELS = {
  booking_confirmation: 'Booking Confirmation',
  due_reminder: 'Due Reminder',
  late_return: 'Late Return',
};

export default function ProfileSettingsView({
  role,
  profile,
  staffList,
  onAddStaff,
  onRemoveStaff,
  customerInfo,
  onUpdateCustomer,
  onRequestLogout,
}) {
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newStaffName, setNewStaffName] = useState('');
  const [staffError, setStaffError] = useState('');
  const [editCustomer, setEditCustomer] = useState(false);
  const [localCustomer, setLocalCustomer] = useState(customerInfo || { name: '', contact: '', address: '', preferences: [], styleNotes: '' });
  const [saveMessage, setSaveMessage] = useState('');

  // Customer-specific settings
  const [prefSizes, setPrefSizes] = useState(() => loadJSON(LS_SIZES, []));
  const [sizesMsg, setSizesMsg] = useState('');
  const [styleNotes, setStyleNotes] = useState(customerInfo?.styleNotes || '');
  const [styleMsg, setStyleMsg] = useState('');
  const [myPromos, setMyPromos] = useState([]);

  // Phase 5: MFA management (Admin only)
  const [mfaStep, setMfaStep] = useState(profile?.mfaEnabled ? 'enabled' : 'idle');
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaQrUri, setMfaQrUri] = useState('');
  const [mfaQrDataUri, setMfaQrDataUri] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBackupCodes, setMfaBackupCodes] = useState([]);
  const [mfaError, setMfaError] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);

  const handleMfaSetup = async () => {
    setMfaError('');
    setMfaLoading(true);
    try {
      const res = await api.post('/auth/mfa/setup');
      setMfaSecret(res.secret);
      setMfaQrUri(res.qrUri);
      setMfaQrDataUri(res.qrDataUri || '');
      setMfaStep('setup');
    } catch (err) {
      setMfaError(err?.message || 'Failed to set up MFA');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleMfaEnable = async () => {
    setMfaError('');
    if (mfaCode.length !== 6) {
      setMfaError('Please enter the 6-digit code from your authenticator app');
      return;
    }
    setMfaLoading(true);
    try {
      // Server generates cryptographically random backup codes; we don't send
      // client-generated ones. They're shown once — save them.
      const res = await api.post('/auth/mfa/enable', { code: mfaCode });
      setMfaBackupCodes(res.backupCodes || []);
      setMfaStep('backupCodes'); // new step: show generated backup codes
      setMfaError('');
      if (profile) profile.mfaEnabled = true;
    } catch (err) {
      setMfaError(err?.message || 'Failed to enable MFA');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleMfaDisable = async () => {
    setMfaError('');
    setMfaLoading(true);
    try {
      await api.post('/auth/mfa/disable');
      setMfaStep('idle');
      setMfaSecret('');
      setMfaQrUri('');
      setMfaQrDataUri('');
      if (profile) profile.mfaEnabled = false;
    } catch (err) {
      setMfaError(err?.message || 'Failed to disable MFA');
    } finally {
      setMfaLoading(false);
    }
  };

  const copyBackupCodes = async () => {
    if (!mfaBackupCodes.length) return;
    try {
      await navigator.clipboard.writeText(mfaBackupCodes.join('\n'));
    } catch {
      // clipboard API unavailable — just leave the codes visible for manual copy
    }
  };

  // (Backup codes are generated server-side on /auth/mfa/enable and shown once.)

  // Load active promo codes for customers to discover available discounts.
  useEffect(() => {
    if (role !== 'Customer') return;
    let active = true;
    promoService.listPublic()
      .then((d) => { if (active && Array.isArray(d)) setMyPromos(d); })
      .catch(() => {});
    return () => { active = false; };
  }, [role]);

  // Business Profile
  const [business, setBusiness] = useState(() => loadJSON(LS_BUSINESS, DEFAULT_BUSINESS));
  const [editBusiness, setEditBusiness] = useState(false);
  const [localBusiness, setLocalBusiness] = useState(business);
  const [bizMsg, setBizMsg] = useState('');

  // Rental Policies
  const [policies, setPolicies] = useState(() => loadJSON(LS_POLICIES, DEFAULT_POLICIES));
  const [editPolicies, setEditPolicies] = useState(false);
  const [localPolicies, setLocalPolicies] = useState(policies);
  const [polMsg, setPolMsg] = useState('');

  // Notification Preferences (profile-backed; falls back to localStorage default)
  const [notifPrefs, setNotifPrefs] = useState(() =>
    (profile?.notifyPrefs && typeof profile.notifyPrefs === 'object')
      ? { ...DEFAULT_NOTIF, ...profile.notifyPrefs }
      : loadJSON(LS_NOTIF, DEFAULT_NOTIF));
  const [notifMsg, setNotifMsg] = useState('');

  // Live integrations health (Admin) — Gemini / Semaphore / PayMongo.
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
    if (role === 'Admin') loadIntegrations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Load business rules from backend on mount
  useEffect(() => {
    if (role === 'Customer') return;
    api.get('/settings/rules').then(rules => {
      if (!rules) return;
      const biz = { ...business };
      if (rules.business_name) biz.name = rules.business_name;
      if (rules.business_address) biz.address = rules.business_address;
      if (rules.business_contact) biz.contact = rules.business_contact;
      if (rules.business_tax_id) biz.taxId = rules.business_tax_id;
      setBusiness(biz);
      setLocalBusiness(biz);
      localStorage.setItem(LS_BUSINESS, JSON.stringify(biz));

      const pol = { ...policies };
      if (rules.default_days) pol.defaultDays = parseInt(rules.default_days) || pol.defaultDays;
      if (rules.late_penalty) pol.latePenalty = parseInt(rules.late_penalty) || pol.latePenalty;
      if (rules.deposit_pct) pol.depositPct = parseInt(rules.deposit_pct) || pol.depositPct;
      setPolicies(pol);
      setLocalPolicies(pol);
      localStorage.setItem(LS_POLICIES, JSON.stringify(pol));
    }).catch(() => {});
  }, [role]);

  const syncRulesToBackend = async (updates) => {
    try {
      await api.put('/settings/rules', updates);
    } catch { /* backend sync is best-effort */ }
  };

  const saveBusiness = () => {
    localStorage.setItem(LS_BUSINESS, JSON.stringify(localBusiness));
    setBusiness(localBusiness);
    setEditBusiness(false);
    setBizMsg('Business profile saved!');
    syncRulesToBackend({
      business_name: localBusiness.name,
      business_address: localBusiness.address,
      business_contact: localBusiness.contact,
      business_tax_id: localBusiness.taxId,
    });
    setTimeout(() => setBizMsg(''), 2000);
  };

  const savePolicies = () => {
    localStorage.setItem(LS_POLICIES, JSON.stringify(localPolicies));
    setPolicies(localPolicies);
    setEditPolicies(false);
    setPolMsg('Rental policies saved!');
    syncRulesToBackend({
      default_days: String(localPolicies.defaultDays),
      late_penalty: String(localPolicies.latePenalty),
      deposit_pct: String(localPolicies.depositPct),
    });
    setTimeout(() => setPolMsg(''), 2000);
  };

  const toggleNotif = (key) => {
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    localStorage.setItem(LS_NOTIF, JSON.stringify(next));
    setNotifPrefs(next);
    setNotifMsg('Preferences updated!');
    // Persist to the profile so the SMS scheduler honors the opt-out.
    api.put('/auth/me', { notifyPrefs: next }).catch(() => {});
    setTimeout(() => setNotifMsg(''), 2000);
  };

  // SMS Templates state – array of { id, name, content } from backend
  const [backendTemplates, setBackendTemplates] = useState([]);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [templateEditValue, setTemplateEditValue] = useState('');
  const [templateSaveMsg, setTemplateSaveMsg] = useState('');
  const [templatesLoading, setTemplatesLoading] = useState(false);

  useEffect(() => {
    if (role !== 'Admin') return;
    setTemplatesLoading(true);
    api.get('/settings/sms-templates')
      .then(data => {
        if (Array.isArray(data)) {
          setBackendTemplates(data);
        }
      })
      .catch(() => {})
      .finally(() => setTemplatesLoading(false));
  }, [role]);

  // Build template map from backend only (no mock fallback)
  const templateContent = {};
  for (const t of backendTemplates) {
    templateContent[t.name] = t.content;
  }

  // Look up backend template record by name
  const findBackend = (name) => backendTemplates.find(t => t.name === name);

  const handleAddStaff = async (e) => {
    e.preventDefault();
    setStaffError('');
    if (!newUsername || !newPassword) return;
    if (newPassword.length < 12) {
      setStaffError('Password must be at least 12 characters with upper, lower, digit, and symbol');
      return;
    }
    try {
      await     onAddStaff({ email: newUsername, password: newPassword, name: newStaffName || newUsername });
      setNewUsername('');
      setNewPassword('');
      setNewStaffName('');
    } catch {
      setStaffError('Failed to add staff. Check the email format or try a different password.');
    }
  };

  const handleSaveCustomer = () => {
    onUpdateCustomer(localCustomer);
    setEditCustomer(false);
    setSaveMessage('Profile updated!');
    setTimeout(() => setSaveMessage(''), 2000);
  };

  // Customer-only handlers: preferred sizes (local) + style notes (profile-backed).
  const toggleSize = (size) => {
    setPrefSizes((prev) => {
      const next = prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size];
      localStorage.setItem(LS_SIZES, JSON.stringify(next));
      return next;
    });
  };

  const saveSizes = () => {
    setSizesMsg('Preferred sizes saved!');
    setTimeout(() => setSizesMsg(''), 2000);
  };

  const saveStyleNotes = async () => {
    try {
      await onUpdateCustomer({ ...customerInfo, styleNotes });
      setStyleMsg('Measurements & style notes saved!');
    } catch {
      setStyleMsg('Could not save. Try again.');
    }
    setTimeout(() => setStyleMsg(''), 2000);
  };

  // ---------- SMS Template handlers ----------
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

  const availablePlaceholders = `{customer}, {item}, {date}, {days}`;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-5xl">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Settings</h2>
        <p className="text-sm text-gray-500 font-medium mt-1">Manage your preferences and account.</p>
      </div>

      {/* Profile card */}
      <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 flex flex-col md:flex-row gap-5 md:gap-8 items-start">
        <div className="w-16 h-16 md:w-24 md:h-24 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 border-4 border-white shadow-lg flex items-center justify-center shrink-0 text-gray-400">
          <User size={28} className="md:size-10" />
        </div>
        <div className="flex-1 space-y-3 w-full">
          <div>
              <h3 className="text-xl font-bold text-gray-900">
                {role === 'Customer' ? (customerInfo?.name || 'Customer') : (profile?.name || role)}
              </h3>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#bf4a53] bg-red-50 px-2 py-1 rounded-md mt-1 inline-block">
                {role} Role
              </span>
          </div>

          {role === 'Customer' ? (
            editCustomer ? (
              <div className="space-y-3">
                <input
                  type="text"
                  value={localCustomer.name}
                  onChange={(e) => setLocalCustomer({ ...localCustomer, name: e.target.value })}
                  className="w-full p-2.5 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53]"
                  placeholder="Full Name"
                />
                <input
                  type="text"
                  value={localCustomer.contact}
                  onChange={(e) => setLocalCustomer({ ...localCustomer, contact: e.target.value })}
                  className="w-full p-2.5 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53]"
                  placeholder="Contact Number"
                />
                  <input
                    type="text"
                    value={localCustomer.address}
                    onChange={(e) => setLocalCustomer({ ...localCustomer, address: e.target.value })}
                    className="w-full p-2.5 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53]"
                    placeholder="Address"
                  />
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Interested In</label>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {ITEM_TYPES.map((type) => {
                        const active = (localCustomer.preferences || []).includes(type);
                        return (
                          <button
                            type="button"
                            key={type}
                            onClick={() =>
                              setLocalCustomer((prev) => {
                                const has = (prev.preferences || []).includes(type);
                                return {
                                  ...prev,
                                  preferences: has
                                    ? prev.preferences.filter((t) => t !== type)
                                    : [...(prev.preferences || []), type],
                                };
                              })
                            }
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${active ? 'bg-[#bf4a53] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                          >
                            {type}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex gap-2">
                  <button
                    onClick={handleSaveCustomer}
                    className="px-4 py-2 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setEditCustomer(false); setLocalCustomer(customerInfo); }}
                    className="px-4 py-2 border border-gray-200 rounded-full text-sm font-bold hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                {saveMessage && <p className="text-xs text-emerald-600 font-bold mt-1">{saveMessage}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase">Name</p>
                <p className="text-sm font-medium text-gray-900">{customerInfo.name}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase mt-3">Contact</p>
                <p className="text-sm font-medium text-gray-900">{customerInfo.contact}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase mt-3">Address</p>
                <p className="text-sm font-medium text-gray-900">{customerInfo.address}</p>
                {customerInfo.preferences?.length > 0 && (
                  <>
                    <p className="text-[10px] font-bold text-gray-400 uppercase mt-3">Interested In</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {customerInfo.preferences.map((p) => (
                        <span key={p} className="px-2.5 py-1 bg-red-50 text-[#bf4a53] rounded-full text-[11px] font-bold">{p}</span>
                      ))}
                    </div>
                  </>
                )}
                <button
                  onClick={() => { setLocalCustomer({ ...customerInfo, preferences: customerInfo?.preferences || [] }); setEditCustomer(true); }}
                  className="mt-3 text-xs font-bold text-[#bf4a53] hover:underline"
                >
                  Edit Profile
                </button>
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-100/80">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Email Address</label>
                <p className="text-sm font-medium text-gray-900">{profile?.email || '—'}</p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Phone</label>
                <p className="text-sm font-medium text-gray-900">{profile?.phone || '—'}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Customer-only settings */}
      {role === 'Customer' && (
        <>
          {/* Fit & Style Preferences */}
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 space-y-5">
            <h3 className="font-bold text-gray-900 flex items-center gap-2 text-base">
              <Ruler size={18} className="text-gray-500" /> Fit & Style Preferences
            </h3>

            {/* Preferred sizes */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">My usual sizes</p>
              <div className="flex flex-wrap items-center gap-2">
                {SIZE_PRESETS.map((s) => {
                  const active = prefSizes.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSize(s)}
                      className={`min-w-[2.5rem] px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${active ? 'bg-[#bf4a53] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {s}
                    </button>
                  );
                })}
                {prefSizes.length > 0 && (
                  <button type="button" onClick={saveSizes} className="ml-1 px-4 py-1.5 rounded-full text-xs font-bold bg-gray-900 text-white hover:bg-gray-700 transition-colors">
                    Save
                  </button>
                )}
              </div>
              {sizesMsg && <p className="text-xs text-emerald-600 font-bold mt-2">{sizesMsg}</p>}
              <p className="text-[11px] text-gray-400 mt-2">Saved on this device to speed up future bookings.</p>
            </div>

            {/* Measurement / style notes */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">Measurements & style notes</p>
              <textarea
                value={styleNotes}
                onChange={(e) => setStyleNotes(e.target.value)}
                placeholder="e.g. Bust 34 / Waist 27 / Hips 36, prefer off-shoulder gowns, no sequins…"
                className="w-full p-3 bg-gray-50 rounded-xl border text-sm min-h-[90px] focus:outline-none focus:border-[#bf4a53]"
              />
              <div className="flex items-center gap-3 mt-2">
                <button type="button" onClick={saveStyleNotes} className="px-4 py-2 bg-[#bf4a53] text-white rounded-full text-xs font-bold hover:bg-red-700 transition-colors">
                  Save Notes
                </button>
                {styleMsg && <p className="text-xs text-emerald-600 font-bold">{styleMsg}</p>}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">Shared with the boutique so fittings and recommendations are faster.</p>
            </div>
          </div>

          {/* Notifications (customer) */}
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8">
            <h3 className="font-bold text-gray-900 flex items-center gap-2 text-base mb-4 md:mb-6">
              <Bell size={18} className="text-gray-500" /> Notification Preferences
            </h3>
            <div className="space-y-3 max-w-lg">
              {[
                { key: 'reminder', label: 'Due Date Reminders', desc: 'SMS the day before your rental is due.' },
                { key: 'lateReturn', label: 'Late Return Alerts', desc: 'SMS if a rental becomes overdue.' },
              ].map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between p-3.5 bg-gray-50 rounded-xl">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </div>
                  <button onClick={() => toggleNotif(key)}
                    className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${notifPrefs[key] ? 'bg-[#bf4a53]' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notifPrefs[key] ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
              ))}
            </div>
            {notifMsg && <p className="text-xs text-emerald-600 font-bold mt-3">{notifMsg}</p>}
          </div>

          {/* My Offers */}
          {myPromos.length > 0 && (
            <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8">
              <h3 className="font-bold text-gray-900 flex items-center gap-2 text-base mb-4 md:mb-6">
                <Tag size={18} className="text-gray-500" /> My Offers
              </h3>
              <div className="space-y-2 max-w-lg">
                {myPromos.map((p) => (
                  <div key={p.code} className="flex items-center justify-between p-3.5 bg-red-50 border border-[#bf4a53]/20 rounded-xl">
                    <div>
                      <p className="text-sm font-bold text-gray-900 font-mono">{p.code}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {p.discountPct}% off rental
                        {p.expiresAt ? ` · until ${new Date(p.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                      </p>
                    </div>
                    <span className="text-sm font-extrabold text-[#bf4a53]">-{p.discountPct}%</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-3">Apply a code at checkout to get the discount.</p>
            </div>
          )}
        </>
      )}

      {/* Operations Settings — Admin only */}
      {role === 'Admin' && (
        <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm divide-y divide-gray-100">
          {/* Business Profile */}
          <div className="p-5 md:p-8">
            <div className="flex items-center justify-between mb-4 md:mb-6">
              <h3 className="font-bold text-gray-900 flex items-center gap-2 text-base">
                <Building2 size={18} className="text-gray-500" /> Business Profile
              </h3>
              {!editBusiness && <button onClick={() => { setEditBusiness(true); setLocalBusiness(business); }} className="text-xs font-bold text-[#bf4a53] hover:underline">Edit</button>}
            </div>
            {editBusiness ? (
              <div className="space-y-3 max-w-lg">
                <input type="text" value={localBusiness.name} onChange={e => setLocalBusiness({ ...localBusiness, name: e.target.value })}
                  className="w-full p-2.5 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53]" placeholder="Store Name" />
                <input type="text" value={localBusiness.address} onChange={e => setLocalBusiness({ ...localBusiness, address: e.target.value })}
                  className="w-full p-2.5 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53]" placeholder="Address" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input type="text" value={localBusiness.contact} onChange={e => setLocalBusiness({ ...localBusiness, contact: e.target.value })}
                    className="w-full p-2.5 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53]" placeholder="Contact Number" />
                  <input type="text" value={localBusiness.taxId} onChange={e => setLocalBusiness({ ...localBusiness, taxId: e.target.value })}
                    className="w-full p-2.5 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53]" placeholder="Tax ID" />
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={saveBusiness} className="px-5 py-2 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors">Save</button>
                  <button onClick={() => { setEditBusiness(false); setLocalBusiness(business); }} className="px-5 py-2 border border-gray-200 rounded-full text-sm font-bold hover:bg-gray-50 transition-colors">Cancel</button>
                </div>
                {bizMsg && <p className="text-xs text-emerald-600 font-bold">{bizMsg}</p>}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                <div><p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Store</p><p className="text-sm font-medium text-gray-900">{business.name || '—'}</p></div>
                <div><p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Address</p><p className="text-sm font-medium text-gray-900">{business.address || '—'}</p></div>
                <div><p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Contact</p><p className="text-sm font-medium text-gray-900">{business.contact || '—'}</p></div>
                <div><p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Tax ID</p><p className="text-sm font-medium text-gray-900">{business.taxId || '—'}</p></div>
              </div>
            )}
          </div>

          {/* Rental Policies */}
          <div className="p-5 md:p-8">
            <div className="flex items-center justify-between mb-4 md:mb-6">
              <h3 className="font-bold text-gray-900 flex items-center gap-2 text-base">
                <DollarSign size={18} className="text-gray-500" /> Rental Policies
              </h3>
              {!editPolicies && <button onClick={() => { setEditPolicies(true); setLocalPolicies(policies); }} className="text-xs font-bold text-[#bf4a53] hover:underline">Edit</button>}
            </div>
            {editPolicies ? (
              <div className="space-y-3 max-w-lg">
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">Default Rental Period</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} max={30} value={localPolicies.defaultDays}
                      onChange={e => setLocalPolicies({ ...localPolicies, defaultDays: Math.max(1, parseInt(e.target.value) || 1) })}
                      className="w-24 p-2.5 bg-gray-50 rounded-xl border text-sm text-center focus:outline-none focus:border-[#bf4a53]" />
                    <span className="text-sm text-gray-500">days</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">Late Penalty</label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">₱</span>
                    <input type="number" min={0} value={localPolicies.latePenalty}
                      onChange={e => setLocalPolicies({ ...localPolicies, latePenalty: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="w-24 p-2.5 bg-gray-50 rounded-xl border text-sm text-center focus:outline-none focus:border-[#bf4a53]" />
                    <span className="text-sm text-gray-500">per day</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">Downpayment</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} max={100} value={localPolicies.depositPct}
                      onChange={e => setLocalPolicies({ ...localPolicies, depositPct: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) })}
                      className="w-24 p-2.5 bg-gray-50 rounded-xl border text-sm text-center focus:outline-none focus:border-[#bf4a53]" />
                    <span className="text-sm text-gray-500">% of rental fee</span>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={savePolicies} className="px-5 py-2 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors">Save</button>
                  <button onClick={() => { setEditPolicies(false); setLocalPolicies(policies); }} className="px-5 py-2 border border-gray-200 rounded-full text-sm font-bold hover:bg-gray-50 transition-colors">Cancel</button>
                </div>
                {polMsg && <p className="text-xs text-emerald-600 font-bold">{polMsg}</p>}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 max-w-lg">
                <div><p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Period</p><p className="text-sm font-medium text-gray-900">{policies.defaultDays} days</p></div>
                <div><p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Late Fee</p><p className="text-sm font-medium text-gray-900">₱{policies.latePenalty}/day</p></div>
                <div><p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Downpayment</p><p className="text-sm font-medium text-gray-900">{policies.depositPct}%</p></div>
              </div>
            )}
          </div>

          {/* Notification Preferences */}
          <div className="p-5 md:p-8">
            <h3 className="font-bold text-gray-900 flex items-center gap-2 text-base mb-4 md:mb-6">
              <Bell size={18} className="text-gray-500" /> Notification Preferences
            </h3>
            <div className="space-y-3 max-w-lg">
              {[
                { key: 'booking', label: 'Booking Confirmation', desc: 'SMS when a new rental is created.' },
                { key: 'reminder', label: 'Due Reminder', desc: 'Remind customer 1 day before due date.' },
                { key: 'lateReturn', label: 'Late Return Alert', desc: 'Notify when a rental becomes overdue.' },
              ].map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between p-3.5 bg-gray-50 rounded-xl">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </div>
                  <button onClick={() => toggleNotif(key)}
                    className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${notifPrefs[key] ? 'bg-[#bf4a53]' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notifPrefs[key] ? 'translate-x-4' :''}`} />
                  </button>
                </div>
              ))}
            </div>
            {notifMsg && <p className="text-xs text-emerald-600 font-bold mt-3">{notifMsg}</p>}
          </div>
        </div>
      )}

      {/* System Integrations (Admin only) — live connectivity, not hardcoded */}
      {role === 'Admin' && (
        <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <ShieldCheck className="text-emerald-500" size={20} /> System Integrations
            </h3>
            <button
              onClick={loadIntegrations}
              disabled={integrationsLoading}
              className="flex items-center gap-1.5 text-xs font-bold text-[#bf4a53] hover:underline disabled:opacity-50"
            >
              <RefreshCw size={13} className={integrationsLoading ? 'animate-spin' : ''} />
              {integrationsLoading ? 'Checking…' : 'Refresh'}
            </button>
          </div>

          <div className="space-y-3">
            {[
              { key: 'gemini', name: 'Gemini AI Stylist', desc: 'Powers outfit suggestions & business insights.', status: integrations?.gemini },
              { key: 'semaphore', name: 'Semaphore SMS Gateway', desc: 'Automated return reminders & booking confirmations.', status: integrations?.semaphore },
              { key: 'paymongo', name: 'PayMongo Payments', desc: 'Secure GCash & Credit Card downpayments.', status: integrations?.paymongo },
            ].map(({ key, name, desc, status }) => {
              const online = status?.configured && status?.reachable;
              const simulated = status?.simulated && !status?.configured;
              const offline = status && !status.reachable && status.configured;
              return (
                <div key={key} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl gap-3">
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
        </div>
      )}

      {/* SMS Templates – Admin only */}
      {role === 'Admin' && (
        <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <MessageSquare size={20} className="text-[#bf4a53]" /> SMS Templates
            </h3>
            <button onClick={resetAllTemplates} className="text-xs font-bold text-red-500 hover:underline sm:self-center">Clear all</button>
          </div>
          <p className="text-sm text-gray-500">Customize SMS sent to customers. Placeholders are replaced automatically.</p>
          <div className="text-xs text-gray-400 bg-gray-50 p-3 rounded-xl">
            Available placeholders: {availablePlaceholders}
          </div>
          {templatesLoading ? (
            <SkeletonList count={3} />
          ) : TEMPLATE_KEYS.map((key) => (
            <div key={key} className="border border-gray-200 rounded-2xl p-4 md:p-5">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-3">
                <h4 className="text-sm font-bold text-gray-900">{TEMPLATE_LABELS[key]}</h4>
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
        </div>
      )}

      {/* Promo Codes (Admin only) */}
      {role === 'Admin' && (
        <PromoCodesManager />
      )}

      {/* Staff Management (Admin only) */}
      {role === 'Admin' && staffList !== undefined && (
        <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 space-y-5">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Users size={20} className="text-[#bf4a53]" /> Staff Management
          </h3>

          {staffError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 rounded-2xl text-sm text-red-600 font-medium">
              <AlertCircle size={16} /> {staffError}
            </div>
          )}
          <form onSubmit={handleAddStaff} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Name"
              value={newStaffName}
              onChange={(e) => setNewStaffName(e.target.value)}
              className="flex-1 bg-gray-50 border border-gray-200/80 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:bg-white focus:border-gray-400"
            />
            <input
              type="text"
              placeholder="Username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="flex-1 bg-gray-50 border border-gray-200/80 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:bg-white focus:border-gray-400"
              required
            />
              <input
                type="password"
                placeholder="Password (12+ chars w/ upper, lower, digit, symbol)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="flex-1 bg-gray-50 border border-gray-200/80 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:bg-white focus:border-gray-400"
                required
                minLength={12}
              />
            <button
              type="submit"
              className="bg-[#bf4a53] text-white px-5 py-3 rounded-full text-sm font-semibold hover:bg-red-700 transition-colors flex items-center gap-2 shadow-sm shadow-red-500/20"
            >
              <Plus size={16} /> Add
            </button>
          </form>

          {staffList.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">No staff accounts yet.</p>
          ) : (
            <div className="space-y-3">
              {staffList.map((staff) => (
                <div
                  key={staff.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{staff.name || staff.email}</p>
                    <p className="text-xs text-gray-500">{staff.email}</p>
                    {staff.createdAt && (
                      <p className="text-[10px] text-gray-400">Added {new Date(staff.createdAt).toLocaleDateString()}</p>
                    )}
                  </div>
                  <button
                    onClick={() => onRemoveStaff(staff)}
                    className="text-red-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Phase 5: MFA Management (Admin only) */}
      {role === 'Admin' && (
        <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 space-y-5">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck size={20} className="text-[#bf4a53]" /> Two-Factor Authentication
          </h3>

          {mfaError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 rounded-2xl text-sm text-red-600 font-medium">
              <AlertCircle size={16} /> {mfaError}
            </div>
          )}

          {mfaStep === 'idle' && (
            <>
              <p className="text-sm text-gray-500">
                {profile?.mfaEnabled
                  ? 'MFA is currently enabled for your account.'
                  : 'Add an extra layer of security to your admin account with TOTP-based two-factor authentication.'}
              </p>
              {profile?.mfaEnabled ? (
                <button
                  onClick={handleMfaDisable}
                  disabled={mfaLoading}
                  className="px-4 py-2 border border-red-200 bg-red-50 text-[#bf4a53] font-semibold rounded-xl hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  {mfaLoading ? 'Disabling...' : 'Disable MFA'}
                </button>
              ) : (
                <button
                  onClick={handleMfaSetup}
                  disabled={mfaLoading}
                  className="px-4 py-2 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {mfaLoading ? 'Setting up...' : 'Set Up MFA'}
                </button>
              )}
            </>
          )}

          {mfaStep === 'setup' && mfaQrUri && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Scan the QR code below with your authenticator app (Google Authenticator, Authy, etc.),
                then enter the 6-digit code it generates.
              </p>
              <div className="flex items-center justify-center p-4 bg-gray-50 rounded-2xl">
                {mfaQrDataUri ? (
                  <img
                    src={mfaQrDataUri}
                    alt="MFA QR Code"
                    className="w-48 h-48 object-contain"
                  />
                ) : (
                  /* Fallback: show the typed-out setup key if the QR image is unavailable */
                  <div className="text-center p-4">
                    <p className="text-xs text-gray-500 mb-2">QR unavailable — enter this key manually:</p>
                    <p className="font-mono text-sm font-semibold text-gray-900 break-all">{mfaSecret}</p>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Authentication Code</label>
                <input
                  type="text"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono text-center text-gray-900 focus:outline-none focus:bg-white focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15"
                  maxLength={6}
                />
              </div>
              <button
                onClick={handleMfaEnable}
                disabled={mfaLoading || mfaCode.length !== 6}
                className="w-full px-4 py-3 bg-[#bf4a53] text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {mfaLoading ? 'Enabling...' : 'Enable MFA'}
              </button>
            </div>
          )}

          {mfaStep === 'backupCodes' && mfaBackupCodes.length > 0 && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-sm font-medium text-amber-800">Save these backup codes now</p>
                <p className="text-xs text-amber-600 mt-1">You won't see them again. Each code can be used once if you lose access to your authenticator app.</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {mfaBackupCodes.map((code, i) => (
                  <div key={i} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 font-mono text-sm text-center">
                    {code}
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={copyBackupCodes}
                  className="flex-1 px-4 py-2 border border-gray-200 bg-white text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors text-sm"
                >
                  Copy Codes
                </button>
                <button
                  onClick={() => { setMfaStep('enabled'); setMfaQrUri(''); setMfaQrDataUri(''); setMfaCode(''); }}
                  className="flex-1 px-4 py-2 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {mfaStep === 'enabled' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-2xl">
                <ShieldCheck size={20} className="text-emerald-500" />
                <span className="text-sm font-medium text-emerald-800">MFA is active on this account</span>
              </div>
              <button
                onClick={handleMfaDisable}
                disabled={mfaLoading}
                className="px-4 py-2 border border-red-200 bg-red-50 text-[#bf4a53] font-semibold rounded-xl hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                {mfaLoading ? 'Disabling...' : 'Disable MFA'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Help Guide — Admin/Staff read it from here (customers use the
          top-level Help tab). No own URL, matches their portal layout. */}
      {role !== 'Customer' && (
        <div className="border-t border-gray-100/60 pt-6">
          <HelpGuide role={role} />
        </div>
      )}

      {/* Sign Out */}
      <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="font-bold text-gray-900">Account Actions</h3>
          <p className="text-sm text-gray-500 mt-1">Sign out of your account and return to the landing page.</p>
        </div>
        <button
          onClick={onRequestLogout}
          className="flex items-center gap-2 px-5 py-2.5 border border-red-200 bg-red-50 text-[#bf4a53] font-bold text-sm rounded-full hover:bg-red-100 transition-colors shrink-0"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>
  );
}
