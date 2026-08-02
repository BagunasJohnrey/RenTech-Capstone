import { useState } from 'react';
import { X, Camera, Clock, AlertTriangle, CheckCircle, DollarSign, Undo2, FileText } from 'lucide-react';

import { customerLabel, itemLabel } from '../utils/format';

export default function ProcessReturnModal({ transaction, onClose, onComplete }) {
  const [isLate, setIsLate] = useState(null);
  const [isDamaged, setIsDamaged] = useState(null);
  const [returnPhotoUrl, setReturnPhotoUrl] = useState('');
  const [returnNotes, setReturnNotes] = useState('');

  const basePenalty = isLate ? 500 : 0;
  const damageFee = isDamaged ? 1000 : 0;
  const totalFees = basePenalty + damageFee;

  const canConfirm = isLate !== null && isDamaged !== null;

  const handleComplete = () => {
    if (!canConfirm) return;
    onComplete(transaction.id, isDamaged, isLate, returnPhotoUrl);
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg max-h-[95vh] sm:max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-300" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md flex justify-between items-center p-5 sm:p-6 border-b border-gray-100/80 rounded-t-3xl">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 rounded-xl">
              <Undo2 size={18} className="text-emerald-600" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-gray-900">Process Return</h3>
              <p className="text-xs text-gray-500">Transaction #{transaction.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors shrink-0">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
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
            <p className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
              <Clock size={16} className="text-orange-500" />
              Is this return late?
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setIsLate(true)}
                className={`relative flex items-center justify-center gap-2.5 py-4 rounded-2xl font-bold text-sm transition-all min-h-[52px] border-2 ${
                  isLate === true
                    ? 'bg-orange-50 border-orange-400 text-orange-700 shadow-sm'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                }`}>
                {isLate === true && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center">
                    <CheckCircle size={12} className="text-white" />
                  </span>
                )}
                <AlertTriangle size={18} />
                Yes, it's late
              </button>
              <button onClick={() => setIsLate(false)}
                className={`relative flex items-center justify-center gap-2.5 py-4 rounded-2xl font-bold text-sm transition-all min-h-[52px] border-2 ${
                  isLate === false
                    ? 'bg-emerald-50 border-emerald-400 text-emerald-700 shadow-sm'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                }`}>
                {isLate === false && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                    <CheckCircle size={12} className="text-white" />
                  </span>
                )}
                <CheckCircle size={18} />
                On time
              </button>
            </div>
          </div>

          <div>
            <p className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-500" />
              Item condition
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setIsDamaged(true)}
                className={`relative flex items-center justify-center gap-2.5 py-4 rounded-2xl font-bold text-sm transition-all min-h-[52px] border-2 ${
                  isDamaged === true
                    ? 'bg-red-50 border-red-400 text-red-700 shadow-sm'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                }`}>
                {isDamaged === true && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                    <CheckCircle size={12} className="text-white" />
                  </span>
                )}
                <AlertTriangle size={18} />
                Damaged
              </button>
              <button onClick={() => setIsDamaged(false)}
                className={`relative flex items-center justify-center gap-2.5 py-4 rounded-2xl font-bold text-sm transition-all min-h-[52px] border-2 ${
                  isDamaged === false
                    ? 'bg-emerald-50 border-emerald-400 text-emerald-700 shadow-sm'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                }`}>
                {isDamaged === false && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                    <CheckCircle size={12} className="text-white" />
                  </span>
                )}
                <CheckCircle size={18} />
                Good condition
              </button>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
              <Camera size={14} /> Return Condition Photo
            </label>
            <p className="text-[10px] text-gray-400 mb-2">Document the item's condition upon return for your records.</p>
            <div className="relative h-44 sm:h-48 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center overflow-hidden transition-colors hover:border-emerald-300">
              {returnPhotoUrl ? (
                <>
                  <img src={returnPhotoUrl} className="w-full h-full object-cover" alt="Return condition" />
                  <button onClick={() => setReturnPhotoUrl('')} className="absolute top-2 right-2 p-1.5 bg-gray-900/70 text-white rounded-full shadow hover:bg-gray-900 transition-colors">
                    <X size={14} />
                  </button>
                  <button onClick={() => { setReturnPhotoUrl(''); setTimeout(() => document.getElementById('return-photo-input')?.click(), 50); }}
                    className="absolute bottom-2 right-2 px-3 py-1.5 bg-white/90 backdrop-blur-sm rounded-full text-[11px] font-bold text-gray-700 shadow-sm hover:bg-white transition-colors border border-gray-200">
                    Retake
                  </button>
                </>
              ) : (
                <label className="cursor-pointer text-center p-4 w-full h-full flex flex-col items-center justify-center">
                  <input id="return-photo-input" type="file" accept="image/*" capture="environment" onChange={e => {
                    const file = e.target.files[0];
                    if (file) setReturnPhotoUrl(URL.createObjectURL(file));
                  }} className="hidden" />
                  <div className="p-3.5 bg-white rounded-full shadow-sm mb-2.5">
                    <Camera size={24} className="text-gray-400" />
                  </div>
                  <p className="text-sm font-bold text-gray-500">Tap to capture photo</p>
                  <p className="text-[10px] text-gray-300 mt-1">Opens camera — helps document condition on return</p>
                </label>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-2">
              <FileText size={14} /> Notes (optional)
            </label>
            <textarea placeholder="Condition notes, additional fees, or remarks..."
              value={returnNotes}
              onChange={e => setReturnNotes(e.target.value)}
              rows={2}
              className="w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53] resize-none"
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
                  <Clock size={14} className="text-orange-400" /> Late Penalty
                </span>
                <span className={`font-bold text-sm ${isLate ? 'text-orange-600' : 'text-gray-400'}`}>
                  {isLate ? '₱500' : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 flex items-center gap-1.5">
                  <AlertTriangle size={14} className="text-red-400" /> Damage Fee
                </span>
                <span className={`font-bold text-sm ${isDamaged ? 'text-red-600' : 'text-gray-400'}`}>
                  {isDamaged ? '₱1,000' : '—'}
                </span>
              </div>
              <div className="border-t border-gray-200 pt-2.5 mt-2.5 flex justify-between items-center">
                <span className="text-sm font-bold text-gray-900">Total</span>
                <span className="text-lg font-bold text-[#bf4a53]">₱{totalFees.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button onClick={onClose}
              className="py-3.5 text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-2xl transition-colors border border-gray-200">
              Cancel
            </button>
            <button onClick={handleComplete} disabled={!canConfirm}
              className={`py-3.5 text-sm font-bold text-white rounded-2xl transition-all flex items-center justify-center gap-2 ${
                canConfirm
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-sm shadow-emerald-500/20 active:scale-[0.98]'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}>
              <Undo2 size={16} />
              Confirm Return
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
