// Smart actions — deterministic rules (no AI): restock what demand
// outruns, clear what's idle, clean what's wanted next. Pure presentational;
// `openSmartModal` opens a full list, `openCleanQueue` the queue modal.
import { TrendingUp, AlertTriangle, RotateCcw, ChevronRight, PackageCheck, BadgeCheck, Sparkles } from 'lucide-react';
import ItemImage from '../ItemImage';

// Shared empty state so the three cards line up: soft icon chip + message.
function EmptyState({ icon: Icon, tint, title, children }) {
  return (
    <div className="flex flex-col items-center text-center py-5 gap-2">
      <span className={`w-11 h-11 rounded-2xl flex items-center justify-center ${tint}`}>
        <Icon size={20} />
      </span>
      <p className="text-sm font-bold text-gray-700">{title}</p>
      {children && <div className="text-xs text-gray-400 max-w-[240px]">{children}</div>}
    </div>
  );
}

const fmtProj = (n) => (Math.round(n * 10) / 10).toLocaleString();

export default function SmartActions({
  restockRules, restockWatch = [], clearanceRules, cleaningRules,
  openSmartModal, openCleanQueue,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm space-y-3">
        <button type="button" onClick={() => restockRules.length > 0 && openSmartModal('restock')}
          disabled={restockRules.length === 0}
          className={`w-full flex items-center gap-2 text-left rounded-xl ${restockRules.length > 0 ? 'group cursor-pointer' : 'cursor-default'}`}>
          <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2 flex-1">
            <TrendingUp size={17} className="text-emerald-600" /> Restock
          </h3>
          {restockRules.length > 0 && (
            <>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-0.5">{restockRules.length}</span>
              <ChevronRight size={15} className="text-gray-300 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all" />
            </>
          )}
        </button>
        {restockRules.length === 0 ? (
          <EmptyState icon={PackageCheck} tint="bg-emerald-50 text-emerald-600" title="No category is short">
            {restockWatch.length > 0 ? (
              <>
                Flags when projected demand outruns free pieces and demand is rising or 80%+ is out.
                {restockWatch.map((w) => (
                  <p key={w.category} className="mt-1.5 text-gray-500">
                    Watch <span className="font-bold text-gray-700">{w.category}</span>: {w.freeUnits} free vs ~{fmtProj(w.projection)}/mo
                    {w.trend === 'down' ? ' · demand easing' : w.trend === 'flat' ? ' · demand steady' : ''}
                  </p>
                ))}
              </>
            ) : 'Stock covers projected demand.'}
          </EmptyState>
        ) : (
          restockRules.slice(0, 4).map((r) => (
            <div key={r.category} className="bg-emerald-50/60 rounded-2xl px-4 py-3 text-sm">
              <p className="font-bold text-gray-900">{r.category} <span className="text-emerald-600">+{r.shortfall} pc{r.shortfall === 1 ? '' : 's'}</span></p>
              <p className="text-xs text-gray-500 mt-0.5">Projected {r.projection}/mo · {r.freeUnits} free · {r.reason}</p>
            </div>
          ))
        )}
        {restockRules.length > 4 && (
          <button type="button" onClick={() => openSmartModal('restock')}
            className="w-full py-2 rounded-xl text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition-colors">
            View all {restockRules.length}
          </button>
        )}
      </div>
      <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm space-y-3">
        <button type="button" onClick={() => clearanceRules.length > 0 && openSmartModal('clearance')}
          disabled={clearanceRules.length === 0}
          className={`w-full flex items-center gap-2 text-left rounded-xl ${clearanceRules.length > 0 ? 'group cursor-pointer' : 'cursor-default'}`}>
          <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2 flex-1">
            <AlertTriangle size={17} className="text-orange-500" /> Clearance
          </h3>
          {clearanceRules.length > 0 && (
            <>
              <span className="text-[11px] font-bold text-orange-600 bg-orange-50 rounded-full px-2.5 py-0.5">{clearanceRules.length}</span>
              <ChevronRight size={15} className="text-gray-300 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all" />
            </>
          )}
        </button>
        {clearanceRules.length === 0 ? (
          <EmptyState icon={BadgeCheck} tint="bg-orange-50 text-orange-500" title="Nothing idle">
            Every piece has rented recently — no clearance needed.
          </EmptyState>
        ) : (
          clearanceRules.slice(0, 4).map((it) => (
            <div key={it.id} className="flex items-center gap-3 bg-orange-50/60 rounded-2xl p-3 text-sm">
              <ItemImage image={it.image} alt={it.name} thumb className="w-10 h-10 rounded-xl object-cover shrink-0" />
              <div className="min-w-0">
                <p className="font-bold text-gray-900 truncate">{it.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{it.category} · {it.reason} — put on sale</p>
              </div>
            </div>
          ))
        )}
        {clearanceRules.length > 4 && (
          <button type="button" onClick={() => openSmartModal('clearance')}
            className="w-full py-2 rounded-xl text-xs font-bold text-orange-600 hover:bg-orange-50 transition-colors">
            View all {clearanceRules.length}
          </button>
        )}
      </div>
      <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm space-y-3">
        <button type="button" onClick={() => cleaningRules.length > 0 && openSmartModal('cleaning')}
          disabled={cleaningRules.length === 0}
          className={`w-full flex items-center gap-2 text-left rounded-xl ${cleaningRules.length > 0 ? 'group cursor-pointer' : 'cursor-default'}`}>
          <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2 flex-1">
            <RotateCcw size={17} className="text-[#bf4a53]" /> Clean next
          </h3>
          {cleaningRules.length > 0 && (
            <>
              <span className="text-[11px] font-bold text-[#bf4a53] bg-[#bf4a53]/5 rounded-full px-2.5 py-0.5">{cleaningRules.length}</span>
              <ChevronRight size={15} className="text-gray-300 group-hover:text-[#bf4a53] group-hover:translate-x-0.5 transition-all" />
            </>
          )}
        </button>
        {cleaningRules.length === 0 ? (
          <EmptyState icon={Sparkles} tint="bg-[#bf4a53]/5 text-[#bf4a53]" title="Cleaning queue is empty">
            Everything returned is cleaned and ready to rent.
          </EmptyState>
        ) : (
          cleaningRules.slice(0, 4).map((it, i) => (
            <button key={it.id} type="button" onClick={() => openCleanQueue(it)}
              title="Open in the cleaning queue"
              className="w-full flex items-center gap-3 text-sm text-left rounded-xl hover:bg-gray-50 active:scale-[0.99] transition-all">
              <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <ItemImage image={it.image} alt={it.name} thumb className="w-10 h-10 rounded-xl object-cover shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-gray-900 truncate">{it.name}</p>
                <p className="text-xs text-gray-500">{it.category}{it.demand >= 0 ? ` · demand ${it.demand}/mo` : ''}</p>
              </div>
              <ChevronRight size={14} className="text-gray-300 shrink-0" />
            </button>
          ))
        )}
        {cleaningRules.length > 4 && (
          <button type="button" onClick={() => openSmartModal('cleaning')}
            className="w-full py-2 rounded-xl text-xs font-bold text-[#bf4a53] hover:bg-[#bf4a53]/5 transition-colors">
            View all {cleaningRules.length}
          </button>
        )}
      </div>
    </div>
  );
}
