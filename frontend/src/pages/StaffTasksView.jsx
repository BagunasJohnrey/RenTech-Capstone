import { useState, useMemo } from 'react';
import { X, ChevronLeft, ChevronRight, Undo2, MessageCircle, Calendar, Package, AlertTriangle } from 'lucide-react';
import { api } from '../utils/api';
import { customerLabel, itemLabel } from '../utils/format';
import ReleaseItemModal from '../components/ReleaseItemModal';
import { isReleased } from '../hooks/useTransactions';
import { txPill } from '../utils/statusColors';

export default function StaffTasksView({ transactions, inventory, onReturn, onNavigate, onRelease }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Calendar
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);

  // SMS
  const [smsModalTx, setSmsModalTx] = useState(null);
  const [releaseTx, setReleaseTx] = useState(null);

  // Recent Activity
  const [activityFilter, setActivityFilter] = useState('All');

  // Full-view modals
  const [showOverdueModal, setShowOverdueModal] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);

  // Ready for Pickup
  const pendingPickup = transactions.filter(tx =>
    (tx.status === 'Active' || tx.status === 'Reserved') && !isReleased(tx)
  );

  // Overdue data
  const overdueItems = transactions.filter(tx => {
    if (tx.status === 'Overdue') return true;
    if (tx.status !== 'Active') return false;
    const due = new Date(tx.dueDate || tx.date);
    return due < today;
  });

  const upcoming = transactions.filter(tx => {
    const txDate = new Date(tx.date);
    return txDate >= today;
  });

  // Activity history - sorted by date desc, filtered by status
  const filteredActivity = useMemo(() => {
    return [...transactions]
      .filter(tx => {
        if (activityFilter === 'All') return true;
        if (activityFilter === 'For Release') return (tx.status === 'Active' || tx.status === 'Reserved') && !isReleased(tx);
        return tx.status === activityFilter;
      })
      .sort((a, b) => new Date(b.date || b.rentalDate || 0) - new Date(a.date || a.rentalDate || 0));
  }, [transactions, activityFilter]);

  // --- Calendar ---
  const calendarTransactions = useMemo(() => {
    if (activityFilter === 'All') return transactions;
    if (activityFilter === 'For Release') return transactions.filter(tx => (tx.status === 'Active' || tx.status === 'Reserved') && !isReleased(tx));
    return transactions.filter(tx => tx.status === activityFilter);
  }, [transactions, activityFilter]);

  const statusMap = {};
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const dayTx = calendarTransactions.filter(tx => {
      const txDate = new Date(tx.date);
      return txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth && txDate.getDate() === day;
    });
    if (dayTx.length === 0) {
      statusMap[day] = 'none';
      continue;
    }
    const hasReturned = dayTx.some(t => t.status === 'Returned' || t.status === 'Cancelled');
    const hasActiveOrReserved = dayTx.some(t => t.status === 'Active' || t.status === 'Reserved' || t.status === 'Overdue');
    if (hasReturned && hasActiveOrReserved) statusMap[day] = 'mixed';
    else if (hasReturned) statusMap[day] = 'returned';
    else if (hasActiveOrReserved) statusMap[day] = 'active';
    else statusMap[day] = 'none';
  }

  const buildCalendar = () => {
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate();
    const weeks = [];
    let week = [];
    for (let i = 0; i < firstDay; i++) week.push(null);
    for (let day = 1; day <= totalDays; day++) {
      week.push({ day });
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      weeks.push(week);
    }
    return weeks;
  };
  const calendarWeeks = buildCalendar();

  const selectedDateBookings = selectedDate
    ? calendarTransactions.filter(tx => {
        const txDate = new Date(tx.date);
        return (
          txDate.getFullYear() === selectedDate.getFullYear() &&
          txDate.getMonth() === selectedDate.getMonth() &&
          txDate.getDate() === selectedDate.getDate()
        );
      })
    : null;

  const recentActivity = selectedDate
    ? selectedDateBookings
    : filteredActivity.slice(0, 5);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // FIX D: surface SMS success/failure; only close on success.
  const handleSendSMS = async (tx) => {
    setSendingSms(true);
    try {
      await api.post('/sms/send', {
        profileId: tx.customerId,
        transactionId: tx.id,
        message: `Hi ${customerLabel(tx.customer)}, your rental of ${itemLabel(tx.item)} is now overdue. Please return immediately to minimize penalties. Thank you!`,
      });
      setSendingSms(false);
      setSmsModalTx(null);
      alert('SMS sent successfully.');
    } catch (err) {
      setSendingSms(false);
      alert(err?.message || 'Failed to send SMS.');
    }
  };

  const goToPreviousMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Staff Tasks</h2>
          <p className="text-gray-500 font-medium mt-1">Overdue reminders & upcoming schedule.</p>
        </div>

        {/* Today's Focus — actionable daily queue (replaces KPI count row) */}
        <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 lg:p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Today's Priority</p>
            {(() => {
              // urgency: overdues first, then pickups due today (Active/Reserved due today), then upcoming tomorrow
              const now = new Date(); now.setHours(0,0,0,0);
              const pickupToday = pendingPickup.filter(tx => {
                const d = new Date(tx.rentalDate || tx.date);
                d.setHours(0,0,0,0);
                return d.getTime() === now.getTime();
              });
              const focusItems = [
                ...overdueItems.slice(0, 3).map(tx => ({
                  key: `od-${tx.id}`,
                  icon: AlertTriangle,
                  tone: 'text-red-500',
                  label: `${customerLabel(tx.customer)} — ${itemLabel(tx.item)}`,
                  sub: `${Math.floor((now - new Date(tx.dueDate || tx.date)) / 86400000)}d overdue`,
                })),
                ...pickupToday.slice(0, 2).map(tx => ({
                  key: `pk-${tx.id}`,
                  icon: Undo2,
                  tone: 'text-emerald-600',
                  label: `Prepare pickup for ${customerLabel(tx.customer)}`,
                  sub: `${itemLabel(tx.item)} due today`,
                })),
              ].slice(0, 4);

              if (focusItems.length === 0) {
                return <p className="text-xs text-emerald-600 font-semibold">All clear for today</p>;
              }
              return <p className="text-xs text-gray-400 font-medium">{focusItems.length} item{focusItems.length === 1 ? '' : 's'} requiring action</p>;
            })()}
          </div>

          <div className="space-y-2">
            {(() => {
              const now = new Date(); now.setHours(0,0,0,0);
              const pickupToday = pendingPickup.filter(tx => {
                const d = new Date(tx.rentalDate || tx.date); d.setHours(0,0,0,0);
                return d.getTime() === now.getTime();
              });
              const focusItems = [
                ...overdueItems.slice(0, 3).map(tx => ({
                  key: `od-${tx.id}`,
                  icon: AlertTriangle,
                  tone: 'text-red-500',
                  bg: 'bg-red-50 border-red-200/70',
                  label: `${customerLabel(tx.customer)} — ${itemLabel(tx.item)}`,
                  sub: `${Math.floor((now - new Date(tx.dueDate || tx.date)) / 86400000)}d overdue`,
                  action: () => setShowOverdueModal(true),
                })),
                ...pickupToday.slice(0, 2).map(tx => ({
                  key: `pk-${tx.id}`,
                  icon: Undo2,
                  tone: 'text-emerald-600',
                  bg: 'bg-emerald-50 border-emerald-200/70',
                  label: `Prepare pickup for ${customerLabel(tx.customer)}`,
                  sub: `${itemLabel(tx.item)} due today`,
                  action: () => onNavigate && onNavigate('History'),
                })),
              ].slice(0, 4);

              if (focusItems.length === 0) {
                return (
                  <div className="text-center py-6 text-gray-400 text-sm font-medium">
                    Nothing urgent today.
                  </div>
                );
              }

              return focusItems.map((f) => (
                <button key={f.key} onClick={f.action}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all hover:shadow-sm hover:scale-[1.01] ${f.bg}`}>
                  <f.icon size={16} className={`${f.tone} shrink-0`} />
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-bold text-gray-900 truncate">{f.label}</p>
                    <p className="text-[11px] text-gray-500 truncate">{f.sub}</p>
                  </div>
                  <ChevronRight size={16} className="text-gray-300 shrink-0" />
                </button>
              ));
            })()}
          </div>
        </div>

      {/* Inline Overdue Section */}
      {showOverdueModal && (
        <div className="bg-white rounded-3xl border border-red-100/50 shadow-sm overflow-hidden">
          <div className="flex justify-between items-center p-5 border-b border-red-100/50 bg-red-50/30">
            <div>
              <h3 className="font-bold text-lg text-gray-900">All Overdue Rentals</h3>
              <p className="text-xs text-gray-500">{overdueItems.length} item(s) overdue</p>
            </div>
            <button onClick={() => setShowOverdueModal(false)}
              className="text-gray-400 hover:bg-gray-200 p-2 rounded-full transition-colors">
              <X size={20} />
            </button>
          </div>
          <div className="p-4 space-y-2.5 max-h-[400px] overflow-y-auto">
            {overdueItems.map((tx) => {
              const dueDate = new Date(tx.dueDate || tx.date);
              const now = new Date(); now.setHours(0, 0, 0, 0);
              const diffMs = now - dueDate;
              const daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));
              const initial = (tx.customer || '?').charAt(0).toUpperCase();
              const isOverduePickedUp = inventory.some(i => i.id === tx.itemId && i.status === 'Rented');
              return (
                <div key={tx.id} className="flex items-start gap-3 p-4 bg-red-50/70 rounded-2xl border border-red-100/50">
                  <div className="w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{initial}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-gray-900 truncate">{customerLabel(tx.customer)}</p>
                      <span className="shrink-0 text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full whitespace-nowrap">{daysOverdue === 0 ? 'Due today' : `${daysOverdue}d overdue`}</span>
                    </div>
                    <p className="text-xs text-gray-600 truncate mt-0.5">{itemLabel(tx.item)}</p>
                    <p className="text-[11px] text-red-500 font-medium mt-0.5">Due {dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                    <div className="flex items-center gap-2 mt-2.5">
                      <button onClick={() => { setShowOverdueModal(false); setSmsModalTx(tx); }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-bold text-white bg-[#bf4a53] hover:bg-red-700 rounded-full transition-colors shadow-sm">
                        <MessageCircle size={12} /> Send SMS
                      </button>
                      {onReturn && isOverduePickedUp && isReleased(tx) && (
                        <button onClick={() => { setShowOverdueModal(false); onReturn(tx); }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-full transition-colors">
                          <Undo2 size={12} /> Return
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Recent Activity Card */}
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-gray-900">
                  {selectedDate ? 'Bookings' : 'Recent Activity'}
                </h3>
                {selectedDate && (
                  <span className="text-xs font-semibold text-gray-500">
                    {selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedDate && (
                  <button onClick={() => setSelectedDate(null)}
                    className="text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors">
                    Clear
                  </button>
                )}
                <button
                  onClick={() => onNavigate && onNavigate('History')}
                  className="text-sm font-semibold text-[#bf4a53] hover:underline"
                >
                  View All
                </button>
              </div>
            </div>

            {/* Filter capsule */}
            <div className="flex justify-center mb-5 px-1">
              <div className="inline-flex flex-wrap items-center justify-center gap-1.5 bg-gray-100/80 rounded-2xl px-2 py-2 max-w-full">
                <button
                  onClick={() => setActivityFilter('All')}
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    activityFilter === 'All' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setActivityFilter('Reserved')}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    activityFilter === 'Reserved' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-indigo-400" />
                  Reserved
                </button>
                <button
                  onClick={() => setActivityFilter('Active')}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    activityFilter === 'Active' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  Active
                </button>
                <button
                  onClick={() => setActivityFilter('Returned')}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    activityFilter === 'Returned' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Returned
                </button>
                <button
                  onClick={() => setActivityFilter('For Release')}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    activityFilter === 'For Release' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-teal-500" />
                  For Release
                </button>
              </div>
            </div>

            {/* Activity list */}
            <div className="space-y-1">
              {recentActivity.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No recent activity.</p>
              ) : (
                recentActivity.map((tx, i) => {
                  const initial = (tx.customer || '?').charAt(0).toUpperCase();
                  const dueDate = new Date(tx.dueDate || tx.date);
                  const now = new Date(); now.setHours(0, 0, 0, 0);
                  const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
                  const showActions = tx.status === 'Active' || tx.status === 'Overdue';
                  const isPickedUp = showActions && inventory.some(i => i.id === tx.itemId && i.status === 'Rented');
                  return (
                    <div key={tx.id}>
                      <div className="flex items-center gap-3.5 px-1 py-3">
                        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                          <span className="text-sm font-bold text-gray-500">{initial}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-900 truncate">{customerLabel(tx.customer)}</p>
                          <p className="text-xs text-gray-500 truncate">{itemLabel(tx.item)}</p>
                          {showActions && (
                            <p className={`text-[11px] font-medium mt-0.5 ${tx.status === 'Overdue' ? 'text-red-500' : 'text-blue-600'}`}>
                              {tx.status === 'Overdue' ? `${daysOverdue}d overdue` : `Due ${dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {showActions && (
                            <>
                              <button onClick={(e) => { e.stopPropagation(); setSmsModalTx(tx); }}
                                className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-full transition-colors" title="Send SMS">
                                <MessageCircle size={14} />
                              </button>
                              {!isReleased(tx) && (tx.status === 'Active' || tx.status === 'Reserved') && (
                                <button onClick={(e) => { e.stopPropagation(); setReleaseTx(tx); }}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full transition-colors" title="Release Item">
                                  <Package size={14} />
                                </button>
                              )}
                              {onReturn && isPickedUp && isReleased(tx) && (
                                <button onClick={(e) => { e.stopPropagation(); onReturn(tx); }}
                                  className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-full transition-colors" title="Process Return">
                                  <Undo2 size={14} />
                                </button>
                              )}
                            </>
                          )}
                          <span className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-bold ${txPill(tx.status).bg} ${txPill(tx.status).text}`}>
                            {tx.status || '—'}
                          </span>
                        </div>
                      </div>
                      {i < recentActivity.length - 1 && <div className="border-b border-gray-100 mx-1" />}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Calendar Card */}
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Calendar size={20} className="text-gray-700" />
                {monthNames[currentMonth]} {currentYear}
              </h3>
              <div className="flex items-center gap-1">
                <button onClick={goToPreviousMonth}
                  className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500 transition-colors">
                  <ChevronLeft size={16} />
                </button>
                <button onClick={goToNextMonth}
                  className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500 transition-colors">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* Days of week */}
            <div className="grid grid-cols-7 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat'].map(d => (
                <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7">
              {calendarWeeks.map((week, wi) =>
                week.map((cell, ci) => {
                  if (!cell) {
                    return <div key={`${wi}-${ci}`} className="aspect-square" />;
                  }
                  const day = cell.day;
                  const status = statusMap[day] || 'none';
                  const isSelected = day === 6 && currentMonth === 4 && currentYear === 2026;

                  return (
                    <div key={`${wi}-${ci}`} className="flex flex-col items-center py-1">
                      <div
                        onClick={() => setSelectedDate(new Date(currentYear, currentMonth, day))}
                        className={`w-9 h-9 flex items-center justify-center text-sm font-medium rounded-full cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-gray-900 text-white'
                            : status === 'active'
                            ? 'bg-blue-500 text-white'
                            : status === 'returned'
                            ? 'bg-emerald-500 text-white'
                            : status === 'mixed'
                            ? 'bg-orange-400 text-white'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {day}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Active
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Returned
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-400" /> Mixed
              </span>
            </div>

          </div>
        </div>

        {/* Ready for Pickup */}
        {pendingPickup.length > 0 && (
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-lg text-gray-900">Ready for Pickup</h3>
                <span className="inline-flex items-center justify-center bg-blue-100 text-blue-600 text-[10px] font-bold min-w-[22px] h-5 rounded-full px-1.5">
                  {pendingPickup.length}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pendingPickup.slice(0, 6).map(tx => (
                <div key={tx.id}
                  className="flex items-center justify-between p-3.5 bg-blue-50/60 rounded-2xl border border-blue-100/50 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                      {(tx.customer || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{customerLabel(tx.customer)}</p>
                      <p className="text-xs text-gray-600 truncate">{itemLabel(tx.item)}</p>
                      <p className="text-[10px] text-blue-500 font-medium">
                        {new Date(tx.rentalDate || tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setReleaseTx(tx)}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-full transition-colors shadow-sm">
                    Release
                  </button>
                </div>
              ))}
            </div>
            {pendingPickup.length > 6 && (
              <button onClick={() => onNavigate('History')}
                className="mt-3 w-full py-2.5 text-sm font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors">
                View All ({pendingPickup.length})
              </button>
            )}
          </div>
        )}

      {/* SMS Confirmation Modal */}
      {smsModalTx && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          onClick={() => setSmsModalTx(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-gray-100/80">
              <div>
                <h3 className="font-bold text-lg text-gray-900">Confirm SMS</h3>
                <p className="text-xs text-gray-500 font-medium mt-1">Send overdue reminder to customer?</p>
              </div>
              <button onClick={() => setSmsModalTx(null)}
                className="text-gray-400 hover:bg-gray-200 p-2 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-2xl p-4 text-sm">
                <p><span className="text-gray-500">Customer:</span> <strong className="text-gray-900">{customerLabel(smsModalTx.customer)}</strong></p>
                <p className="mt-1"><span className="text-gray-500">Item:</span> <strong className="text-gray-900">{itemLabel(smsModalTx.item)}</strong></p>
                <p className="mt-1"><span className="text-gray-500">Due Date:</span> <strong className="text-red-500">{smsModalTx.dueDate || smsModalTx.date}</strong></p>
              </div>
              <p className="text-xs text-gray-500 text-center">The SMS will say: "Please return your rented item immediately."</p>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setSmsModalTx(null)}
                  className="flex-1 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-full transition-colors">Cancel</button>
                <button onClick={() => handleSendSMS(smsModalTx)} disabled={sendingSms}
                  className="flex-1 py-2.5 text-sm font-bold text-white bg-[#bf4a53] hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors shadow-sm shadow-red-500/20">
                  {sendingSms ? 'Sending...' : 'Send SMS'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {releaseTx && (
        <ReleaseItemModal transaction={releaseTx} onClose={() => setReleaseTx(null)} onReleased={(updated) => { onRelease(updated); setReleaseTx(null); }} />
      )}
    </div>
  );
}

