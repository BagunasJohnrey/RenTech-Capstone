// Full-list modal shared by the smart-action cards and the never-rented
// block. Motion matches the transaction sheets (timed 150ms exit).
// `onSaleItem` opens the inline sale editor; `openCleanQueue` the queue modal.
import { TrendingUp, AlertTriangle, RotateCcw, ChevronRight, Tag, X } from 'lucide-react';
import ItemImage from '../ItemImage';

const CFG = {
  restock: { icon: TrendingUp, iconCls: 'text-emerald-600', title: 'Restock list', sub: 'Projected demand outruns free stock' },
  clearance: { icon: AlertTriangle, iconCls: 'text-orange-500', title: 'Clearance list', sub: 'Idle pieces — put on sale (top 5)' },
  cleaning: { icon: RotateCcw, iconCls: 'text-[#bf4a53]', title: 'Cleaning order', sub: 'Clean-first order by coming demand' },
  never: { icon: AlertTriangle, iconCls: 'text-orange-500', title: 'Never rented', sub: 'Zero rentals this period — consider promotions' },
};

export default function SmartListModal({
  smartModal, smartClosing, closeSmartModal,
  restockRules, clearanceRules, cleaningRules, underperforming,
  imgById, onSaleItem, openCleanQueue,
}) {
  if (!smartModal) return null;
  const cfg = CFG[smartModal];
  const Icon = cfg.icon;
  return (
    <div className={`fixed inset-0 z-[200] transition-opacity duration-150 ${smartClosing ? 'opacity-0' : 'opacity-100'}`}>
      <div className={`fixed inset-0 bg-gray-900/40 backdrop-blur-sm ${smartClosing ? 'animate-out fade-out duration-150' : 'animate-in fade-in duration-200'}`} onClick={closeSmartModal} />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4 pointer-events-none">
        <div role="dialog" aria-modal="true" className={`bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[92dvh] sm:max-h-[85vh] flex flex-col overflow-hidden pointer-events-auto transform-gpu ${smartClosing ? 'animate-out slide-out-to-bottom sm:zoom-out-95 fade-out duration-150' : 'animate-in slide-in-from-bottom sm:zoom-in-95 duration-200'}`} onClick={e => e.stopPropagation()}>
          <div className="shrink-0 flex items-center gap-3 p-5 sm:p-6 border-b border-gray-100/80">
            <div className="w-10 h-10 rounded-2xl bg-gray-50 flex items-center justify-center shrink-0">
              <Icon size={18} className={cfg.iconCls} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 leading-tight">{cfg.title}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{cfg.sub}</p>
            </div>
            <button onClick={closeSmartModal} aria-label="Close list"
              className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors shrink-0">
              <X size={17} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 overscroll-contain p-5 sm:p-6 pb-8 min-h-[220px] space-y-2.5">
            {smartModal === 'restock' && restockRules.map((r) => (
              <div key={r.category} className="bg-emerald-50/60 rounded-2xl px-4 py-3 text-sm">
                <p className="font-bold text-gray-900">{r.category} <span className="text-emerald-600">+{r.shortfall} pc{r.shortfall === 1 ? '' : 's'}</span></p>
                <p className="text-xs text-gray-500 mt-0.5">Projected {r.projection}/mo · {r.freeUnits} free · {r.reason}</p>
              </div>
            ))}
            {smartModal === 'clearance' && clearanceRules.map((it) => (
              <button key={it.id} type="button" onClick={() => onSaleItem({ id: it.id, name: it.name })}
                title={`Put ${it.name} on sale`}
                className="w-full flex items-center gap-3 bg-orange-50/60 rounded-2xl p-3 text-sm text-left hover:bg-orange-50 hover:ring-1 hover:ring-orange-200 transition-all">
                <ItemImage image={it.image} alt={it.name} thumb className="w-11 h-11 rounded-xl object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-900 truncate">{it.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{it.category} · {it.reason} — put on sale</p>
                </div>
                <Tag size={14} className="text-orange-400 shrink-0" />
              </button>
            ))}
            {smartModal === 'cleaning' && cleaningRules.map((it, i) => (
              <button key={it.id} type="button" onClick={() => openCleanQueue(it)}
                title="Open in the cleaning queue"
                className="w-full flex items-center gap-3 text-sm bg-gray-50/60 rounded-2xl p-3 text-left hover:bg-gray-100 hover:ring-1 hover:ring-gray-200 transition-all">
                <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <ItemImage image={it.image} alt={it.name} thumb className="w-11 h-11 rounded-xl object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-900 truncate">{it.name}</p>
                  <p className="text-xs text-gray-500">{it.category}{it.demand >= 0 ? ` · demand ${it.demand}/mo` : ''}</p>
                </div>
                <ChevronRight size={14} className="text-gray-300 shrink-0" />
              </button>
            ))}
            {smartModal === 'never' && underperforming.map((it) => (
              <button key={it.id} type="button" onClick={() => onSaleItem({ id: it.id, name: it.name })}
                title={`Put ${it.name} on sale`}
                className="w-full flex items-center gap-3 bg-orange-50/60 rounded-2xl p-3 text-sm text-left hover:bg-orange-50 hover:ring-1 hover:ring-orange-200 transition-all">
                <ItemImage image={it.image || imgById.get(it.id)} alt={it.name} thumb className="w-11 h-11 rounded-xl object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-900 truncate">{it.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{it.category} · never rented — put on sale</p>
                </div>
                <Tag size={14} className="text-orange-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
