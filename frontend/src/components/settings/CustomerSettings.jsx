import { useState, useEffect } from 'react';
import { Ruler, Bell, Tag, Sparkles, NotebookPen, Check, RotateCcw, Save, Mail, BellRing, TriangleAlert, Copy, CalendarClock } from 'lucide-react';
import { api } from '../../utils/api';
import { promoService } from '../../services/promo';
import { SIZE_PRESETS } from '../../utils/sizePresets';
import Toggle from './Toggle';
import StoreContactCard from './StoreContactCard';
import CollapsibleCard from './CollapsibleCard';
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
  const [notifError, setNotifError] = useState('');
  const [myPromos, setMyPromos] = useState([]);
  const [copiedCode, setCopiedCode] = useState('');

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
    const prev = notifPrefs;
    const next = { ...prev, [key]: !prev[key] };
    localStorage.setItem(LS_NOTIF, JSON.stringify(next));
    setNotifPrefs(next);
    setNotifError('');
    setNotifMsg('Preferences updated!');
    api.put('/auth/me', { notifyPrefs: next }).catch(() => {
      // Roll back the optimistic flip so the switch never lies.
      localStorage.setItem(LS_NOTIF, JSON.stringify(prev));
      setNotifPrefs(prev);
      setNotifMsg('');
      setNotifError('Could not save. Check your connection and try again.');
    });
    setTimeout(() => setNotifMsg(''), 2000);
  };

  const copyPromo = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(''), 2000);
    } catch {
      // clipboard unavailable — code text remains selectable
    }
  };

  const NOTIF_ROWS = [
    { key: 'email', label: 'Emails', desc: 'Booking, pickup, return and reminder emails.', icon: Mail, channel: 'Email' },
    { key: 'reminder', label: 'Due Date Reminders', desc: 'SMS the day before your rental is due.', icon: BellRing, channel: 'SMS' },
    { key: 'lateReturn', label: 'Late Return Alerts', desc: 'SMS if a rental becomes overdue.', icon: TriangleAlert, channel: 'SMS' },
  ];

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

      {/* Inquiries & Contact — store's fixed inquiry number (read-only) */}
      <StoreContactCard />

      {/* Notifications (customer) — collapsible; 1 column on mobile, 3 cards on desktop */}
      <CollapsibleCard
        icon={Bell}
        title="Notification Preferences"
        subtitle="Choose how the boutique reaches you"
        storageKey="settings-notif-open"
      >
        <div className="grid gap-2.5 lg:grid-cols-3">
          {NOTIF_ROWS.map(({ key, label, desc, icon: Icon, channel }) => {
            const on = !!notifPrefs[key];
            return (
              <div
                key={key}
                className={`rounded-2xl border p-3.5 sm:p-4 flex items-center gap-3 transition-colors lg:flex-col lg:items-stretch ${
                  on ? 'bg-[#fafafa] border-gray-100' : 'bg-gray-50/60 border-gray-100'
                }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-white border border-gray-100 flex items-center justify-center shrink-0">
                    <Icon size={17} className={on ? 'text-[#bf4a53]' : 'text-gray-300'} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900 flex items-center gap-2 flex-wrap">
                      {label}
                      <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wide ${
                        channel === 'Email' ? 'bg-sky-50 text-sky-600' : 'bg-emerald-50 text-emerald-600'
                      }`}>
                        {channel}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </div>
                </div>
                <div className="shrink-0 lg:w-full lg:flex lg:items-center lg:justify-between lg:pt-3 lg:border-t lg:border-gray-100">
                  <span className={`hidden lg:block text-[11px] font-extrabold uppercase tracking-wide ${on ? 'text-emerald-600' : 'text-gray-400'}`}>
                    {on ? 'On' : 'Off'}
                  </span>
                  {/* Padded hit area keeps the 44px touch target without shifting layout */}
                  <span className="inline-flex p-2 -m-2">
                    <Toggle on={on} onClick={() => toggleNotif(key)} label={label} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="min-h-[1.25rem] mt-3">
          {notifMsg && <p className="text-xs text-emerald-600 font-bold">{notifMsg}</p>}
          {notifError && <p className="text-xs text-red-500 font-bold">{notifError}</p>}
        </div>
      </CollapsibleCard>

      {/* My Offers — collapsible; stacks on mobile, ticket grid + redeem strip on desktop */}
      {myPromos.length > 0 && (
        <CollapsibleCard
          icon={Tag}
          title="My Offers"
          subtitle="Discount codes you can use at checkout"
          storageKey="settings-offers-open"
        >
          {/* Full-width long tickets on every screen; content spreads out on desktop */}
          <div className="grid gap-2.5">
            {myPromos.map((p) => (
              <div key={p.code} className="flex items-stretch rounded-2xl border border-[#bf4a53]/20 bg-red-50/60 overflow-hidden min-w-0">
                {/* Discount stub — larger on desktop */}
                <div className="flex flex-col items-center justify-center px-3 sm:px-4 md:px-7 py-3.5 md:py-5 bg-[#bf4a53] text-white shrink-0 min-w-[4rem] md:min-w-[7rem]">
                  <span className="text-base sm:text-lg md:text-2xl font-extrabold leading-none tabular-nums">-{p.discountPct}%</span>
                  <span className="text-[10px] md:text-xs font-bold uppercase tracking-wider opacity-80 mt-1">off</span>
                </div>
                {/* Perforation */}
                <div className="w-0 border-l-2 border-dashed border-[#bf4a53]/25 my-2 md:my-3 shrink-0" aria-hidden="true" />
                {/* Code + meta — stacked on mobile, spread left/right on desktop */}
                <div className="flex-1 min-w-0 px-3.5 py-3 md:px-6 md:py-4 md:flex md:items-center md:gap-6">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm md:text-lg font-extrabold text-gray-900 font-mono tracking-wide select-all">{p.code}</p>
                    <p className="text-xs md:text-sm text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
                      {p.discountPct}% off rental
                      {p.expiresAt && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white border border-gray-200 text-[10px] md:text-[11px] font-bold text-gray-500">
                          <CalendarClock size={10} />
                          until {new Date(p.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyPromo(p.code)}
                    className="mt-2.5 md:mt-0 inline-flex items-center gap-1.5 px-4 py-1.5 md:px-6 md:py-2.5 min-h-[32px] md:min-h-[44px] bg-white border border-gray-200 rounded-full text-[10px] md:text-xs font-bold text-gray-600 hover:border-[#bf4a53]/50 hover:text-[#bf4a53] hover:bg-white transition-all shrink-0"
                    aria-label={`Copy code ${p.code}`}
                  >
                    {copiedCode === p.code ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                    {copiedCode === p.code ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* Mobile hint */}
          <p className="text-[11px] text-gray-400 mt-3 md:hidden">Tap Copy, then paste the code at checkout to get the discount.</p>
          {/* Desktop: how-to-redeem strip fills the wide card */}
          <div className="hidden md:grid md:grid-cols-3 gap-2.5 mt-4 pt-4 border-t border-gray-100">
            {[
              { n: '1', t: 'Copy a code', d: 'Use the Copy button on any offer above.' },
              { n: '2', t: 'Rent an item', d: 'Pick an available piece and start checkout.' },
              { n: '3', t: 'Paste at checkout', d: 'Enter the code to apply the discount.' },
            ].map(({ n, t, d }) => (
              <div key={n} className="flex items-start gap-2.5 p-3 bg-[#fafafa] rounded-2xl border border-gray-100">
                <span aria-hidden="true" className="shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-[11px] font-bold flex items-center justify-center">{n}</span>
                <span className="min-w-0">
                  <span className="block text-xs font-extrabold text-gray-900">{t}</span>
                  <span className="block text-[11px] text-gray-500 mt-0.5 leading-relaxed">{d}</span>
                </span>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      )}
    </>
  );
}