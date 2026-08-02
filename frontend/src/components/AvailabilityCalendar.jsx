import { useState, useEffect } from 'react';
import { X, AlertCircle, CheckCircle2, Search } from 'lucide-react';
import { api } from '../utils/api';
import { useToast } from './Toast';
import ItemImage from './ItemImage';
import { Skeleton } from './Skeleton';

export default function AvailabilityCalendar({ item, onClose }) {
  const [blockedRanges, setBlockedRanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStart, setSelectedStart] = useState('');
  const [selectedEnd, setSelectedEnd] = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const { error: toastError } = useToast();

  useEffect(() => {
    api.get(`/inventory/blocked-dates/${item.id}`)
      .then(data => { setBlockedRanges(data.blockedRanges || []); })
      .catch((err) => { toastError(err?.message || 'Failed to load availability'); })
      .finally(() => setLoading(false));
  }, [item.id]);

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

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-100/80 bg-gray-50/50">
          <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden shrink-0 flex items-center justify-center">
            <ItemImage image={item.image} alt="" className="w-full h-full object-cover" placeholderSize={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm text-gray-900 truncate">{item.name}</h3>
            <p className="text-xs text-gray-400">Availability</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {loading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-4 w-1/3" />
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: 28 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 rounded-lg" />
                ))}
              </div>
              <Skeleton className="h-4 w-1/4 mt-2" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded-xl" />
                ))}
              </div>
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Blocked Dates</span>
                  <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{blockedRanges.length}</span>
                </div>
                {blockedRanges.length === 0 ? (
                  <div className="bg-emerald-50/50 rounded-xl py-5 text-center">
                    <CheckCircle2 size={22} className="text-emerald-400 mx-auto mb-1.5" />
                    <p className="text-sm font-semibold text-emerald-700">Fully Available</p>
                    <p className="text-[11px] text-emerald-600 mt-0.5">No bookings block this item.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {blockedRanges.map((range, i) => (
                      <div key={range.transactionId || i} className="flex items-center justify-between px-3 py-2 bg-red-50/70 rounded-lg">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                          <span className="text-xs font-medium text-red-700 whitespace-nowrap">
                            {range.start} — {range.end}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ml-2 ${
                          range.status === 'Active'
                            ? 'bg-blue-50 text-blue-600'
                            : 'bg-amber-50 text-amber-600'
                        }`}>
                          {range.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Search size={13} className="text-gray-400" />
                  <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Check Dates</span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] font-medium text-gray-400 mb-1 block">Start</label>
                    <input type="date" value={selectedStart} min={today}
                      onChange={e => { setSelectedStart(e.target.value); setCheckResult(null); }}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 transition-colors" />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-gray-400 mb-1 block">End</label>
                    <input type="date" value={selectedEnd} min={selectedStart || today}
                      onChange={e => { setSelectedEnd(e.target.value); setCheckResult(null); }}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 transition-colors" />
                  </div>
                </div>
                <button onClick={checkAvailability} disabled={!selectedStart || !selectedEnd || checking}
                  className="mt-2.5 w-full py-2 bg-[#bf4a53] text-white text-sm font-bold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {checking ? 'Checking...' : 'Check Availability'}
                </button>
                {checkResult && (
                  <div className={`mt-2.5 px-3 py-2 rounded-lg flex items-center gap-2 text-xs font-semibold ${
                    checkResult.available ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                  }`}>
                    {checkResult.available ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                    {checkResult.available ? 'Available for these dates' : checkResult.reason || 'Unavailable'}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
