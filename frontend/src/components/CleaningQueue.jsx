import { useToast } from './Toast';
import ItemImage from './ItemImage';

// Lists items currently in Cleaning with a one-tap "Mark as Clean" action.
export default function CleaningQueue({ items, onMarkClean, onViewAll }) {
  const { success: toastSuccess, error: toastError } = useToast();
  if (!items.length) return null;
  const handleClean = async (id) => {
    try {
      await onMarkClean(id);
      toastSuccess('Item marked as clean');
    } catch (err) {
      toastError(err?.message || 'Failed to update item');
    }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">In Cleaning</h3>
        {items.length > 0 && (
          <button onClick={onViewAll} className="text-xs font-semibold text-[#bf4a53] hover:underline">
            View All
          </button>
        )}
      </div>
      <div className="space-y-3">
        {items.slice(0, 3).map((item) => (
          <div key={item.id} className="bg-white rounded-2xl p-3 border border-gray-100/80 shadow-sm flex items-center gap-3">
            <ItemImage image={item.image} alt={item.name} className="w-12 h-12 rounded-xl object-cover bg-gray-100 shrink-0" placeholderSize={20} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
              <p className="text-xs text-gray-500 truncate">Awaiting cleanup</p>
            </div>
            <button onClick={() => handleClean(item.id)}
              className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors shrink-0">
              Mark as Clean
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
