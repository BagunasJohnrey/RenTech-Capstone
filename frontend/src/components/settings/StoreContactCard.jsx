import { useState, useEffect } from 'react';
import { MessageCircleQuestion, Phone, MapPin, Copy, Check } from 'lucide-react';
import { api } from '../../utils/api';
import CollapsibleCard from './CollapsibleCard';

// Customer-only "Inquiries & Contact" card: shows the fixed store inquiry
// number the admin sets in Settings → General → Business Profile
// (business_contact rule, exposed publicly via /settings/rental-defaults).
// Read-only — customers can call, text, or copy the number.
// Collapsible (state persisted per device); Sign Out stays always-visible.
export default function StoreContactCard() {
  const [store, setStore] = useState({ name: '', contact: '', address: '' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    api.get('/settings/rental-defaults')
      .then((d) => {
        if (!active || !d) return;
        setStore({
          name: d.store_name || d.business_name || '',
          contact: d.store_contact || d.business_contact || '',
          address: d.store_address || d.business_address || '',
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const digits = (store.contact || '').replace(/[^\d+]/g, '');
  const hasNumber = digits.length >= 7;

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(store.contact);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (older webview) — selection fallback below
    }
  };

  return (
    <CollapsibleCard
      icon={MessageCircleQuestion}
      title="Inquiries & Contact"
      subtitle="Questions about a booking? Reach the boutique directly"
      storageKey="settings-contact-open"
    >
      {hasNumber ? (
        <div className="grid gap-3 md:grid-cols-2 md:gap-4">
          {/* Call / message column */}
          <div className="space-y-3 min-w-0">
            <a
              href={`tel:${digits}`}
              className="flex items-center gap-3 p-4 bg-[#fafafa] rounded-2xl border border-gray-100 hover:border-[#bf4a53]/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-white border border-gray-100 flex items-center justify-center shrink-0">
                <Phone size={17} className="text-[#bf4a53]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider truncate">
                  Store number{store.name ? ` · ${store.name}` : ''}
                </p>
                <p className="text-base font-extrabold text-gray-900 tracking-tight">{store.contact}</p>
              </div>
              <span className="shrink-0 px-4 py-2 bg-[#bf4a53] text-white rounded-full text-xs font-bold">
                Call
              </span>
            </a>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`sms:${digits}`}
                className="px-4 py-2.5 min-h-[44px] inline-flex items-center bg-white border-2 border-gray-200 rounded-full text-xs font-bold text-gray-700 hover:bg-gray-50 transition-all"
              >
                Text the store
              </a>
              <button
                type="button"
                onClick={copyNumber}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] bg-white border-2 border-gray-200 rounded-full text-xs font-bold text-gray-700 hover:bg-gray-50 transition-all"
              >
                {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                {copied ? 'Copied!' : 'Copy number'}
              </button>
            </div>
          </div>
          {/* Visit / tip column */}
          <div className="space-y-3 min-w-0">
            <div className="flex items-start gap-3 p-3.5 bg-gray-50 rounded-2xl border border-gray-100">
              <div className="w-9 h-9 rounded-xl bg-white border border-gray-100 flex items-center justify-center shrink-0">
                <MapPin size={15} className="text-[#bf4a53]" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Visit us</p>
                <p className="text-sm font-semibold text-gray-800 mt-0.5">
                  {store.address || 'Balayan, Batangas'}
                </p>
              </div>
            </div>
            <p className="text-[11px] md:text-xs text-gray-400 leading-relaxed">
              For cancellations, rescheduling, and fitting questions — mention your name and booking date so staff can find you faster.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
          <div className="w-9 h-9 rounded-xl bg-white border border-gray-100 flex items-center justify-center shrink-0">
            <MapPin size={15} className="text-[#bf4a53]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Visit us in store</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {store.address || 'Balayan, Batangas'} — please ask our staff for contact details.
            </p>
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
}
