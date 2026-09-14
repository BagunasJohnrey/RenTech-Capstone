// Top rented items with tie-aware ranks + never-rented preview grid.
// Pure presentational; `openSmartModal('never')` opens the full list.
import { BarChart3, ChevronRight } from 'lucide-react';
import ItemImage from '../ItemImage';

export default function TopRented({ popularItems, underperforming, imgById, openSmartModal }) {
  return (
    <div className="bg-white rounded-3xl p-5 md:p-6 border border-gray-100/80 shadow-sm flex flex-col min-h-0">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center shrink-0">
          <BarChart3 size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 text-base md:text-lg leading-tight">Top Rented Items</h3>
          <p className="text-[11px] text-gray-400 font-medium mt-0.5">Ranked by rentals this period</p>
        </div>
        {popularItems.length > 0 && (
          <span className="text-[11px] font-bold text-gray-400 bg-gray-100 rounded-full px-2.5 py-0.5 shrink-0">{popularItems.length}</span>
        )}
      </div>
      {popularItems.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No rentals yet.</p>
      ) : (
        <ul className="mt-3 space-y-2.5 overflow-y-auto pr-1 -mr-1 max-h-72 min-h-0">
          {popularItems.map((item) => {
            const pct = Math.min((item.rentals / Math.max(...popularItems.map(t => t.rentals), 1)) * 100, 100);
            // Tied rental counts share the same rank (competition ranking:
            // rank = 1 + number of items strictly ahead).
            const rank = popularItems.findIndex((t) => t.rentals === item.rentals) + 1;
            return (
              <li key={item.id} className="p-3 rounded-2xl bg-gray-50/70 border border-gray-100">
                <div className="flex items-center gap-2.5">
                  <span className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${rank === 1 ? 'bg-[#bf4a53] text-white' : 'bg-gray-200/80 text-gray-600'}`}>{rank}</span>
                  <span className="flex-1 min-w-0 text-[13px] font-semibold text-gray-800 leading-snug truncate">{item.name}</span>
                  <span className="text-xs font-bold text-gray-900 bg-white border border-gray-200 rounded-full px-2 py-0.5 shrink-0 tabular-nums">{item.rentals}x</span>
                </div>
                <div className="ml-9 w-[calc(100%-2.25rem)] bg-gray-200/60 rounded-full h-1.5 mt-2 overflow-hidden">
                  <div className="h-1.5 rounded-full bg-[#bf4a53]" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {underperforming.length > 0 && popularItems.length > 0 && (
        <div className="pt-2 border-t border-gray-100">
          <button type="button" onClick={() => openSmartModal('never')}
            className="group w-full flex items-center gap-1.5 mb-2 text-left rounded-lg">
            <p className="text-xs font-semibold text-orange-500 flex-1">{underperforming.length} item(s) never rented</p>
            <span className="text-[11px] font-bold text-orange-600 bg-orange-50 rounded-full px-2 py-0.5">{underperforming.length}</span>
            <ChevronRight size={13} className="text-gray-300 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all" />
          </button>
          <div className="grid grid-cols-2 gap-1.5">
            {underperforming.slice(0, 3).map(item => (
              <div key={item.id} className="flex items-center gap-2 bg-orange-50 rounded-xl p-1.5 min-w-0">
                <ItemImage image={imgById.get(item.id)} alt={item.name} thumb className="w-9 h-9 rounded-lg object-cover shrink-0" />
                <p className="text-[11px] font-semibold text-orange-700 leading-tight line-clamp-2 min-w-0">{item.name}</p>
              </div>
            ))}
            {underperforming.length > 3 && (
              <button type="button" onClick={() => openSmartModal('never')}
                className="flex items-center justify-center min-h-[52px] rounded-xl border border-dashed border-orange-300 text-[11px] font-bold text-orange-600 hover:bg-orange-50 active:scale-[0.98] transition-all">
                +{underperforming.length - 3} more
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
