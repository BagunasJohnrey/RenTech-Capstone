import { useState, useEffect, useCallback } from 'react';
import { Ticket, X } from 'lucide-react';
import { promoService, VOUCHERS_CHANGED } from '../services/promo';
import VoucherTicket from './VoucherTicket';
import BottomSheet from './BottomSheet';

const TABS = [
  { id: 'active', label: 'Active' },
  { id: 'used', label: 'Used' },
  { id: 'expired', label: 'Expired' },
];

// "My Vouchers" wallet (Shopee/Lazada): claimed vouchers split into
// Active / Used / Expired, plus the vouchers still waiting to be claimed.
// Claimed vouchers are applied automatically at checkout when they're the
// best deal, so "Use now" just sends the customer shopping.
export function MyVouchersPanel({ onUse }) {
  const [wallet, setWallet] = useState(null);
  const [claimable, setClaimable] = useState([]);
  const [tab, setTab] = useState('active');

  const load = useCallback(async () => {
    const [mine, pub] = await Promise.all([
      promoService.mine().catch(() => []),
      promoService.listPublic().catch(() => []),
    ]);
    setWallet(Array.isArray(mine) ? mine : []);
    setClaimable((Array.isArray(pub) ? pub : []).filter((p) => !p.claimed));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(VOUCHERS_CHANGED, load);
    return () => window.removeEventListener(VOUCHERS_CHANGED, load);
  }, [load]);

  const claim = (p) => promoService.claim(p.code);
  const inTab = (v) => (tab === 'active' ? v.status === 'active' || v.status === 'upcoming' : v.status === tab);
  const shown = (wallet || []).filter(inTab);
  const count = (id) => (wallet || []).filter((v) => (id === 'active' ? v.status === 'active' || v.status === 'upcoming' : v.status === id)).length;

  return (
    <div className="space-y-4">
      <div role="tablist" className="grid grid-cols-3 gap-1 p-1 bg-gray-100 rounded-xl">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`py-1.5 rounded-lg text-xs font-bold transition-colors ${tab === t.id ? 'bg-white text-[#bf4a53] shadow-sm' : 'text-gray-500'}`}>
            {t.label}{wallet && count(t.id) > 0 ? ` (${count(t.id)})` : ''}
          </button>
        ))}
      </div>

      {wallet === null ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-[86px] rounded-2xl bg-gray-100 animate-pulse" />)}</div>
      ) : shown.length === 0 ? (
        <div className="text-center py-6">
          <Ticket size={28} className="mx-auto text-gray-300" />
          <p className="text-xs text-gray-400 font-medium mt-2">
            {tab === 'active' ? 'No vouchers yet — claim one below.' : tab === 'used' ? 'You haven’t used any vouchers yet.' : 'No expired vouchers.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-2.5">
          {shown.map((v) => <VoucherTicket key={v.code} voucher={v} status={v.status} onUse={onUse} />)}
        </div>
      )}

      {tab === 'active' && claimable.length > 0 && (
        <div className="space-y-2.5 pt-1">
          <p className="text-[11px] font-extrabold text-gray-500 uppercase tracking-wide">More vouchers to claim</p>
          {claimable.map((v) => <VoucherTicket key={v.code} voucher={v} onClaim={claim} onUse={onUse} />)}
        </div>
      )}
    </div>
  );
}

export default function MyVouchersSheet({ onClose, onUse }) {
  return (
    <BottomSheet onClose={onClose} labelledby="dialog-title-my-vouchers" z="z-[200]" maxWidth="sm:max-w-md" variant="dialog" backdropClass="bg-gray-900/50">
      <div className="shrink-0 flex items-center justify-between gap-3 px-5 pt-3 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-xl bg-[#bf4a53]/10 text-[#bf4a53] flex items-center justify-center shrink-0">
            <Ticket size={15} />
          </span>
          <div className="min-w-0">
            <h3 id="dialog-title-my-vouchers" className="text-sm font-extrabold text-gray-900">My Vouchers</h3>
            <p className="text-[11px] text-gray-400 font-medium">Your best voucher is applied at checkout</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close my vouchers" className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors shrink-0">
          <X size={18} />
        </button>
      </div>
      <div data-sheet-scroll className="overflow-y-auto min-h-0 p-4">
        <MyVouchersPanel onUse={(p) => { onClose(); onUse?.(p); }} />
      </div>
    </BottomSheet>
  );
}
