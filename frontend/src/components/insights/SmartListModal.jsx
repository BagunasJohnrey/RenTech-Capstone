// Full-list modal shared by the smart-action cards and the never-rented
// block. Motion matches the transaction sheets (timed 150ms exit).
// `onSaleItem` opens the inline sale editor; `openCleanQueue` the queue modal.
import { TrendingUp, AlertTriangle, RotateCcw, ChevronRight, Tag, X } from 'lucide-react';
import BottomSheet from '../BottomSheet';
import ItemImage from '../ItemImage';
import { panelTiles } from '../../utils/panelTiles';

const CFG = {
  restock: { icon: TrendingUp, iconCls: 'text-emerald-600', title: 'Restock list', sub: 'Projected demand outruns free stock' },
  clearance: { icon: AlertTriangle, iconCls: 'text-orange-500', title: 'Clearance list', sub: 'Idle pieces — put on sale (top 5)' },
  cleaning: { icon: RotateCcw, iconCls: 'text-[#bf4a53]', title: 'Cleaning order', sub: 'Clean-first order by coming demand' },
  never: { icon: AlertTriangle, iconCls: 'text-orange-500', title: 'Never rented', sub: 'Zero rentals this period — consider promotions' },
};

// Desktop (lg+): trailing icon pinned to the tile's corner. Inert below lg.
const TILE_BADGE = 'lg:absolute lg:top-2.5 lg:right-2.5 lg:w-7 lg:h-7 lg:p-1.5 lg:rounded-full lg:bg-white/95 lg:shadow-sm';

