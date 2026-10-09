import { useEffect, useRef, useState } from 'react';
import { Edit3, Trash2, Calendar, CheckCircle2, Wrench, RotateCcw } from 'lucide-react';
import ItemImage from './ItemImage';
import { SkeletonCard } from './Skeleton';
import { itemPill } from '../utils/statusColors';
import { normalizeOccasions } from '../utils/occasions';

// Determine whether a sale is currently active and the resulting price.
// A 100%+ discount (free/negative price) is treated as corrupt data, not a
// real sale — the card falls back to the regular price with no badge.
export function getSaleInfo(item) {
  const now = Date.now();
  const active = !!item.onSale && (!item.saleEndsAt || new Date(item.saleEndsAt).getTime() > now);
  if (!active) return { active: false, price: item.price, pct: 0 };
  let price = item.price;
  let pct = 0;
  if (item.salePrice != null && item.salePrice > 0) {
    price = item.salePrice;
  } else if (item.discountPct != null && item.discountPct > 0 && item.discountPct < 100) {
    pct = item.discountPct;
    price = Math.round(item.price * (1 - item.discountPct / 100));
  }
  if (!(price > 0)) return { active: false, price: item.price, pct: 0 };
  return { active: true, price, pct };
}

// Holds a card on its skeleton until its photo settles (loaded or
// definitively failed — never forever). The hidden eager preloader starts
// only when the card nears the viewport, so below-fold grids keep the lazy
// fetch behavior instead of downloading every thumb on mount.
function useImageGate(item) {
  const [ready, setReady] = useState(!item?.image);
  const [inView, setInView] = useState(false);
  const ref = useRef(null);
  const imageKey = item?.image;
  const idKey = item?.id;
  useEffect(() => { setReady(!item?.image); }, [idKey, imageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (inView) return;
    if (typeof IntersectionObserver === 'undefined' || !ref.current) {
      setInView(true);
      return;
    }
    const el = ref.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);
  const markReady = () => setReady(true);
  const skeleton = (
    <div ref={ref}>
      <SkeletonCard />
      {inView && !!item?.image && (
        <span className="hidden" aria-hidden="true">
          <ItemImage thumb image={item.image} alt="" eager onSettled={markReady} />
        </span>
      )}
    </div>
  );
  return { ready, skeleton };
}

function StaffCard({ item, meta, StatusIcon, onBook, onEdit, onDelete, onRestore, onCheckAvailability, onStatusChange, onMarkOutOfService }) {
  const sale = getSaleInfo(item);
  const gate = useImageGate(item);
  if (!gate.ready) return gate.skeleton;
  // Only bookable statuses go straight to booking on tap — the backend
  // rejects Cleaning (409) and OutOfService (400), and Deleted items are
  // archived, so those cards stay non-clickable with their lifecycle action.
  const bookable = !!onBook && (item.status === 'Available' || item.status === 'Rented' || item.status === 'Reserved');
  const stop = (e) => e.stopPropagation();
  const activateBooking = (e) => { if (bookable) { e?.stopPropagation?.(); onBook(); } };
  return (
    <div onClick={bookable ? () => onBook() : undefined} title={bookable ? 'Tap to book for customer' : undefined}
      className={`bg-white rounded-2xl border border-gray-100/80 overflow-hidden shadow-sm hover:shadow-md transition-all group flex flex-col ${bookable ? 'cursor-pointer' : ''}`}>
      <div className="relative aspect-[4/5] bg-gray-50 overflow-hidden">
        <button type="button" onClick={activateBooking} disabled={!bookable} aria-label={bookable ? `Book ${item.name} for customer` : item.name}
          className={`absolute inset-0 w-full h-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#bf4a53]/60 ${bookable ? 'cursor-pointer' : 'cursor-default'}`}>
          <ItemImage thumb image={item.image} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
        </button>
        {sale.active && (
          <div className="absolute top-2 right-2 sm:top-2.5 sm:right-2.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full border border-[#bf4a53]/30 bg-[#bf4a53]/10 text-[9px] sm:text-[10px] font-bold shadow-sm text-[#bf4a53] pointer-events-none">
            {sale.pct > 0 ? `-${sale.pct}%` : 'SALE'}
          </div>
        )}
        <div className={`absolute ${sale.active ? 'top-9 sm:top-10' : 'top-2 sm:top-2.5'} right-2 sm:right-2.5 inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full border text-[9px] sm:text-[10px] font-bold shadow-sm pointer-events-none ${meta.bg} ${meta.border} ${meta.text}`}>
          <StatusIcon size={10} />
          {meta.label}
        </div>
        <div className="absolute top-2 left-2 sm:top-2.5 sm:left-2.5 flex items-center gap-1" onClick={stop}>
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
        {/* Lifecycle — highlighted pill overlaid at the bottom of the photo.
            Taps stop here and never fall through to the card's booking tap.
            Rented/Reserved need no action (derived from bookings); Deleted
            has its restore icon top-left. */}
        {onStatusChange && item.status !== 'Deleted' &&
          ((item.status === 'Available' && onMarkOutOfService) || item.status === 'Cleaning' || item.status === 'OutOfService') && (
          <div className="absolute bottom-2 inset-x-2 z-10 flex justify-center pointer-events-none">
            {item.status === 'Available' && onMarkOutOfService ? (
              <button onClick={(e) => { e.stopPropagation(); onMarkOutOfService(item); }}
                title="Item is damaged or needs repair — remove it from the catalog until restored"
                className="pointer-events-auto inline-flex items-center justify-center gap-1.5 px-5 py-2 text-[11px] font-bold text-red-600 bg-white/95 backdrop-blur-sm border border-red-200 hover:bg-red-50 rounded-full shadow-lg shadow-black/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50">
                <Wrench size={12} />
                Pull from rental
              </button>
            ) : item.status === 'Cleaning' ? (
              <button onClick={(e) => { e.stopPropagation(); onStatusChange(item.id, 'Available'); }}
                title="Washed and ready — put the item back in the catalog"
                className="pointer-events-auto inline-flex items-center justify-center gap-1.5 px-5 py-2 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-full shadow-lg shadow-emerald-900/30 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50">
                <CheckCircle2 size={12} />
                Mark as clean
              </button>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); onStatusChange(item.id, 'Available'); }}
                title="Repair complete — put the item back in the catalog"
                className="pointer-events-auto inline-flex items-center justify-center gap-1.5 px-5 py-2 text-[11px] font-bold text-emerald-700 bg-white/95 backdrop-blur-sm border border-emerald-300 hover:bg-emerald-50 rounded-full shadow-lg shadow-black/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50">
                <RotateCcw size={12} />
                Restore to Available
              </button>
            )}
          </div>
        )}
      </div>

      <div className="p-3 sm:p-4 space-y-2 flex flex-col flex-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{item.category}</span>
          </div>
          <button type="button" onClick={activateBooking} disabled={!bookable}
            className={`font-bold text-gray-900 text-[13px] leading-tight truncate block max-w-full ${bookable ? 'hover:text-[#bf4a53] transition-colors text-left' : 'text-left cursor-default'}`}>
            {item.name}
          </button>
          {normalizeOccasions(item.occasions).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {normalizeOccasions(item.occasions).slice(0, 2).map((occ) => (
                <span key={occ} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] border border-[#bf4a53]/20">
                  {occ}
                </span>
              ))}
              {normalizeOccasions(item.occasions).length > 2 && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  +{normalizeOccasions(item.occasions).length - 2}
                </span>
              )}
            </div>
          )}
          <p className="font-bold text-[13px]">
            {sale.active ? (
              <>
                <span className="text-[#bf4a53]">₱{sale.price.toLocaleString()}</span>
                <span className="text-gray-400 font-medium text-xs line-through ml-1.5">₱{item.price.toLocaleString()}</span>
              </>
            ) : (
              <span className="text-gray-900">₱{item.price.toLocaleString()}</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ItemCard({ item, role, onBook, onEdit, onDelete, onRestore, onCheckAvailability, onStatusChange, onMarkOutOfService, guest, onViewDetail }) {
  const isAdmin = role === 'Admin';
  const isStaff = role !== 'Customer';
  const meta = itemPill(item.status);
  const StatusIcon = meta.icon;
  const gate = useImageGate(item);
  if (!gate.ready) return gate.skeleton;

  if (isStaff) {
    if (isAdmin) {
      return (
        <StaffCard item={item} meta={meta} StatusIcon={StatusIcon}
          onBook={undefined} onEdit={onEdit} onDelete={onDelete} onRestore={onRestore}
          onCheckAvailability={onCheckAvailability} onStatusChange={onStatusChange} onMarkOutOfService={onMarkOutOfService} />
      );
    }
    return (
      <StaffCard item={item} meta={meta} StatusIcon={StatusIcon}
        onBook={onBook} onEdit={onEdit} onDelete={onDelete} onRestore={onRestore}
        onCheckAvailability={onCheckAvailability} onStatusChange={onStatusChange} onMarkOutOfService={onMarkOutOfService} />
    );
  }

  const sale = getSaleInfo(item);
  // Whole card taps straight into booking for signed-in customers (the
  // booking flow checks availability itself as part of the wizard).
  // Guests can't book, so their tap still opens details (Sign In to Rent).
  // When no book handler exists, fall back to details.
  const book = onBook ? () => onBook() : undefined;
  const view = onViewDetail ? () => onViewDetail(item) : undefined;
  const activate = guest ? view : (book ?? view);
  return (
    <div
      data-tour="book"
      onClick={activate}
      onKeyDown={activate ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } } : undefined}
      tabIndex={activate ? 0 : undefined}
      role={activate ? 'button' : undefined}
      aria-label={activate ? `${item.name}, ₱${item.price.toLocaleString()}` : undefined}
      title={activate ? (book && activate === book ? `Book ${item.name}` : `View ${item.name}`) : undefined}
      className={`bg-white rounded-2xl border border-gray-100/80 overflow-hidden shadow-sm hover:shadow-md transition-all group flex flex-col ${activate ? 'cursor-pointer' : ''}`}>
      <div className="relative aspect-[4/5] bg-gray-50 overflow-hidden">
        <ItemImage thumb image={item.image} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
        {sale.active && (
          <span className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[#bf4a53]/30 bg-[#bf4a53]/10 text-[9px] font-bold shadow-sm text-[#bf4a53] pointer-events-none">
            {sale.pct > 0 ? `-${sale.pct}%` : 'SALE'}
          </span>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1 gap-1">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{item.category}</div>
        <h3 className="font-bold text-gray-900 text-sm leading-tight line-clamp-2">{item.name}</h3>
        {normalizeOccasions(item.occasions).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {normalizeOccasions(item.occasions).slice(0, 2).map((occ) => (
              <span key={occ} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] border border-[#bf4a53]/20">
                {occ}
              </span>
            ))}
            {normalizeOccasions(item.occasions).length > 2 && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                +{normalizeOccasions(item.occasions).length - 2}
              </span>
            )}
          </div>
        )}
        <p className="font-extrabold text-lg tracking-tight mt-0.5">
          {sale.active ? (
            <>
              <span className="text-[#bf4a53]">₱{sale.price.toLocaleString()}</span>
              <span className="text-gray-400 font-semibold text-xs line-through ml-1.5">₱{item.price.toLocaleString()}</span>
            </>
          ) : (
            <span className="text-gray-900">₱{item.price.toLocaleString()}</span>
          )}
        </p>
      </div>
    </div>
  );
}