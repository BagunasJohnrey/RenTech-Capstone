import { useState, useEffect } from 'react';
import { Ruler, Bell, Tag } from 'lucide-react';
import { api } from '../../utils/api';
import { promoService } from '../../services/promo';
import { SIZE_PRESETS } from '../../utils/sizePresets';
import Toggle from './Toggle';
import { LS_SIZES, LS_NOTIF, DEFAULT_NOTIF, loadJSON } from './constants';

// Customer-only settings: preferred sizes (device-local), measurement/style
// notes (profile-backed), notification opt-outs, and discoverable promo codes.
export default function CustomerSettings({ profile, customerInfo, onUpdateCustomer }) {
  const [prefSizes, setPrefSizes] = useState(() => loadJSON(LS_SIZES, []));
  const [sizesMsg, setSizesMsg] = useState('');
  const [styleNotes, setStyleNotes] = useState(customerInfo?.styleNotes || '');
  const [styleMsg, setStyleMsg] = useState('');
  const [notifPrefs, setNotifPrefs] = useState(() =>
    (profile?.notifyPrefs && typeof profile.notifyPrefs === 'object')
      ? { ...DEFAULT_NOTIF, ...profile.notifyPrefs }
      : loadJSON(LS_NOTIF, DEFAULT_NOTIF));
  const [notifMsg, setNotifMsg] = useState('');
  const [myPromos, setMyPromos] = useState([]);

  // Load active promo codes for customers to discover available discounts.
  useEffect(() => {
    let active = true;
    promoService.listPublic()
      .then((d) => { if (active && Array.isArray(d)) setMyPromos(d); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

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

  const toggleNotif = (key) => {
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    localStorage.setItem(LS_NOTIF, JSON.stringify(next));
    setNotifPrefs(next);
    setNotifMsg('Preferences updated!');
    api.put('/auth/me', { notifyPrefs: next }).catch(() => {});
    setTimeout(() => setNotifMsg(''), 2000);
  };

  return (
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
              <button type="button" onClick={saveSizes} className="ml-1 px-4 py-1.5 rounded-full text-xs font-bold bg-gray-900 text-white hover:bg-gray-700 transition-colors">Save</button>
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
            <button type="button" onClick={saveStyleNotes} className="px-4 py-2 bg-[#bf4a53] text-white rounded-full text-xs font-bold hover:bg-red-700 transition-colors">Save Notes</button>
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
              <Toggle on={notifPrefs[key]} onClick={() => toggleNotif(key)} />
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
  );
}