import { Edit3, Trash2, RotateCcw, Calendar, Eye } from 'lucide-react';
import ItemImage from './ItemImage';
import { itemPill } from '../utils/statusColors';

// Determine whether a sale is currently active and the resulting price.
export function getSaleInfo(item) {
  const now = Date.now();
  const active = !!item.onSale && (!item.saleEndsAt || new Date(item.saleEndsAt).getTime() > now);
  if (!active) return { active: false, price: item.price, pct: 0 };
  let price = item.price;
  let pct = 0;
  if (item.salePrice != null && item.salePrice > 0) {
    price = item.salePrice;
  } else if (item.discountPct != null && item.discountPct > 0) {
    pct = item.discountPct;
    price = Math.round(item.price * (1 - item.discountPct / 100));
  }
  return { active: true, price, pct };
}

function StaffCard({ item, meta, StatusIcon, onBook, onEdit, onDelete, onRestore, onCheckAvailability, onStatusChange, onMarkOutOfService, showBook }) {
  const sale = getSaleInfo(item);
  return (
    <div className="bg-white rounded-2xl border border-gray-100/80 overflow-hidden shadow-sm hover:shadow-md transition-all group">
      <div className="relative aspect-[9/16] bg-gray-50 overflow-hidden">
        <ItemImage image={item.image} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
        <ItemImage image={item.image} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
        {sale.active && (
          <div className="absolute top-2 right-2 sm:top-2.5 sm:right-2.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full border border-[#bf4a53]/30 bg-[#bf4a53]/10 text-[9px] sm:text-[10px] font-bold shadow-sm text-[#bf4a53]">
            {sale.pct > 0 ? `-${sale.pct}%` : 'SALE'}
          </div>
        )}
        <div className={`absolute ${sale.active ? 'top-9 sm:top-10' : 'top-2 sm:top-2.5'} right-2 sm:right-2.5 inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full border text-[9px] sm:text-[10px] font-bold shadow-sm ${meta.bg} ${meta.border} ${meta.text}`}>
          <StatusIcon size={10} />
          {meta.label}
        </div>
        <div className="absolute top-2 left-2 sm:top-2.5 sm:left-2.5 flex items-center gap-1">
          <button onClick={onEdit} aria-label={`Edit ${item.name}`}
            className="p-1 sm:p-1.5 bg-white/90 backdrop-blur-sm rounded-lg shadow-sm text-gray-500 hover:text-gray-800 hover:bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50" title="Edit item">
            <Edit3 size={13} />
          </button>
          <button onClick={onCheckAvailability} aria-label={`View availability for ${item.name}`}
            className="p-1 sm:p-1.5 bg-white/90 backdrop-blur-sm rounded-lg shadow-sm text-gray-500 hover:text-gray-800 hover:bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50" title="View availability">
            <Calendar size={13} />
          </button>
          {onRestore && item.status === 'Deleted' && (
            <button onClick={onRestore} aria-label={`Restore ${item.name}`}
              className="p-1 sm:p-1.5 bg-white/90 backdrop-blur-sm rounded-lg shadow-sm text-emerald-600 hover:text-emerald-700 hover:bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50" title="Restore item">
              <RotateCcw size={13} />
            </button>
          )}
          {onDelete && item.status !== 'Deleted' && (
            <button onClick={onDelete} aria-label={`Delete ${item.name}`}
              className="p-1 sm:p-1.5 bg-white/90 backdrop-blur-sm rounded-lg shadow-sm text-gray-500 hover:text-red-600 hover:bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50" title="Delete item">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="p-2.5 sm:p-3 space-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{item.category}</span>
            {item.size && <><span className="text-gray-300 text-[9px]">·</span><span className="text-[9px] font-medium text-gray-400">{item.size}</span></>}
          </div>
          <h3 className="font-bold text-gray-900 text-[13px] leading-tight truncate">{item.name}</h3>
          <p className="font-bold text-[13px]">
            {sale.active ? (
              <>
                <span className="text-[#bf4a53]">₱{sale.price.toLocaleString()}</span>
                <span className="text-gray-400 font-medium text-xs line-through ml-1.5">₱{item.price.toLocaleString()}</span>
                <span className="text-gray-400 font-medium text-xs"> / day</span>
              </>
            ) : (
              <span className="text-gray-900">₱{item.price.toLocaleString()} <span className="text-gray-400 font-medium text-xs">/ day</span></span>
            )}
          </p>
        </div>

        {showBook && item.status !== 'Deleted' && (
          <button onClick={onBook}
            className="w-full flex items-center justify-center gap-1.5 py-2 bg-[#bf4a53] text-white text-[11px] font-semibold rounded-lg hover:bg-red-700 transition-colors shadow-sm">
            <Calendar size={12} />
            Book for Customer
          </button>
        )}

        {/* Manual lifecycle actions only. Rented/Reserved are derived from
            transactions (read-only) — staff can't flip them by hand. */}
        {onStatusChange && item.status !== 'Deleted' && (
          <div>
            <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">Actions</span>
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {item.status === 'Cleaning' && (
                <button onClick={() => onStatusChange(item.id, 'Available')}
                  className="flex-1 text-[9px] font-bold py-1 rounded-md border transition-all bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm hover:bg-emerald-100">
                  Mark Cleaned
                </button>
              )}
              {item.status === 'OutOfService' && (
                <button onClick={() => onStatusChange(item.id, 'Available')}
                  className="flex-1 text-[9px] font-bold py-1 rounded-md border transition-all bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm hover:bg-emerald-100">
                  Restore
                </button>
              )}
              {(item.status === 'Available' || item.status === 'Cleaning') && onMarkOutOfService && (
                <button onClick={() => onMarkOutOfService(item)}
                  className="flex-1 text-[9px] font-bold py-1 rounded-md border transition-all bg-white text-red-500 border-red-200 hover:bg-red-50">
                  Out of Service
                </button>
              )}
              {item.status !== 'Cleaning' && item.status !== 'OutOfService' && (
                <span className="text-[9px] font-medium text-gray-400 py-1">
                  Status auto-syncs with bookings
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ItemCard({ item, role, onBook, onEdit, onDelete, onRestore, onCheckAvailability, onStatusChange, onMarkOutOfService, guest, onViewDetail }) {
  const isAdmin = role === 'Admin';
  const isStaff = role !== 'Customer';
  const meta = itemPill(item.status);
  const StatusIcon = meta.icon;

  if (isStaff) {
    if (isAdmin) {
      return (
        <StaffCard item={item} meta={meta} StatusIcon={StatusIcon}
          onBook={() => {}} onEdit={onEdit} onDelete={onDelete} onRestore={onRestore}
          onCheckAvailability={onCheckAvailability} onStatusChange={onStatusChange} onMarkOutOfService={onMarkOutOfService} showBook={false} />
      );
    }
    return (
      <StaffCard item={item} meta={meta} StatusIcon={StatusIcon}
        onBook={onBook} onEdit={onEdit} onDelete={onDelete} onRestore={onRestore}
        onCheckAvailability={onCheckAvailability} onStatusChange={onStatusChange} onMarkOutOfService={onMarkOutOfService} showBook={true} />
    );
  }

  const sale = getSaleInfo(item);
  return (
    <div
      className="bg-white rounded-2xl border border-gray-100/80 overflow-hidden shadow-sm hover:shadow-md transition-all group flex flex-col">
      <button type="button" onClick={() => onViewDetail?.(item)} aria-label={`View ${item.name}`}
        className="relative aspect-[4/5] bg-gray-50 overflow-hidden w-full text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#bf4a53]/60">
        <ItemImage image={item.image} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
        {sale.active && (
          <span className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[#bf4a53]/30 bg-[#bf4a53]/10 text-[9px] font-bold shadow-sm text-[#bf4a53]">
            {sale.pct > 0 ? `-${sale.pct}%` : 'SALE'}
          </span>
        )}
      </button>
      <div className="p-4 flex flex-col flex-1 gap-1">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{item.category}</div>
        <h3 className="font-bold text-gray-900 text-sm leading-tight line-clamp-2">{item.name}</h3>
        <p className="font-bold text-sm">
          {sale.active ? (
            <>
              <span className="text-[#bf4a53]">₱{sale.price.toLocaleString()}</span>
              <span className="text-gray-400 font-medium text-xs line-through ml-1.5">₱{item.price.toLocaleString()}</span>
            </>
          ) : (
            <span className="text-gray-900">₱{item.price.toLocaleString()}</span>
          )}
        </p>
        {(() => {
          const disabled = !guest && (item.status === 'OutOfService' || item.status === 'Deleted');
          const sizingCls = 'w-full mt-3 font-bold py-2.5 rounded-full text-[13px] shadow-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60 flex items-center justify-center gap-2';
          if (guest) {
            return (
              <button data-tour="book" type="button"
                onClick={(e) => { e.stopPropagation(); onViewDetail?.(item); }}
                className={`${sizingCls} bg-white border border-[#bf4a53]/60 text-[#bf4a53] hover:bg-[#bf4a53] hover:text-white hover:shadow-lg hover:shadow-[#bf4a53]/25 active:scale-[0.98]`}
              >
                <Eye size={15} />
                View Details
              </button>
            );
          }
          if (disabled) {
            return (
              <button data-tour="book" type="button" disabled
                className={`${sizingCls} bg-gray-100 text-gray-400 cursor-not-allowed shadow-none`}>
                Unavailable
              </button>
            );
          }
          return (
            <button data-tour="book" type="button"
              onClick={(e) => { e.stopPropagation(); onBook?.(); }}
              className={`${sizingCls} bg-gradient-to-r from-[#b33842] via-[#bf4a53] to-[#d97079] text-white shadow-md shadow-[#bf4a53]/30 hover:shadow-lg hover:shadow-[#bf4a53]/40 hover:brightness-110 active:scale-[0.98]`}
            >
              <Calendar size={14} />
              <span>Rent Now</span>
            </button>
          );
        })()}
      </div>
    </div>
  );
}