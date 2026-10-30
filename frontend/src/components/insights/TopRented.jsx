// Top rented items with tie-aware ranks + never-rented preview strip.
// Pure presentational; `onNeverRented` is the never-rented strip's action
// (Promotions for Admin, the never-rented list for Staff).
// On lg the card matches the Demand Forecast's height: `lg:h-0 lg:min-h-full`
// keeps it from contributing to the grid row's height while still stretching
// to fill it, so the ranked list scrolls instead of growing the row.
import { BarChart3, ChevronRight, Trophy } from 'lucide-react';
import ItemImage from '../ItemImage';

const MEDAL = [
  'bg-[#bf4a53] text-white',
  'bg-gray-800 text-white',
  'bg-amber-100 text-amber-700',
];

export default function TopRented({ popularItems, underperforming, imgById, onNeverRented, neverRentedLabel }) {
  const maxRentals = Math.max(...popularItems.map(t => t.rentals), 1);
  const totalRentals = popularItems.reduce((s, t) => s + (t.rentals || 0), 0);
  // Competition ranking: tied counts share a rank (1 + items strictly ahead).
  const rankOf = (item) => popularItems.findIndex((t) => t.rentals === item.rentals) + 1;
  const [leader, ...rest] = popularItems;
  const leaderShare = leader && totalRentals ? Math.round((leader.rentals / totalRentals) * 100) : 0;

  return (
    <div className="bg-white rounded-3xl p-5 md:p-6 border border-gray-100/80 shadow-sm flex flex-col min-h-0 lg:h-0 lg:min-h-full">
      {/* Header */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center shrink-0">
          <BarChart3 size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 text-base md:text-lg leading-tight">Top 10 Rented Items</h3>
          <p className="text-[11px] text-gray-400 font-medium mt-0.5">Ranked by rentals this period</p>
        </div>
      </div>

      {popularItems.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
          <div className="w-12 h-12 rounded-2xl bg-gray-50 text-gray-300 flex items-center justify-center mb-2">
            <BarChart3 size={20} />
          </div>
          <p className="text-sm font-semibold text-gray-500">No rentals yet</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Items will rank here once they're booked.</p>
        </div>
      ) : (
        <>
          {/* Summary chips */}
          <div className="grid grid-cols-2 gap-2 mt-4 shrink-0">
            <div className="rounded-2xl bg-gray-50/80 border border-gray-100 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Items ranked</p>
              <p className="text-lg font-bold text-gray-900 tabular-nums leading-tight">{popularItems.length}</p>
            </div>
            <div className="rounded-2xl bg-gray-50/80 border border-gray-100 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Their rentals</p>
              <p className="text-lg font-bold text-gray-900 tabular-nums leading-tight">{totalRentals}</p>
            </div>
          </div>

          {/* Leader spotlight */}
          <div className="mt-3 shrink-0 flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-br from-[#bf4a53]/10 to-amber-50 border border-[#bf4a53]/15">
            <div className="relative shrink-0">
              <ItemImage image={imgById.get(leader.id)} alt={leader.name} thumb className="w-14 h-14 rounded-xl object-cover" />
              <span className="absolute -top-1.5 -left-1.5 w-6 h-6 rounded-full bg-[#bf4a53] text-white flex items-center justify-center shadow-sm ring-2 ring-white">
                <Trophy size={12} />
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#bf4a53]">Most rented</p>
              <p className="text-sm font-bold text-gray-900 leading-snug line-clamp-2">{leader.name}</p>
              <p className="text-[11px] text-gray-500 mt-0.5 tabular-nums">
                {leader.rentals}x · {leaderShare}% of top-10 rentals
              </p>
            </div>
          </div>

          {/* Ranked list — fills remaining height, scrolls */}
          {rest.length > 0 && (
            <ul className="mt-3 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1 space-y-1.5 max-h-80 lg:max-h-none">
              {rest.map((item) => {
                const rank = rankOf(item);
                const pct = Math.min((item.rentals / maxRentals) * 100, 100);
                return (
                  <li key={item.id} className="flex items-center gap-2.5 p-2 rounded-2xl hover:bg-gray-50 transition-colors">
                    <span className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${MEDAL[rank - 1] || 'bg-gray-100 text-gray-500'}`}>{rank}</span>
                    <ItemImage image={imgById.get(item.id)} alt={item.name} thumb className="w-9 h-9 rounded-lg object-cover shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 text-[13px] font-semibold text-gray-800 truncate">{item.name}</span>
                        <span className="text-xs font-bold text-gray-900 tabular-nums shrink-0">{item.rentals}x</span>
                      </div>
                      <div className="bg-gray-100 rounded-full h-1.5 mt-1.5 overflow-hidden">
                        <div className="h-1.5 rounded-full bg-[#bf4a53]/70" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {rest.length === 0 && <div className="flex-1" />}
        </>
      )}

      {/* Never rented — pinned to the bottom */}
      {underperforming.length > 0 && popularItems.length > 0 && (
        <button type="button" onClick={onNeverRented}
          className="group mt-3 shrink-0 w-full flex items-center gap-3 p-3 rounded-2xl bg-orange-50/70 border border-orange-100 hover:bg-orange-50 active:scale-[0.99] transition-all text-left">
          <div className="flex -space-x-2 shrink-0">
            {underperforming.slice(0, 3).map(item => (
              <ItemImage key={item.id} image={imgById.get(item.id)} alt={item.name} thumb
                className="w-8 h-8 rounded-lg object-cover ring-2 ring-white" />
            ))}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-orange-700">{underperforming.length} item(s) never rented</p>
            <p className="text-[11px] text-orange-600/80 truncate">{neverRentedLabel}</p>
          </div>
          <ChevronRight size={15} className="text-orange-300 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all shrink-0" />
        </button>
      )}
    </div>
  );
}
