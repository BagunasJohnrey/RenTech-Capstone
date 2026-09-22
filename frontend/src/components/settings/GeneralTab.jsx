import { useState, useEffect } from 'react';
import { Building2, DollarSign, Clock, ScanLine } from 'lucide-react';
import { api } from '../../utils/api';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import SettingsCard from './SettingsCard';
import InfoTile from './InfoTile';
import Toggle from './Toggle';
import NumberField from './NumberField';
import { LS_BUSINESS, LS_POLICIES, LS_AUTOMATION, DEFAULT_BUSINESS, DEFAULT_POLICIES, DEFAULT_AUTOMATION, loadJSON } from './constants';

// Admin General tab: business profile, rental policies/fees, automation &
// data retention, and the QR-code receipts toggle.
export default function GeneralTab() {
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

  // Automation & data retention
  const [automation, setAutomation] = useState(() => loadJSON(LS_AUTOMATION, DEFAULT_AUTOMATION));
  const [editAutomation, setEditAutomation] = useState(false);
  const [localAutomation, setLocalAutomation] = useState(automation);
  const [autoMsg, setAutoMsg] = useState('');

  // QR codes (scannable receipts + staff scanner) — admin toggle persisted as
  // a business rule and broadcast so every open screen updates instantly.
  const { qr_codes: qrCodesOn, refreshFlags } = useFeatureFlags();
  const [qrMsg, setQrMsg] = useState('');

  // Load business rules from backend on mount
  useEffect(() => {
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
      if (rules.rental_period_days) pol.defaultDays = parseInt(rules.rental_period_days) || pol.defaultDays;
      if (rules.return_days_after_event) pol.returnAfterEvent = parseInt(rules.return_days_after_event) || pol.returnAfterEvent;
      if (rules.min_downpayment) pol.minDown = parseInt(rules.min_downpayment) || pol.minDown;
      if (rules.damage_fee) pol.damageFee = parseInt(rules.damage_fee) || pol.damageFee;
      setPolicies(pol);
      setLocalPolicies(pol);
      localStorage.setItem(LS_POLICIES, JSON.stringify(pol));

      const auto = { ...automation };
      if (rules.overdue_escalation_days) auto.escalationDays = parseInt(rules.overdue_escalation_days) || auto.escalationDays;
      if (rules.data_retention_months) auto.retentionMonths = parseInt(rules.data_retention_months) || auto.retentionMonths;
      setAutomation(auto);
      setLocalAutomation(auto);
      localStorage.setItem(LS_AUTOMATION, JSON.stringify(auto));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      rental_period_days: String(localPolicies.defaultDays),
      return_days_after_event: String(localPolicies.returnAfterEvent),
      min_downpayment: String(localPolicies.minDown),
      damage_fee: String(localPolicies.damageFee),
    });
    setTimeout(() => setPolMsg(''), 2000);
  };

  const saveAutomation = () => {
    localStorage.setItem(LS_AUTOMATION, JSON.stringify(localAutomation));
    setAutomation(localAutomation);
    setEditAutomation(false);
    setAutoMsg('Automation settings saved!');
    syncRulesToBackend({
      overdue_escalation_days: String(localAutomation.escalationDays),
      data_retention_months: String(localAutomation.retentionMonths),
    });
    setTimeout(() => setAutoMsg(''), 2000);
  };

  const toggleQr = async () => {
    const next = !qrCodesOn;
    try {
      await api.put('/settings/rules', { qr_booking_codes: String(next) });
      if (refreshFlags) await refreshFlags();
      window.dispatchEvent(new Event('rentech:flags-changed'));
      setQrMsg(next ? 'QR codes enabled.' : 'QR codes turned off.');
    } catch {
      setQrMsg('Could not update setting. Try again.');
    }
    setTimeout(() => setQrMsg(''), 2500);
  };

  const editBtn = (onClick) => (
    <button onClick={onClick} className="shrink-0 text-xs font-bold px-4 py-2 rounded-full bg-gray-900 text-white hover:bg-gray-700 transition-colors">
      Edit
    </button>
  );
  const saveCancel = (onSave, onCancel) => (
    <div className="flex gap-2 pt-1">
      <button onClick={onSave} className="px-5 py-2 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors">Save</button>
      <button onClick={onCancel} className="px-5 py-2 border border-gray-200 rounded-full text-sm font-bold hover:bg-gray-50 transition-colors">Cancel</button>
    </div>
  );

  return (
    <>
      {/* Business Profile */}
      <SettingsCard
        icon={Building2}
        iconClass="bg-amber-50 text-amber-600"
        title="Business Profile"
        desc="Store details shown in receipts and customer communications"
        action={!editBusiness && editBtn(() => { setEditBusiness(true); setLocalBusiness(business); })}
      >
        {editBusiness ? (
          <div className="space-y-3 max-w-xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="text" value={localBusiness.name} onChange={e => setLocalBusiness({ ...localBusiness, name: e.target.value })}
                className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200/80 text-sm font-medium focus:outline-none focus:bg-white focus:border-[#bf4a53]" placeholder="Store Name" />
              <input type="text" value={localBusiness.contact} onChange={e => setLocalBusiness({ ...localBusiness, contact: e.target.value })}
                className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200/80 text-sm font-medium focus:outline-none focus:bg-white focus:border-[#bf4a53]" placeholder="Contact Number" />
            </div>
            <input type="text" value={localBusiness.address} onChange={e => setLocalBusiness({ ...localBusiness, address: e.target.value })}
              className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200/80 text-sm font-medium focus:outline-none focus:bg-white focus:border-[#bf4a53]" placeholder="Store Address" />
            <input type="text" value={localBusiness.taxId} onChange={e => setLocalBusiness({ ...localBusiness, taxId: e.target.value })}
              className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200/80 text-sm font-medium focus:outline-none focus:bg-white focus:border-[#bf4a53]" placeholder="Tax ID (optional)" />
            {saveCancel(saveBusiness, () => { setEditBusiness(false); setLocalBusiness(business); })}
            {bizMsg && <p className="text-xs text-emerald-600 font-bold">{bizMsg}</p>}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <InfoTile label="Store" value={business.name} />
            <InfoTile label="Address" value={business.address} />
            <InfoTile label="Contact" value={business.contact} />
            <InfoTile label="Tax ID" value={business.taxId} />
          </div>
        )}
      </SettingsCard>

      {/* Rental Policies & Fees */}
      <SettingsCard
        icon={DollarSign}
        iconClass="bg-emerald-50 text-emerald-600"
        title="Rental Policies & Fees"
        desc="Defaults applied to every new booking and return"
        action={!editPolicies && editBtn(() => { setEditPolicies(true); setLocalPolicies(policies); })}
      >
        {editPolicies ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <NumberField label="Default Rental Period" value={localPolicies.defaultDays} min={1} max={30}
              onChange={(v) => setLocalPolicies({ ...localPolicies, defaultDays: v })} suffix="days" />
            <NumberField label="Return After Event" value={localPolicies.returnAfterEvent} min={0} max={7}
              onChange={(v) => setLocalPolicies({ ...localPolicies, returnAfterEvent: v })} suffix="days"
              hint="How many days after the event the item is due back." />
            <NumberField label="Minimum Downpayment" value={localPolicies.minDown} min={0}
              onChange={(v) => setLocalPolicies({ ...localPolicies, minDown: v })} prefix="₱" suffix="per booking" widthClass="w-32" />
            <NumberField label="Default Damage Fee" value={localPolicies.damageFee} min={0}
              onChange={(v) => setLocalPolicies({ ...localPolicies, damageFee: v })} prefix="₱" suffix="per damaged item" widthClass="w-32"
              hint="Applied when the return form's fee field is left blank — staff can still type a custom amount per return." />
            <div className="flex gap-2 pt-1 sm:col-span-2">
              <button onClick={savePolicies} className="px-5 py-2 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors">Save</button>
              <button onClick={() => { setEditPolicies(false); setLocalPolicies(policies); }} className="px-5 py-2 border border-gray-200 rounded-full text-sm font-bold hover:bg-gray-50 transition-colors">Cancel</button>
            </div>
            {polMsg && <p className="text-xs text-emerald-600 font-bold sm:col-span-2">{polMsg}</p>}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <InfoTile label="Rental Period" value={`${policies.defaultDays} days`} />
            <InfoTile label="Return After Event" value={`${policies.returnAfterEvent} day${policies.returnAfterEvent !== 1 ? 's' : ''}`} />
            <InfoTile label="Min Downpayment" value={`₱${policies.minDown}`} />
            <InfoTile label="Default Damage Fee" value={`₱${policies.damageFee}`} />
          </div>
        )}
      </SettingsCard>

      {/* Automation & data */}
      <SettingsCard
        icon={Clock}
        iconClass="bg-sky-50 text-sky-600"
        title="Automation & Data"
        desc="Scheduled reminders, escalations, and how long history is kept"
        action={!editAutomation && editBtn(() => { setEditAutomation(true); setLocalAutomation(automation); })}
      >
        {editAutomation ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <NumberField label="Overdue escalation after" value={localAutomation.escalationDays} min={1} max={30}
              onChange={(v) => setLocalAutomation({ ...localAutomation, escalationDays: v })}
              suffix="days overdue" hint="Sends the one-time escalation SMS when a rental stays overdue this long." />
            <NumberField label="Keep history for" value={localAutomation.retentionMonths} min={3} max={60}
              onChange={(v) => setLocalAutomation({ ...localAutomation, retentionMonths: v })}
              suffix="months" hint="Old notifications, SMS, and audit logs older than this are purged nightly." />
            <div className="flex gap-2 pt-1 sm:col-span-2">
              <button onClick={saveAutomation} className="px-5 py-2 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors">Save</button>
              <button onClick={() => { setEditAutomation(false); setLocalAutomation(automation); }} className="px-5 py-2 border border-gray-200 rounded-full text-sm font-bold hover:bg-gray-50 transition-colors">Cancel</button>
            </div>
            {autoMsg && <p className="text-xs text-emerald-600 font-bold sm:col-span-2">{autoMsg}</p>}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InfoTile label="Overdue Escalation" value={`after ${automation.escalationDays} days overdue`} />
            <InfoTile label="History Retention" value={`${automation.retentionMonths} months`} />
          </div>
        )}
      </SettingsCard>

      {/* QR Codes */}
      <SettingsCard
        icon={ScanLine}
        iconClass="bg-purple-50 text-purple-600"
        title="QR Codes"
        desc="Scannable booking receipts + the staff QR scanner"
        action={<Toggle on={qrCodesOn} onClick={toggleQr} />}
      >
        <p className="text-sm text-gray-500 leading-relaxed">When on, booking receipts show a QR code the customer can present at pickup — staff scan it from the Records or Dashboard to release or return the item.</p>
        {qrMsg && <p className="text-xs text-emerald-600 font-bold">{qrMsg}</p>}
      </SettingsCard>
    </>
  );
}
