import { useState, useEffect } from 'react';
import { MessageSquare, RotateCcw } from 'lucide-react';
import { api } from '../../utils/api';
import CollapsibleCard from './CollapsibleCard';
import Toggle from './Toggle';

// Per-type automatic customer SMS (BusinessRule `sms_type_<type>_enabled`).
// Mirrors SMS_TYPES / SMS_TYPE_DEFAULTS in backend settings.service.ts:
// existing texts default ON, the payment-received text defaults OFF (each
// SMS costs money). Manual staff sends are never affected.
export const SMS_TYPES = [
  { type: 'booking', label: 'Booking received', hint: 'When a customer books (or their payment is under review).', def: true },
  { type: 'payment', label: 'Payment received', hint: 'When staff record a payment or approve a QR proof.', def: false },
  { type: 'due_reminder', label: 'Due reminder', hint: 'Before or on the return date.', def: true },
  { type: 'overdue', label: 'Overdue notices', hint: 'After the return date, on the reminder schedule.', def: true },
];
const typeKey = (type) => `sms_type_${type}_enabled`;
const fromRules = (rules = {}) => Object.fromEntries(SMS_TYPES.map(({ type, def }) => {
  const raw = rules[typeKey(type)];
  return [type, raw === 'true' ? true : raw === 'false' ? false : def];
}));

export default function SmsTypesCard() {
  const [types, setTypes] = useState(() => fromRules());
  const [globalOn, setGlobalOn] = useState(true);
  const [savingType, setSavingType] = useState(null);
  const [msg, setMsg] = useState(null); // { text, error }

  useEffect(() => {
    api.get('/settings/rules').then((rules) => {
      if (!rules) return;
      setTypes(fromRules(rules));
      setGlobalOn(rules.messaging_sms_enabled !== 'false');
    }).catch(() => {});
  }, []);

  const flash = (text, error = false) => {
    setMsg({ text, error });
    setTimeout(() => setMsg(null), 3000);
  };

  const toggleType = async (type) => {
    const nextOn = !types[type];
    setTypes((t) => ({ ...t, [type]: nextOn }));
    setSavingType(type);
    try {
      await api.put('/settings/rules', { [typeKey(type)]: String(nextOn) });
    } catch (err) {
      setTypes((t) => ({ ...t, [type]: !nextOn }));
      flash(`Could not save: ${err?.message || 'server error'}`, true);
    } finally {
      setSavingType(null);
    }
  };

  const resetDefaults = async () => {
    const prev = types;
    const defaults = Object.fromEntries(SMS_TYPES.map(({ type, def }) => [type, def]));
    setTypes(defaults);
    try {
      await api.put('/settings/rules', Object.fromEntries(SMS_TYPES.map(({ type, def }) => [typeKey(type), String(def)])));
      flash('Customer SMS reset to defaults.');
    } catch (err) {
      setTypes(prev);
      flash(`Could not save: ${err?.message || 'server error'}`, true);
    }
  };

  const atDefaults = SMS_TYPES.every(({ type, def }) => types[type] === def);

  return (
    <CollapsibleCard
      icon={MessageSquare}
      iconClass="bg-emerald-50 text-emerald-600"
      title="Customer SMS"
      subtitle="Choose which automatic texts customers get. Texts you send by hand always go out."
      storageKey="settings-sms-types-open"
      defaultOpen={false}
      headerAction={!atDefaults && (
        <button type="button" onClick={resetDefaults}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50">
          <RotateCcw size={12} /> Reset to defaults
        </button>
      )}
    >
      {!globalOn && (
        <p className="mb-3 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          All automatic SMS are switched off in Integrations, so none of these will send until it's turned back on.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SMS_TYPES.map(({ type, label, hint }) => (
          <div key={type} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-100">
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${types[type] && globalOn ? 'text-gray-900' : 'text-gray-400'}`}>{label}</p>
              <p className="text-[11px] text-gray-500 leading-snug">{hint}</p>
            </div>
            <Toggle on={types[type]} label={`${label} SMS`} onClick={() => savingType !== type && toggleType(type)} />
          </div>
        ))}
      </div>
      {msg && <p role="status" className={`text-xs font-bold mt-3 ${msg.error ? 'text-red-600' : 'text-emerald-600'}`}>{msg.text}</p>}
    </CollapsibleCard>
  );
}
