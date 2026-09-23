import { useState } from 'react';
import { X, AlertTriangle, Wrench, HelpCircle } from 'lucide-react';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useButtonGuard } from '../hooks/useButtonGuard';
import ItemImage from './ItemImage';

const REASONS = [
  { key: 'damaged', label: 'Damaged', hint: 'Torn, stained, broken zipper', icon: AlertTriangle, color: 'text-red-600 border-red-300 bg-red-50' },
  { key: 'maintenance', label: 'Cleaning / Repair', hint: 'Deep-clean, minor fixes', icon: Wrench, color: 'text-amber-600 border-amber-300 bg-amber-50' },
  { key: 'other', label: 'Other', hint: 'Something else', icon: HelpCircle, color: 'text-gray-600 border-gray-300 bg-gray-50' },
];

export default function OutOfServiceModal({ item, onClose, onConfirm }) {
  useEscapeClose(onClose);
  const [reason, setReason] = useState('');
  const [otherReason, setOtherReason] = useState('');

  const reasonText = reason === 'other' ? otherReason.trim() : reason;
  const canSubmit = !!reasonText;
  // Button guard: blocks double-tap on Pull (duplicate status flips + audits).
  const { guarding: submitting, guard: guardSubmit } = useButtonGuard();

  const handleSubmit = () => {
    if (!canSubmit) return;
    guardSubmit(async () => { await onConfirm(item, reasonText); });
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title-out-of-service"
        className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-5 border-b border-gray-100/80 bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-50 rounded-xl">
              <AlertTriangle size={18} className="text-red-500" />
            </div>
            <div>
              <h3 id="dialog-title-out-of-service" className="font-bold text-lg text-gray-900">Pull from Rental</h3>
              <p className="text-xs text-gray-500">Item can't be rented until restored</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close dialog"
            className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3 bg-gray-50 rounded-2xl p-3">
            <ItemImage thumb image={item.image} alt={item.name} className="w-12 h-12 rounded-xl object-cover bg-gray-100 shrink-0" placeholderSize={20} />
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
              <p className="text-xs text-gray-500 truncate">{item.category} · ₱{item.price.toLocaleString()}/day</p>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Reason</p>
            <div className="grid grid-cols-3 gap-2">
              {REASONS.map((r) => {
                const Icon = r.icon;
                const active = reason === r.key;
                return (
                  <button key={r.key} type="button" onClick={() => setReason(r.key)} aria-pressed={active}
                    className={`flex flex-col items-center gap-1 px-2 py-3 rounded-2xl border-2 transition-all text-center ${
                      active ? `${r.color} shadow-sm` : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                    }`}>
                    <Icon size={18} />
                    <span className="font-bold text-xs">{r.label}</span>
                    <span className="text-[9px] opacity-60 font-medium leading-tight">{r.hint}</span>
                  </button>
                );
              })}
            </div>
            {reason === 'other' && (
              <input
                type="text"
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value)}
                placeholder="e.g. missing beading, broken zipper"
                className="mt-2 w-full bg-gray-50/50 border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:bg-white focus:border-gray-400 transition-all"
              />
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 rounded-full text-xs font-bold text-gray-600 hover:bg-gray-100 transition-colors">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={!canSubmit || submitting}
              className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-xs font-bold transition-all ${
                canSubmit && !submitting
                  ? 'bg-[#bf4a53] text-white hover:bg-red-700 shadow-sm shadow-red-500/20'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}>
              <AlertTriangle size={13} />
              {submitting ? 'Pulling…' : 'Pull from rental'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
