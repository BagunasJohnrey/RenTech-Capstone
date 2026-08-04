import { useState } from 'react';
import { CheckSquare, Droplets, Square, X } from 'lucide-react';
import { useToast } from './Toast';
import ItemImage from './ItemImage';

// Admin-facing read/action view of the cleaning queue. Staff keep the full
// interactive workflow in Tasks; this modal lets the admin review the backlog
// and bulk-mark items as cleaned without leaving the dashboard.
export default function CleaningQueueModal({ items, onClose, onBulkClean }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

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
      if (selected.length === items.length) onClose();
    } catch (err) {
      toastError(err?.message || 'Failed to update items');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-300 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4 border-b border-gray-100 bg-gray-50/50">
          <div className="w-10 h-10 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center shrink-0">
            <Droplets size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cleaning Queue</p>
            <h3 className="font-bold text-gray-900">{items.length} item{items.length === 1 ? '' : 's'} awaiting cleaning</h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 pt-4">
          <button onClick={toggleAll} disabled={busy || items.length === 0}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1.5 hover:border-gray-300 hover:text-gray-800 transition-colors disabled:opacity-50">
            {allSelected ? <CheckSquare size={13} className="text-emerald-600" /> : <Square size={13} />}
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          {selected.length > 0 && (
            <button onClick={handleBulkClean} disabled={busy}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-emerald-600 rounded-full px-3 py-1.5 hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50">
              <CheckSquare size={13} />
              {busy ? 'Updating…' : `Mark ${selected.length} as Cleaned`}
            </button>
          )}
          <span className="ml-auto text-[11px] text-gray-400 font-medium">
            Tap items to select — then mark the whole batch clean.
          </span>
        </div>

        <div className="overflow-y-auto p-4 space-y-2.5">
          {items.length === 0 ? (
            <div className="text-center py-10">
              <Droplets size={28} className="text-emerald-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-700">Queue is clear</p>
              <p className="text-xs text-gray-400 mt-0.5">Nothing is waiting to be cleaned.</p>
            </div>
          ) : (
            items.map((item) => {
              const checked = selected.includes(item.id);
              return (
                <div key={item.id} onClick={() => !busy && toggleOne(item.id)}
                  className={`rounded-2xl p-3 border flex items-center gap-3 cursor-pointer transition-colors ${
                    checked ? 'border-emerald-400 ring-2 ring-emerald-400/30 bg-emerald-50/40' : 'bg-gray-50/50 border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <span className={`p-1 rounded-md shrink-0 ${checked ? 'text-emerald-600' : 'text-gray-300'}`}>
                    {checked ? <CheckSquare size={18} /> : <Square size={18} />}
                  </span>
                  <ItemImage image={item.image} alt={item.name} className="w-11 h-11 rounded-xl object-cover bg-gray-100 shrink-0" placeholderSize={18} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {item.category}{item.size ? ` · ${item.size}` : ''}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${checked ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-50 text-orange-600'}`}>
                    {checked ? 'Selected' : 'Cleaning'}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
