import { useState, useEffect } from 'react';
import { X, Camera, Package, User, Calendar, Scissors } from 'lucide-react';
import { api } from '../utils/api';
import { storageService } from '../services';
import { customerLabel, itemLabel } from '../utils/format';
import { fileToBase64, downscaleToJpeg } from '../utils/file';
import { useEscapeClose } from '../hooks/useEscapeClose';

export default function ReleaseItemModal({ transaction, onClose, onReleased }) {
  useEscapeClose(onClose);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [needsAlteration, setNeedsAlteration] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoFile(file);
    setPhotoUrl(URL.createObjectURL(file));
  };

  const clearPhoto = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoFile(null);
    setPhotoUrl('');
  };

  const handleRelease = async () => {
    if (!photoFile) { setError('Please capture the pre-rental condition photo'); return; }
    setReleasing(true);
    setError('');
    try {
      const base64 = (await downscaleToJpeg(photoFile)) || (await fileToBase64(photoFile));
      const { path } = await storageService.upload(
        `rental/${transaction.id}/release-${Date.now()}.jpg`,
        'image/jpeg',
        base64
      );
      const updated = await api.put(`/transactions/${transaction.id}/release`, {
        releasePhoto: path,
        notes,
        needsAlteration,
      });
      onReleased(updated);
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to release item');
    }
    setReleasing(false);
  };

  return (
    <div className="fixed inset-0 z-[9999]">
      <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4 pointer-events-none">
        <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-release-item" className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[95vh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 pointer-events-auto" onClick={e => e.stopPropagation()}>
          <div className="bg-white flex justify-between items-center p-5 sm:p-6 border-b border-gray-100/80 rounded-t-3xl">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 rounded-xl">
                <Package size={18} className="text-blue-600" />
              </div>
              <div>
                <h3 id="dialog-title-release-item" className="font-bold text-lg text-gray-900">Release Item</h3>
                <p className="text-xs text-gray-500">Customer pickup</p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close release dialog" className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
              <X size={20} />
            </button>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <User size={11} /> Customer
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">{customerLabel(transaction.customer)}</p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Package size={11} /> Item
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">{itemLabel(transaction.item)}</p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Calendar size={11} /> Rental Date
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">
                {new Date(transaction.rentalDate || transaction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            </div>
            <div className="p-3.5 bg-gray-50 rounded-2xl">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Calendar size={11} /> Due Date
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">
                {new Date(transaction.dueDate || transaction.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 mb-3 flex items-center gap-1.5">
              <Camera size={14} className="text-blue-500" /> Pre-Rental Condition Photo
            </label>
            <p className="text-[10px] text-gray-400 mb-2">Capture the item's condition before releasing to the customer.</p>
            <div className="relative h-44 sm:h-48 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center overflow-hidden transition-colors hover:border-blue-300">
              {photoUrl ? (
                <>
                  <img src={photoUrl} className="w-full h-full object-cover" alt="Pre-rental condition" />
                  <button onClick={clearPhoto} aria-label="Remove photo" className="absolute top-2 right-2 p-1.5 bg-gray-900/70 text-white rounded-full shadow hover:bg-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
                    <X size={14} />
                  </button>
                </>
              ) : (
                <label className="cursor-pointer text-center p-4 w-full h-full flex flex-col items-center justify-center">
                  <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />
                  <div className="p-3.5 bg-white rounded-full shadow-sm mb-2.5">
                    <Camera size={24} className="text-gray-400" />
                  </div>
                  <p className="text-sm font-bold text-gray-500">Tap to capture photo</p>
                  <p className="text-[10px] text-gray-300 mt-1">Use camera to document item condition before release</p>
                </label>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1.5">
              Notes (optional)
            </label>
            <textarea placeholder="Any notes about the item condition at pickup..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-blue-400 resize-none"
            />
          </div>

          <div className="bg-amber-50 border border-amber-200/70 rounded-2xl p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <div className="relative mt-0.5">
                <input
                  type="checkbox"
                  checked={needsAlteration}
                  onChange={(e) => setNeedsAlteration(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-10 h-6 rounded-full transition-colors ${needsAlteration ? 'bg-amber-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${needsAlteration ? 'translate-x-4' : ''}`} />
                </div>
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                  <Scissors size={14} className="text-amber-600" /> Needs alteration
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  The garment doesn't fit — customer will need to come back for fitting before using it.
                </p>
              </div>
            </label>
          </div>

          {error && (
            <p className="text-xs font-semibold text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button onClick={onClose}
              className="py-3.5 text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-2xl transition-colors border border-gray-200">
              Cancel
            </button>
            <button onClick={handleRelease} disabled={releasing || !photoFile}
              className={`py-3.5 text-sm font-bold text-white rounded-2xl transition-all flex items-center justify-center gap-2 ${
                photoFile && !releasing
                  ? 'bg-blue-600 hover:bg-blue-700 shadow-sm active:scale-[0.98]'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}>
              {releasing ? 'Releasing...' : 'Confirm Release'}
            </button>
          </div>
          </div>
        </div>
    </div>
  </div>
  );
}
