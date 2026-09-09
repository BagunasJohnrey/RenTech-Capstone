import { useState, useEffect } from 'react';
import { Ruler, Bell, Tag, Sparkles, NotebookPen, Check, RotateCcw, Save } from 'lucide-react';
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
      {/* Fit & Style Preferences — redesigned */}
      <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm overflow-hidden">
        {/* Header band */}
        <div className="bg-gradient-to-r from-[#bf4a53]/10 via-rose-50 to-transparent px-5 md:px-8 pt-5 md:pt-6 pb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#bf4a53] text-white flex items-center justify-center shadow-sm shadow-red-500/20 shrink-0">
              <Ruler size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 text-base leading-tight">Fit &amp; Style Preferences</h3>
              <p className="text-xs text-gray-500 font-medium mt-0.5 truncate">
                Faster bookings, better fitting picks
              </p>
            </div>
          </div>
          {prefSizes.length > 0 && (
            <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] text-[11px] font-bold">
              <Sparkles size={11} /> {prefSizes.length} size{prefSizes.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className="px-5 md:px-8 pb-5 md:pb-8 pt-4 space-y-6">
          {/* Preferred sizes */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">My usual sizes</p>
              {prefSizes.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setPrefSizes([]); localStorage.setItem(LS_SIZES, JSON.stringify([])); }}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <RotateCcw size={11} /> Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {SIZE_PRESETS.map((s) => {
                const active = prefSizes.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSize(s)}
                    aria-pressed={active}
                    className={`min-w-[3rem] px-4 py-2 rounded-2xl text-xs font-extrabold border transition-all btn-press ${
                      active
                        ? 'bg-[#bf4a53] border-[#bf4a53] text-white shadow-sm shadow-red-500/25'
                        : 'bg-gray-50 border-gray-200/70 text-gray-600 hover:border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {active && <Check size={12} strokeWidth={3.5} />}
                      {s}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 mt-3 min-h-[1.75rem]">
              {prefSizes.length > 0 && (
                <button
                  type="button"
                  onClick={saveSizes}
                  className="px-5 py-2 rounded-full text-xs font-bold bg-gray-900 text-white hover:bg-gray-700 transition-colors"
                >
                  Save sizes
                </button>
              )}
              {sizesMsg && <p className="text-xs text-emerald-600 font-bold">{sizesMsg}</p>}
              {prefSizes.length === 0 && !sizesMsg && (
                <p className="text-[11px] text-gray-400">Tap your go-to sizes — saved on this device to speed up future bookings.</p>
              )}
            </div>
          </section>

          <div className="border-t border-gray-100" />

          {/* Measurement / style notes */}
          <section>
            <div className="flex items-center gap-2 mb-2.5">
              <NotebookPen size={13} className="text-gray-400" />
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Measurements &amp; style notes</p>
              <span className="ml-auto text-[11px] font-semibold text-gray-300 tabular-nums">{styleNotes.length}/500</span>
            </div>
            <textarea
              value={styleNotes}
              maxLength={500}
              onChange={(e) => setStyleNotes(e.target.value)}
              placeholder="e.g. Bust 34 / Waist 27 / Hips 36, prefer off-shoulder gowns, no sequins…"
              rows={4}
              className="w-full p-3.5 bg-gray-50 rounded-2xl border border-gray-200/70 text-sm text-gray-900 placeholder-gray-400 min-h-[104px] resize-y focus:outline-none focus:bg-white focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15 transition-all"
            />
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={saveStyleNotes}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20"
              >
                <Save size={15} /> Save Notes
              </button>
            </div>
            {styleMsg && <p className="text-sm text-emerald-600 font-bold text-right mt-2">{styleMsg}</p>}
            <p className="text-[11px] text-gray-400 mt-2">Shared with the boutique so fittings and recommendations are faster.</p>
          </section>
        </div>
      </div>

      {/* Notifications (customer) */}
      <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8">
        <h3 className="font-bold text-gray-900 flex items-center gap-2 text-base mb-4 md:mb-6">
          <Bell size={18} className="text-gray-500" /> Notification Preferences
        </h3>
        <div className="space-y-3 max-w-lg">
          {[
            { key: 'email', label: 'Emails', desc: 'Booking, pickup, return and reminder emails.' },
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