import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Camera, AlertTriangle, CheckCircle, Check, DollarSign, Undo2, FileText } from 'lucide-react';

import { customerLabel, itemLabel } from '../utils/format';
import { storageService } from '../services';
import { api } from '../utils/api';
import { fileToBase64, downscaleToJpeg } from '../utils/file';
import { useEscapeClose } from '../hooks/useEscapeClose';
import BottomSheet from './BottomSheet';
import Button from './ui/Button';

// Fallback default damage fee when the Settings value can't be loaded —
// mirrors the backend default (utils/fees.ts).
const FALLBACK_DAMAGE_FEE = 1000;

export default function ProcessReturnModal({ transaction, onClose, onComplete }) {
  // Freeze the page behind the sheet; the backdrop is tap-to-close only.
  // Damage is optional: defaults to good condition so a clean return confirms
  // in one tap; ticking Damaged reveals reason + customizable fee.
  const [isDamaged, setIsDamaged] = useState(false);
  const [damageReason, setDamageReason] = useState('');
  const [otherDamageReason, setOtherDamageReason] = useState('');
  const [damageFee, setDamageFee] = useState('');
  // Live default from Admin Settings (damage_fee rule) so the placeholder and
  // summary match what a blank field will actually charge. Falls back to 1000.
  const [defaultFee, setDefaultFee] = useState(FALLBACK_DAMAGE_FEE);
  useEffect(() => {
    let active = true;
    api.get('/settings/rules')
      .then((rules) => {
        const parsed = rules?.damage_fee != null ? parseFloat(rules.damage_fee) : NaN;
        if (active && Number.isFinite(parsed) && parsed >= 0) setDefaultFee(parsed);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  const [returnPhotoFile, setReturnPhotoFile] = useState(null);
  const [returnPhotoUrl, setReturnPhotoUrl] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // The shared BottomSheet owns drag-to-dismiss + animations. Closing is
  // ignored while the return is submitting.
  const requestClose = useCallback(() => {
    if (!submitting) onClose();
  }, [submitting, onClose]);
  useEscapeClose(requestClose);

// iOS-style radio row: icon tile + title/subtitle + trailing check indicator.
// Compact single-column list; the group carries role="radiogroup".
function ReturnOptionRow({ selected, onSelect, icon: Icon, tileCls, title, sub, dotCls, label }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={label || title}
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-4 py-3 min-h-[56px] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#bf4a53]/60 ${selected ? 'bg-gray-50' : 'hover:bg-gray-50/60'}`}>
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tileCls}`}>
        <Icon size={17} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold text-gray-900 leading-tight">{title}</span>
        {sub && <span className="block text-xs text-gray-500 mt-0.5 leading-snug">{sub}</span>}
      </span>
      <span aria-hidden="true" className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${selected ? dotCls : 'border-gray-300'}`}>
        {selected && <Check size={14} strokeWidth={3.5} className="text-white" />}
      </span>
    </button>
  );
}

// Arrow-key navigation between radios in a group (radiogroup pattern).
const handleRadioKeys = (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const radios = Array.from(e.currentTarget.querySelectorAll('[role="radio"]'));
  const i = radios.indexOf(document.activeElement);
  if (i === -1) return;
  e.preventDefault();
  const next = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? (i + 1) % radios.length : (i - 1 + radios.length) % radios.length;
  radios[next].focus();
};

  const DAMAGE_REASONS = ['Torn', 'Stained', 'Missing parts', 'Other'];

  const reasonText = damageReason === 'Other' ? otherDamageReason.trim() : damageReason;
  // Blank = backend default (the Settings value); a typed value overrides it.
  const parsedFee = damageFee.trim() === '' ? null : Number(damageFee);
  const invalidFee = parsedFee !== null && (!Number.isFinite(parsedFee) || parsedFee < 0);
  const effectiveFee = isDamaged ? (invalidFee ? 0 : (parsedFee ?? defaultFee)) : 0;
  const totalFees = effectiveFee;
  // Return is locked until the rental is fully paid (backend enforces too).
  const outstandingBalance = Math.max(0, Number(transaction?.balance ?? 0) || 0);
  const isUnpaid = outstandingBalance > 0;

  const canConfirm = (!isDamaged || reasonText) && !invalidFee && !submitting && !isUnpaid;

  useEffect(() => () => { if (returnPhotoUrl) URL.revokeObjectURL(returnPhotoUrl); }, [returnPhotoUrl]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (returnPhotoUrl) URL.revokeObjectURL(returnPhotoUrl);
    setReturnPhotoFile(file);
    setReturnPhotoUrl(URL.createObjectURL(file));
  };

  const clearPhoto = () => {
    if (returnPhotoUrl) URL.revokeObjectURL(returnPhotoUrl);
    setReturnPhotoFile(null);
    setReturnPhotoUrl('');
  };

  // Double-submit guard: blocks the Confirm button (state) AND re-entrant
  // calls (ref — covers the gap between tap and re-render) for the whole
  // flow: photo upload + return processing. On success the parent closes the
  // modal and the guard stays set, so a stray second tap can't process the
  // same return twice.
  const submittingRef = useRef(false);
  const handleComplete = async () => {
    if (submittingRef.current || !canConfirm) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    let photoPath;
    if (returnPhotoFile) {
      try {
        const base64 = (await downscaleToJpeg(returnPhotoFile)) || (await fileToBase64(returnPhotoFile));
        const { path } = await storageService.upload(
          `rental/${transaction.id}/return-${Date.now()}.jpg`,
          'image/jpeg',
          base64
        );
        photoPath = path;
      } catch (err) {
        setError(err?.message || 'Photo upload failed');
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }
    }
    try {
      await onComplete(transaction.id, isDamaged, false, photoPath, isDamaged ? reasonText : undefined, parsedFee);
    } catch (err) {
      // App's handler toasts internally and rarely rejects, but a rejection
      // from any caller must still unblock the button.
      setError(err?.message || 'Failed to process return');
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet columns onClose={requestClose} labelledby="dialog-title-process-return" z="z-[310]" maxWidth="sm:max-w-lg" interceptClose={submitting}>
        <div className="shrink-0 bg-white/80 backdrop-blur-md flex justify-between items-center p-5 sm:p-6 border-b border-gray-100/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 rounded-xl">
              <Undo2 size={18} className="text-emerald-600" />
            </div>
            <div>
              <h3 id="dialog-title-process-return" className="font-bold text-lg text-gray-900">Process Return</h3>
              <p className="text-xs text-gray-500">Transaction #{transaction.id}</p>
            </div>
          </div>
          <button onClick={requestClose} aria-label="Close return dialog" className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
            <X size={20} />
          </button>
        </div>

        <div data-sheet-scroll className="p-5 sm:p-6 flex-1 overflow-y-auto min-h-0 overscroll-contain">
<div className="space-y-5 panel-split">
          <div className="space-y-5 panel-col">
          {isUnpaid && (
            <div className="flex items-start gap-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl p-3.5">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
              <span>Outstanding balance of ₱{outstandingBalance.toLocaleString()} — record the payment first. Return unlocks once fully paid.</span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">Customer</p>
              <p className="text-sm font-bold text-gray-900 truncate">{customerLabel(transaction.customer)}</p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">Item</p>
              <p className="text-sm font-bold text-gray-900 truncate">{itemLabel(transaction.item)}</p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">Due Date</p>
              <p className="text-sm font-bold text-gray-900 truncate">
                {transaction.dueDate
                  ? new Date(transaction.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : 'N/A'}
              </p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-red-500" />
                Item condition
              </p>
              <span className={`text-[11px] font-bold ${isDamaged ? 'text-red-600' : 'text-emerald-600'}`}>
                {isDamaged ? `Damaged · ₱${effectiveFee.toLocaleString()}` : 'Good · Optional'}
              </span>
            </div>
            <div role="radiogroup" aria-label="Item condition" onKeyDown={handleRadioKeys}
              className="bg-white border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-100">
              <ReturnOptionRow
                selected={isDamaged === true}
                onSelect={() => setIsDamaged(true)}
                icon={AlertTriangle}
                tileCls="bg-red-50 text-red-500"
                title="Damaged — out of rotation"
                sub="Reason required · fee adjustable below"
                dotCls="bg-red-500 border-red-500"
              />
              <ReturnOptionRow
                selected={isDamaged === false}
                onSelect={() => setIsDamaged(false)}
                icon={CheckCircle}
                tileCls="bg-emerald-50 text-emerald-600"
                title="Good condition"
                sub="Goes to the cleaning queue"
                dotCls="bg-emerald-500 border-emerald-500"
              />
            </div>
          </div>

          {/* Damage details — reason required to take the item out of rotation,
              fee customizable per-return (blank = default ₱1,000). */}
          {isDamaged === true && (
            <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <AlertTriangle size={14} /> Damage reason
                </label>
                <select
                  value={damageReason}
                  onChange={(e) => setDamageReason(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:bg-white focus:border-red-300 transition-all cursor-pointer"
                >
                  <option value="">Select a reason…</option>
                  {DAMAGE_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {damageReason === 'Other' && (
                  <input
                    type="text"
                    value={otherDamageReason}
                    onChange={(e) => setOtherDamageReason(e.target.value)}
                    placeholder="Describe the damage (e.g. torn hem, missing button)"
                    className="w-full bg-white border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:border-red-300 transition-all"
                  />
                )}
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <DollarSign size={14} /> Damage fee (₱)
                </label>
                <input
                  type="number"
                  min="0"
                  value={damageFee}
                  onChange={(e) => setDamageFee(e.target.value)}
                  placeholder={`Default ₱${defaultFee.toLocaleString()} — leave blank`}
                  className={`w-full bg-white border rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none transition-all ${invalidFee ? 'border-red-300 focus:border-red-400' : 'border-gray-200/80 focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15'}`}
                />
                {invalidFee ? (
                  <p className="text-[11px] text-red-500 font-medium">Enter 0 or more</p>
                ) : (
                  <p className="text-[11px] text-gray-400">Blank uses the default. Type a custom amount to override it for this return.</p>
                )}
              </div>
            </div>
          )}

          <div className="panel-grow lg:flex lg:flex-col">
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
              <Camera size={14} /> Return Condition Photo
            </label>
            <p className="text-[10px] text-gray-400 mb-2">Document the item's condition upon return for your records.</p>
            <div className="relative h-44 sm:h-48 lg:h-auto lg:flex-1 lg:min-h-[12rem] bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center overflow-hidden transition-colors hover:border-emerald-300">
              {returnPhotoUrl ? (
                <>
                  <img src={returnPhotoUrl} className="w-full h-full object-cover" alt="Return condition" />
                  <button onClick={clearPhoto} aria-label="Remove photo" className="absolute top-2 right-2 p-1.5 bg-gray-900/70 text-white rounded-full shadow hover:bg-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
                    <X size={14} />
                  </button>
                  <button onClick={() => { clearPhoto(); setTimeout(() => document.getElementById('return-photo-input')?.click(), 50); }}
                    className="absolute bottom-2 right-2 px-3 py-1.5 bg-white/90 backdrop-blur-sm rounded-full text-[11px] font-bold text-gray-700 shadow-sm hover:bg-white transition-colors border border-gray-200">
                    Retake
                  </button>
                </>
              ) : (
                <label className="cursor-pointer text-center p-4 w-full h-full flex flex-col items-center justify-center">
                  <input id="return-photo-input" type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />
                  <div className="p-3.5 bg-white rounded-full shadow-sm mb-2.5">
                    <Camera size={24} className="text-gray-400" />
                  </div>
                  <p className="text-sm font-bold text-gray-500">Tap to capture photo</p>
                  <p className="text-[10px] text-gray-300 mt-1">Opens camera — helps document condition on return</p>
                </label>
              )}
            </div>
          </div>

          </div>

          <div className="space-y-5 panel-col">
          {/* Notes */}
          <div className="panel-grow lg:flex lg:flex-col">
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-2">
              <FileText size={14} /> Notes (optional)
            </label>
            <textarea placeholder="Condition notes, additional fees, or remarks..."
              value={returnNotes}
              onChange={e => setReturnNotes(e.target.value)}
              rows={2}
              className="w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53] resize-none lg:flex-1"
            />
          </div>

          <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100/60">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={16} className="text-gray-500" />
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Fee Summary</h4>
            </div>
            <div className="space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 flex items-center gap-1.5">
                  <AlertTriangle size={14} className="text-red-400" /> Damage Fee
                </span>
                <span className={`font-bold text-sm ${isDamaged ? 'text-red-600' : 'text-gray-400'}`}>
                  {isDamaged ? `₱${effectiveFee.toLocaleString()}` : '—'}
                </span>
              </div>
              <div className="border-t border-gray-200 pt-2.5 mt-2.5 flex justify-between items-center">
                <span className="text-sm font-bold text-gray-900">Total</span>
                <span className="text-lg font-bold text-[#bf4a53]">₱{totalFees.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs font-semibold text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
          </div>
        </div>
</div>

        {/* Footer actions — pinned below the scrolling body so Cancel/Confirm
            stay fixed on mobile, with safe-area padding. */}
        <div className="shrink-0 bg-white/95 backdrop-blur-md border-t border-gray-100/80 px-5 sm:px-6 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-b-3xl">
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" size="lg" onClick={requestClose}>
              Cancel
            </Button>
            <Button variant="success" size="lg" onClick={handleComplete} disabled={!canConfirm || submitting}>
              <Undo2 size={16} />
              {submitting ? 'Processing…' : 'Confirm Return'}
            </Button>
          </div>
        </div>
    </BottomSheet>
  );
}