export default function SmartListModal({
  smartModal, smartClosing, closeSmartModal,
  restockRules, clearanceRules, cleaningRules, underperforming,
  imgById, onSaleItem, openCleanQueue,
}) {
  if (!smartModal) return null;
  const cfg = CFG[smartModal];
  const Icon = cfg.icon;
  const count = { restock: restockRules, clearance: clearanceRules, cleaning: cleaningRules, never: underperforming }[smartModal]?.length || 0;
  const tiles = panelTiles(count);
  const TILE = tiles.tile;
  const TILE_IMG = tiles.img;
  const TILE_TEXT = tiles.text;
  return (
    <BottomSheet columns onClose={closeSmartModal} labelledby="dialog-title-smart-list" z="z-[200]" maxWidth="sm:max-w-md">
          <div className="shrink-0 flex items-center gap-3 p-5 sm:p-6 border-b border-gray-100/80">
            <div className="w-10 h-10 rounded-2xl bg-gray-50 flex items-center justify-center shrink-0">
              <Icon size={18} className={cfg.iconCls} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 id="dialog-title-smart-list" className="font-bold text-gray-900 leading-tight">{cfg.title}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{cfg.sub}</p>
            </div>
            <button onClick={closeSmartModal} aria-label="Close list"
              className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors shrink-0">
              <X size={17} />
            </button>
          </div>
          <div data-sheet-scroll className="flex-1 overflow-y-auto min-h-0 overscroll-contain p-5 sm:p-6 pb-8 min-h-[220px]">
{/* Desktop (lg+): item lists become photo tiles (three per row) and the
    restock rules a two-column grid, so the panel fills instead of leaving
    a short list over empty space. Below lg: the compact row list. */}
<div className={count === 0 ? 'panel-center' : tiles.grid}>
            {count === 0 && (
              <p className="text-center text-sm text-gray-400 py-10">Nothing on this list right now.</p>
            )}
            {smartModal === 'restock' && restockRules.map((r) => (
              <div key={r.category} className="bg-emerald-50/60 rounded-2xl px-4 py-3 text-sm lg:flex lg:flex-col lg:items-center lg:justify-center lg:text-center lg:p-8">
                <div className="hidden lg:flex w-16 h-16 rounded-2xl bg-white text-emerald-600 items-center justify-center mb-4 shadow-sm">
                  <TrendingUp size={26} />
                </div>
                <p className="font-bold text-gray-900 lg:text-xl">{r.category} <span className="text-emerald-600">+{r.shortfall} pc{r.shortfall === 1 ? '' : 's'}</span></p>
                <p className="text-xs text-gray-500 mt-0.5 lg:hidden">Projected {r.projection}/mo · {r.freeUnits} free · {r.reason}</p>
                {/* Desktop: the same facts as a stat row. */}
                <div className="hidden lg:grid grid-cols-2 gap-3 mt-5 w-full max-w-xs">
                  <div className="bg-white rounded-xl py-3">
                    <p className="text-lg font-extrabold text-gray-900 tabular-nums">{r.projection}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Projected / mo</p>
                  </div>
                  <div className="bg-white rounded-xl py-3">
                    <p className="text-lg font-extrabold text-gray-900 tabular-nums">{r.freeUnits}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Free now</p>
                  </div>
                </div>
                <p className="hidden lg:block mt-3 text-sm text-emerald-700 font-medium">{r.reason}</p>
              </div>
            ))}
            {smartModal === 'clearance' && clearanceRules.map((it) => (
              <button key={it.id} type="button" onClick={() => onSaleItem({ id: it.id, name: it.name })}
                title={`Put ${it.name} on sale`}
                className={`w-full flex items-center gap-3 bg-orange-50/60 rounded-2xl p-3 text-sm text-left hover:bg-orange-50 hover:ring-1 hover:ring-orange-200 transition-all ${TILE}`}>
                <span className={tiles.frame}><ItemImage image={it.image} alt={it.name} thumb className={`w-11 h-11 rounded-xl object-cover shrink-0 ${TILE_IMG}`} /></span>
                <div className={`min-w-0 flex-1 ${TILE_TEXT}`}>
                  <p className="font-bold text-gray-900 truncate">{it.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{it.category} · {it.reason} — put on sale</p>
                </div>
                <Tag size={14} className={`text-orange-400 shrink-0 ${TILE_BADGE}`} />
              </button>
            ))}
            {smartModal === 'cleaning' && cleaningRules.map((it, i) => (
              <button key={it.id} type="button" onClick={() => openCleanQueue(it)}
                title="Open in the cleaning queue"
                className={`w-full flex items-center gap-3 text-sm bg-gray-50/60 rounded-2xl p-3 text-left hover:bg-gray-100 hover:ring-1 hover:ring-gray-200 transition-all ${TILE}`}>
                <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0 lg:absolute lg:top-2.5 lg:left-2.5 lg:z-10 lg:w-7 lg:h-7 lg:shadow-sm">{i + 1}</span>
                <span className={tiles.frame}><ItemImage image={it.image} alt={it.name} thumb className={`w-11 h-11 rounded-xl object-cover shrink-0 ${TILE_IMG}`} /></span>
                <div className={`min-w-0 flex-1 ${TILE_TEXT}`}>
                  <p className="font-bold text-gray-900 truncate">{it.name}</p>
                  <p className="text-xs text-gray-500">{it.category}{it.demand >= 0 ? ` · demand ${it.demand}/mo` : ''}</p>
                </div>
                <ChevronRight size={14} className={`text-gray-300 shrink-0 ${TILE_BADGE}`} />
              </button>
            ))}
            {smartModal === 'never' && underperforming.map((it) => (
              <button key={it.id} type="button" onClick={() => onSaleItem({ id: it.id, name: it.name })}
                title={`Put ${it.name} on sale`}
                className={`w-full flex items-center gap-3 bg-orange-50/60 rounded-2xl p-3 text-sm text-left hover:bg-orange-50 hover:ring-1 hover:ring-orange-200 transition-all ${TILE}`}>
                <span className={tiles.frame}><ItemImage image={it.image || imgById.get(it.id)} alt={it.name} thumb className={`w-11 h-11 rounded-xl object-cover shrink-0 ${TILE_IMG}`} /></span>
                <div className={`min-w-0 flex-1 ${TILE_TEXT}`}>
                  <p className="font-bold text-gray-900 truncate">{it.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{it.category} · never rented — put on sale</p>
                </div>
                <Tag size={14} className={`text-orange-400 shrink-0 ${TILE_BADGE}`} />
              </button>
            ))}
          </div>
</div>
    </BottomSheet>
  );
}
