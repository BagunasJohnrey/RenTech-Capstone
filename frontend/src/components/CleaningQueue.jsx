import { useState } from 'react';
import { CheckSquare, Droplets, Square } from 'lucide-react';
import { useToast } from './Toast';
import ItemImage from './ItemImage';

// Lists items currently in Cleaning with one-tap "Mark as Clean" per item plus
// a "Multi-select" mode: flip the button, tap several items, then "Mark N as
// Cleaned" flips them ALL to Available at once — the boutique cleans in
// batches, so this matches the actual workflow.
export default function CleaningQueue({ items, onMarkClean, onBulkClean, onViewAll }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

  if (!items.length) return null;

  const allSelected = selected.length === items.length;

  const toggleAll = () => setSelected(allSelected ? [] : items.map((i) => i.id));

  const toggleOne = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const exitMultiSelect = () => {
    setMultiSelect(false);
    setSelected([]);
  };

  const handleClean = async (id) => {
    try {
      await onMarkClean(id);
      toastSuccess('Item marked as clean');
    } catch (err) {
      toastError(err?.message || 'Failed to update item');
    }
  };

  const handleBulkClean = async () => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    try {
      await onBulkClean(selected);
      toastSuccess(`${selected.length} item${selected.length === 1 ? '' : 's'} marked as cleaned`);
      setSelected([]);
      setMultiSelect(false);
    } catch (err) {
      toastError(err?.message || 'Failed to update items');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-1.5">
          <Droplets size={14} className="text-orange-400" /> In Cleaning ({items.length})
        </h3>
        {items.length > 3 && (
          <button onClick={onViewAll} className="text-xs font-semibold text-[#bf4a53] hover:underline">
            View All
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {multiSelect ? (
          <>
            <button onClick={exitMultiSelect}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-700 bg-gray-100 rounded-full px-3 py-1.5 hover:bg-gray-200 transition-colors">
              Done
            </button>
            <button onClick={toggleAll}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1.5 hover:border-gray-300 hover:text-gray-800 transition-colors">
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
          </>
        ) : (
          <button onClick={() => setMultiSelect(true)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#bf4a53] bg-white border border-[#bf4a53]/30 rounded-full px-3 py-1.5 hover:bg-[#bf4a53]/5 transition-colors">
            <Square size={13} /> Multi-select
          </button>
        )}
        <span className="text-[11px] text-gray-400 font-medium">
          {multiSelect ? 'Tap items to select them, then mark all cleaned.' : 'Clean one at a time, or multi-select for batches.'}
        </span>
      </div>

      <div className="space-y-3">
        {items.slice(0, 6).map((item) => {
          const checked = selected.includes(item.id);
          return (
            <div key={item.id}
              onClick={() => multiSelect && toggleOne(item.id)}
              className={`${multiSelect ? 'cursor-pointer' : ''} rounded-2xl p-3 border bg-white flex items-center gap-3 transition-colors ${checked
                ? 'border-emerald-400 ring-2 ring-emerald-400/30 bg-emerald-50/40'
                : 'border-gray-100/80 shadow-sm'
              }`}
            >
              {multiSelect && (
                <button onClick={(e) => { e.stopPropagation(); toggleOne(item.id); }}
                  aria-label={checked ? `Deselect ${item.name}` : `Select ${item.name}`}
                  className={`p-1 rounded-md transition-colors shrink-0 ${checked ? 'text-emerald-600' : 'text-gray-300 hover:text-gray-400'}`}>
                  {checked ? <CheckSquare size={18} /> : <Square size={18} />}
                </button>
              )}
              <ItemImage thumb image={item.image} alt={item.name} className="w-12 h-12 rounded-xl object-cover bg-gray-100 shrink-0" placeholderSize={20} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
                <p className={`text-xs truncate ${checked ? 'text-emerald-600 font-semibold' : 'text-gray-500'}`}>
                  {checked ? 'Selected — will be marked clean' : 'Awaiting cleanup'}
                </p>
              </div>
              {multiSelect ? (
                checked && <CheckSquare size={18} className="text-emerald-600 shrink-0" />
              ) : (
                <button onClick={() => handleClean(item.id)}
                  className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors shrink-0">
                  Mark as Clean
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
