import { useState, useEffect } from 'react';
import { X, AlertCircle, CheckCircle2, Search, CalendarDays } from 'lucide-react';
import { api } from '../utils/api';
import { useToast } from './Toast';
import ItemImage from './ItemImage';
import BookingCalendar from './BookingCalendar';
import { getSaleInfo } from './ItemCard';
import { Skeleton } from './Skeleton';
import { itemPill, txPill } from '../utils/statusColors';

// Item detail + availability view. Guests see it (and a "Sign In to Rent"
// button that redirects to sign-up); logged-in customers get "Rent Now".
export default function ItemDetailModal({ item, guest, onClose, onBook, onGuestBook }) {
  const [blockedRanges, setBlockedRanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStart, setSelectedStart] = useState('');
  const [selectedEnd, setSelectedEnd] = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const { error: toastError } = useToast();

  useEffect(() => {
    if (!item) return;
    setLoading(true);
    setCheckResult(null);
    setSelectedStart('');
    setSelectedEnd('');
    api.get(`/inventory/blocked-dates/${item.id}`)
      .then(data => setBlockedRanges(data.blockedRanges || []))
      .catch((err) => toastError(err?.message || 'Failed to load availability'))
      .finally(() => setLoading(false));
  }, [item?.id]);

  const checkAvailability = async () => {
    if (!selectedStart || !selectedEnd || checking) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await api.get(`/inventory/availability?itemId=${item.id}&rentalDate=${selectedStart}&dueDate=${selectedEnd}`);
      setCheckResult(res);
    } catch (err) {
      setCheckResult({ available: false, reason: 'Error checking availability' });
      toastError(err?.message || 'Failed to check availability');
    }
    setChecking(false);
  };

  if (!item) return null;
  const sale = getSaleInfo(item);

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-300 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-100 bg-gray-50/50">
          <div className="w-12 h-12 rounded-xl bg-gray-100 overflow-hidden shrink-0">
            <ItemImage image={item.image} alt="" className="w-full h-full object-cover" placeholderSize={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{item.category}{item.size ? ` · ${item.size}` : ''}</p>
            <h3 className="font-bold text-gray-900 truncate">{item.name}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {item.description && (
            <p className="text-sm text-gray-600 leading-relaxed">{item.description}</p>
          )}

          <div className="flex items-end gap-2">
            {sale.active ? (
              <>
                <span className="text-2xl font-extrabold text-[#bf4a53]">₱{sale.price.toLocaleString()}</span>
                <span className="text-gray-400 font-medium text-sm line-through">₱{item.price.toLocaleString()}</span>
                <span className="text-gray-400 font-medium text-xs mb-1">/ day</span>
              </>
            ) : (
              <span className="text-2xl font-extrabold text-gray-900">
                ₱{item.price.toLocaleString()} <span className="text-gray-400 font-medium text-sm">/ day</span>
              </span>
            )}
            <span className={`ml-auto text-[11px] font-bold px-2 py-1 rounded-full ${itemPill(item.status).bg} ${itemPill(item.status).text}`}>
              {item.status}
            </span>
          </div>

          {/* Availability */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <CalendarDays size={14} className="text-gray-400" />
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Availability</span>
            </div>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <div className="grid grid-cols-7 gap-1.5">
                  {Array.from({ length: 28 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 rounded-lg" />
                  ))}
                </div>
              </div>
            ) : blockedRanges.length === 0 ? (
              <div className="bg-emerald-50/50 rounded-xl py-4 text-center">
                <CheckCircle2 size={20} className="text-emerald-400 mx-auto mb-1" />
                <p className="text-sm font-semibold text-emerald-700">Fully Available</p>
                <p className="text-[11px] text-emerald-600 mt-0.5">No bookings block this item.</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {blockedRanges.map((range, i) => (
                  <div key={range.transactionId || i} className="flex items-center justify-between px-3 py-2 bg-red-50/70 rounded-lg">
                    <span className="text-xs font-medium text-red-700 whitespace-nowrap">{range.start} — {range.end}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ml-2 ${txPill(range.status).bg} ${txPill(range.status).text}`}>
                      {range.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Date check */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Search size={13} className="text-gray-400" />
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Check Dates</span>
            </div>
            <BookingCalendar
              pickup={selectedStart}
              event={selectedEnd}
              onChange={(p, e) => { setSelectedStart(p); setSelectedEnd(e); setCheckResult(null); }}
              bookedRanges={blockedRanges}
            />
            <button onClick={checkAvailability} disabled={!selectedStart || !selectedEnd || checking}
              className="mt-2.5 w-full py-2 bg-gray-900 text-white text-sm font-bold rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {checking ? 'Checking...' : 'Check Availability'}
            </button>
            {checkResult && (
              <div className={`mt-2.5 px-3 py-2 rounded-lg flex items-center gap-2 text-xs font-semibold ${checkResult.available ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {checkResult.available ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                {checkResult.available ? 'Available for these dates' : checkResult.reason || 'Unavailable'}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100">
          {guest ? (
            <button onClick={onGuestBook}
              className="w-full py-3 rounded-full bg-[#bf4a53] text-white font-bold hover:bg-[#a63f47] transition-colors">
              Sign In to Rent
            </button>
          ) : (
            <button onClick={onBook} disabled={item.status === 'OutOfService' || item.status === 'Deleted'}
              className={`w-full py-3 rounded-full font-bold transition-colors ${
                (item.status === 'OutOfService' || item.status === 'Deleted')
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-[#bf4a53] text-white hover:bg-[#a63f47]'
              }`}>
              {(item.status === 'Rented' || item.status === 'Overdue') ? 'Advance Book' : 'Rent Now'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
