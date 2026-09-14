import { useState, useCallback } from 'react';
import { CheckSquare, Droplets, Square, X } from 'lucide-react';
import { useToast } from './Toast';
import { useEscapeClose } from '../hooks/useEscapeClose';
import ItemImage from './ItemImage';

// Admin-facing read/action view of the cleaning queue. Staff keep the full
// interactive workflow in Tasks; this modal lets the admin review the backlog
// and bulk-mark items as cleaned without leaving the dashboard.
export default function CleaningQueueModal({ items, onClose, onBulkClean, initialSelected = [] }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [selected, setSelected] = useState(initialSelected);
  const [busy, setBusy] = useState(false);

  // Timed exit like the other sheets: play the fade/slide-out, then unmount.
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 150);
  }, [closing, onClose]);
  useEscapeClose(requestClose);

  const allSelected = items.length > 0 && selected.length === items.length;
  const toggleAll = () => setSelected(allSelected ? [] : items.map((i) => i.id));
  const toggleOne = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleBulkClean = async () => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    try {
      await onBulkClean(selected);
      toastSuccess(`${selected.length} item${selected.length === 1 ? '' : 's'} marked as cleaned`);
      setSelected([]);
      // Parent updates inventory; close when the queue is drained.
      if (selected.length === items.length) requestClose();
    } catch (err) {
      toastError(err?.message || 'Failed to update items');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-[200] transition-opacity duration-150 ${closing ? 'opacity-0' : 'opacity-100'}`}>
      <div className={`fixed inset-0 bg-gray-900/40 backdrop-blur-sm ${closing ? 'animate-out fade-out duration-150' : 'animate-in fade-in duration-200'}`} onClick={requestClose} />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4 pointer-events-none">
        <div
          className={`bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg max-h-[92dvh] sm:max-h-[85vh] flex flex-col overflow-hidden pointer-events-auto transform-gpu ${closing ? 'animate-out slide-out-to-bottom sm:zoom-out-95 fade-out duration-150' : 'animate-in slide-in-from-bottom sm:zoom-in-95 duration-200'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0 flex items-center gap-3 p-5 sm:p-6 border-b border-gray-100/80">
            <div className="w-11 h-11 rounded-2xl bg-orange-50 text-orange-500 flex items-center justify-center shrink-0">
              <Droplets size={19} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cleaning Queue</p>
              <h3 className="font-bold text-gray-900 leading-tight">
                {items.length} item{items.length === 1 ? '' : 's'} awaiting cleaning
              </h3>
            </div>
            {selected.length > 0 && (
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1 shrink-0 tabular-nums">
                {selected.length} selected
              </span>
            )}
            <button onClick={requestClose} aria-label="Close cleaning queue" className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors shrink-0">
              <X size={17} />
            </button>
          </div>

          {/* Toolbar */}
          <div className="shrink-0 flex flex-wrap items-center gap-2 px-5 sm:px-6 pt-4">
            <button onClick={toggleAll} disabled={busy || items.length === 0}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-600 bg-white border border-gray-200 rounded-full px-3.5 py-2 hover:border-gray-300 hover:text-gray-800 active:scale-[0.98] transition-all disabled:opacity-50">
              {allSelected ? <CheckSquare size={13} className="text-emerald-600" /> : <Square size={13} />}
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
            {selected.length > 0 && (
              <button onClick={handleBulkClean} disabled={busy}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-emerald-600 rounded-full px-3.5 py-2 hover:bg-emerald-700 active:scale-[0.98] transition-all shadow-sm disabled:opacity-50">
                <CheckSquare size={13} />
                {busy ? 'Updating…' : `Mark ${selected.length} as Cleaned`}
              </button>
            )}
            <span className="w-full text-[11px] text-gray-400 font-medium">
              Tap items to select — then mark the whole batch clean.
            </span>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 overscroll-contain p-5 sm:p-6 pt-4 pb-8 min-h-[220px] space-y-2.5">
            {items.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                  <Droplets size={24} className="text-emerald-400" />
                </div>
                <p className="text-sm font-bold text-gray-700">Queue is clear</p>
                <p className="text-xs text-gray-400 mt-1">Nothing is waiting to be cleaned.</p>
              </div>
            ) : (
              items.map((item) => {
                const checked = selected.includes(item.id);
                return (
                  <button key={item.id} type="button" onClick={() => !busy && toggleOne(item.id)} disabled={busy}
                    className={`w-full rounded-2xl p-3 border flex items-center gap-3 text-left transition-all active:scale-[0.99] disabled:opacity-60 ${
                      checked ? 'border-emerald-400 ring-2 ring-emerald-400/30 bg-emerald-50/40' : 'bg-gray-50/50 border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className={`p-0.5 rounded-md shrink-0 ${checked ? 'text-emerald-600' : 'text-gray-300'}`}>
                      {checked ? <CheckSquare size={19} /> : <Square size={19} />}
                    </span>
                    <ItemImage thumb image={item.image} alt={item.name} className="w-12 h-12 rounded-xl object-cover bg-gray-100 shrink-0" placeholderSize={18} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {item.category}
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 ${checked ? 'bg-emerald-500 text-white' : 'bg-orange-100 text-orange-600'}`}>
                      {checked ? 'Selected' : 'Cleaning'}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
