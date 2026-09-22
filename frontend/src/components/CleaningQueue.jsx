import { useState } from 'react';
import { CheckSquare, ChevronLeft, ChevronRight, Droplets, Square } from 'lucide-react';
import { useToast } from './Toast';
import ItemImage from './ItemImage';

const CLEANING_PAGE_SIZE = 5;

// Lists items currently in Cleaning with one-tap "Mark as Clean" per item plus
// a "Multi-select" mode: flip the button, tap several items, then "Mark N as
// Cleaned" flips them ALL to Available at once — the boutique cleans in
// batches, so this matches the actual workflow. Paginates at 5/page so long
// queues don't stretch the Tasks screen.
export default function CleaningQueue({ items, onMarkClean, onBulkClean, onViewAll }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / CLEANING_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = items.slice((safePage - 1) * CLEANING_PAGE_SIZE, safePage * CLEANING_PAGE_SIZE);

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
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-6">
      {/* Header — matches Ready for Pickup / Overdue Rentals cards, with the
          multi-select toggle top-right (desktop + mobile) */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-9 h-9 rounded-2xl bg-orange-50 text-orange-500 flex items-center justify-center shrink-0">
            <Droplets size={17} />
          </span>
          <h3 className="font-bold text-lg text-gray-900 truncate">In Cleaning</h3>
          <span className="inline-flex items-center justify-center bg-orange-100 text-orange-600 text-[10px] font-bold min-w-[22px] h-5 rounded-full px-1.5 shrink-0">
            {items.length}
          </span>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {multiSelect ? (
            <>
              <div className="flex items-center gap-1.5">
                <button onClick={exitMultiSelect}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-700 bg-gray-100 rounded-full px-2.5 py-1.5 hover:bg-gray-200 transition-colors">
                  Done
                </button>
                <button onClick={toggleAll}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-600 bg-white border border-gray-200 rounded-full px-2.5 py-1.5 hover:border-gray-300 hover:text-gray-800 transition-colors">
                  {allSelected ? <CheckSquare size={12} className="text-emerald-600" /> : <Square size={12} />}
                  {allSelected ? 'Deselect' : 'Select all'}
                </button>
              </div>
              {/* Desktop: Mark N as Cleaned sits top-right, below Done/Deselect */}
              {selected.length > 0 && (
                <button onClick={handleBulkClean} disabled={busy}
                  className="hidden sm:inline-flex items-center gap-1 text-[11px] font-bold text-white bg-emerald-600 rounded-full px-3 py-1.5 hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50">
                  <CheckSquare size={12} />
                  {busy ? 'Updating…' : `Mark ${selected.length} as Cleaned`}
                </button>
              )}
            </>
          ) : (
            <button onClick={() => setMultiSelect(true)}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-orange-600 bg-orange-50 border border-orange-200/70 rounded-full px-3 py-1.5 hover:bg-orange-100 transition-colors whitespace-nowrap">
              <Square size={12} /> Multi-select
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-500 font-medium mb-4">
        {multiSelect ? 'Tap items to select them, then mark all cleaned.' : 'Clean one at a time, or multi-select for batches.'}
      </p>

      {/* Mobile: full-width bulk action below the subtitle for an easy tap target */}
      {multiSelect && selected.length > 0 && (
        <button onClick={handleBulkClean} disabled={busy}
          className="w-full sm:hidden inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white bg-emerald-600 rounded-full px-4 py-2.5 hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50 mb-3">
          <CheckSquare size={13} />
          {busy ? 'Updating…' : `Mark ${selected.length} as Cleaned`}
        </button>
      )}

      <div className="space-y-2">
        {visible.map((item) => {
          const checked = selected.includes(item.id);
          return (
            <div key={item.id}
              onClick={() => multiSelect && toggleOne(item.id)}
              className={`${multiSelect ? 'cursor-pointer' : ''} flex items-center justify-between p-3 rounded-2xl border gap-3 transition-colors ${checked
                ? 'border-emerald-400 ring-2 ring-emerald-400/30 bg-emerald-50/60'
                : 'bg-orange-50/60 border-orange-100/50'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                {multiSelect ? (
                  <button onClick={(e) => { e.stopPropagation(); toggleOne(item.id); }}
                    aria-label={checked ? `Deselect ${item.name}` : `Select ${item.name}`}
                    className={`shrink-0 transition-colors ${checked ? 'text-emerald-600' : 'text-gray-300 hover:text-gray-400'}`}>
                    {checked ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                ) : (
                  <ItemImage thumb image={item.image} alt={item.name} className="w-9 h-9 rounded-xl object-cover bg-orange-100 shrink-0" placeholderSize={18} />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
                  <p className={`text-[10px] font-medium truncate ${checked ? 'text-emerald-600 font-bold' : 'text-orange-500'}`}>
                    {checked ? 'Selected — will be marked clean' : 'Awaiting cleanup'}
                  </p>
                </div>
              </div>
              {multiSelect ? (
                checked && <CheckSquare size={18} className="text-emerald-600 shrink-0" />
              ) : (
                <button onClick={() => handleClean(item.id)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-full transition-colors shadow-sm">
                  Mark as Clean
                </button>
              )}
            </div>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
          <span className="text-[11px] text-gray-400 font-semibold tabular-nums">
            Page {safePage} of {totalPages} · {items.length} in cleaning
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
              aria-label="Previous cleaning page"
              className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30">
              <ChevronLeft size={15} />
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
              aria-label="Next cleaning page"
              className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
      <button onClick={onViewAll}
        className="mt-3 w-full py-2.5 text-sm font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-xl transition-colors">
        View All ({items.length})
      </button>
    </div>
  );
}
