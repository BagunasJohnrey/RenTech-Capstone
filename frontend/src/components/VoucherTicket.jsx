import { useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { promoDiscountLabel, promoShortLabel, promoTermsLabel, promoExpiry } from '../utils/promoLabel';

// One Shopee/Lazada-style voucher ticket: coloured stub with the headline
// discount, then terms, usage bar, expiry countdown and a single action —
// "Claim" while unclaimed, "Use now" once it is in the wallet. Used on the
// customer Home and in the My Vouchers wallet.
//
// status: 'active' (default) | 'used' | 'expired' | 'upcoming' — anything but
// active renders greyed with a stamp instead of an action.
export default function VoucherTicket({ voucher: p, onClaim, onUse, status = 'active' }) {
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');
  const live = status === 'active';
  const exp = promoExpiry(p);
  const terms = promoTermsLabel(p);

  const claim = async () => {
    setClaiming(true);
    setError('');
    try {
      await onClaim?.(p);
    } catch (err) {
      setError(err?.message || 'Could not claim');
    } finally {
      setClaiming(false);
    }
  };

  const stamp = { used: 'Used', expired: 'Expired', upcoming: 'Soon' }[status];

  return (
    <div className={`flex items-stretch rounded-2xl overflow-hidden border bg-white shadow-sm min-w-0 ${live ? 'border-red-100' : 'border-gray-200'}`}>
      <div className={`w-[92px] shrink-0 border-r-2 border-dashed flex flex-col items-center justify-center px-2 py-3 text-center ${
        live ? 'bg-[#bf4a53] text-white border-white/50' : 'bg-gray-200 text-gray-500 border-white'
      }`}>
        <span className="text-lg font-extrabold leading-none tabular-nums">{promoShortLabel(p)}</span>
        <span className="text-[9px] font-bold uppercase tracking-wide mt-1 opacity-80">off</span>
      </div>
      <div className={`flex-1 min-w-0 px-3 py-2.5 flex flex-col ${live ? '' : 'opacity-70'}`}>
        <p className="text-sm font-extrabold text-gray-900 truncate">{promoDiscountLabel(p)}</p>
        <p className="text-[11px] text-gray-500 font-medium truncate">{terms || 'Any rental'}</p>
        {live && p.usagePct != null && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="h-1 w-16 rounded-full bg-gray-200 overflow-hidden">
              <span className="block h-full bg-[#bf4a53]" style={{ width: `${p.usagePct}%` }} />
            </span>
            <span className="text-[10px] font-bold text-gray-400">{p.usagePct}% used</span>
          </div>
        )}
        <div className="flex items-end justify-between gap-2 mt-auto pt-1.5">
          <span className={`text-[10px] font-bold ${live && exp.urgent ? 'text-[#bf4a53]' : 'text-gray-400'}`}>
            {error ? <span className="text-red-500">{error}</span> : exp.label}
          </span>
          {stamp ? (
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-gray-500 border border-gray-300 rounded-full px-2.5 py-0.5 -rotate-6 shrink-0">{stamp}</span>
          ) : p.claimed ? (
            <button
              type="button"
              onClick={() => onUse?.(p)}
              className="text-[11px] font-extrabold text-[#bf4a53] border border-[#bf4a53] hover:bg-[#bf4a53] hover:text-white rounded-full px-3.5 py-1 transition-colors shrink-0 inline-flex items-center gap-1"
            >
              <Check size={11} strokeWidth={3} /> Use now
            </button>
          ) : (
            <button
              type="button"
              onClick={claim}
              disabled={claiming}
              className="text-[11px] font-extrabold text-white bg-[#bf4a53] hover:bg-[#a83f47] rounded-full px-4 py-1 transition-colors shrink-0 disabled:opacity-60 inline-flex items-center gap-1"
            >
              {claiming ? <Loader2 size={11} className="animate-spin" /> : 'Claim'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
