import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight, Undo2, MessageCircle, Calendar, Package, AlertTriangle, RotateCcw } from 'lucide-react';
import { api } from '../utils/api';
import { customerLabel, itemLabel, defaultOverdueMessage } from '../utils/format';
import ReleaseItemModal from '../components/ReleaseItemModal';
import SmsResultModal from '../components/SmsResultModal';
import SmsLogPanel from '../components/SmsLogPanel';
import { isReleased } from '../hooks/useTransactions';
import { txPill } from '../utils/statusColors';
import { tabPath } from '../utils/routing';

export default function StaffTasksView({ transactions, inventory, onReturn, onNavigate, onRelease, onSwapItem, onNavigateDetail, role: roleProp }) {
  const navigate = useNavigate();
  const role = roleProp || 'Staff';
  const goHistoryFiltered = (status) => {
    const base = tabPath(role, 'History');
    navigate(`${base}?status=${encodeURIComponent(status)}`);
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Calendar
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);

  // SMS
  const [smsModalTx, setSmsModalTx] = useState(null);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsResult, setSmsResult] = useState(null); // post-send outcome dialog
  const [releaseTx, setReleaseTx] = useState(null);

  const openSmsModal = (tx) => {
    setSmsMessage(defaultOverdueMessage(tx));
    setSmsModalTx(tx);
  };
  const closeSmsModal = () => {
    setSmsModalTx(null);
    setSmsMessage('');
  };

  // Recent Activity
  const [activityFilter, setActivityFilter] = useState('All');
  const [bookingsPage, setBookingsPage] = useState(1);

  // Full-view modals
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

  // Activity history - sorted by date desc, filtered by status. (No
  // 'For Release' option: the Ready-for-Pickup card already covers exactly
  // that set, so a duplicate filter here would be redundant.)
  const filteredActivity = useMemo(() => {
    return [...transactions]
      .filter(tx => activityFilter === 'All' || tx.status === activityFilter)
      .sort((a, b) => new Date(b.date || b.rentalDate || 0) - new Date(a.date || a.rentalDate || 0));
  }, [transactions, activityFilter]);

  // --- Calendar ---
  const calendarTransactions = useMemo(() => {
    if (activityFilter === 'All') return transactions;
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
    const hasTerminal = dayTx.some(t => t.status === 'Returned' || t.status === 'Cancelled');
    const hasActionable = dayTx.some(t => t.status === 'Active' || t.status === 'Overdue');
    const hasReserved = dayTx.some(t => t.status === 'Reserved');
    if (hasTerminal && (hasActionable || hasReserved)) statusMap[day] = 'mixed';
    else if (hasActionable) statusMap[day] = 'active';
    else if (hasReserved) statusMap[day] = 'reserved';
    else if (hasTerminal) statusMap[day] = 'returned';
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

  // Reset to page 1 when the day or filter changes
  useEffect(() => { setBookingsPage(1); }, [selectedDate, activityFilter]);

  const BOOKINGS_PAGE_SIZE = 4;
  const recentActivity = selectedDate
    ? selectedDateBookings.slice((bookingsPage - 1) * BOOKINGS_PAGE_SIZE, bookingsPage * BOOKINGS_PAGE_SIZE)
    : filteredActivity.slice(0, 5);
  const bookingsTotalPages = selectedDate ? Math.ceil(selectedDateBookings.length / BOOKINGS_PAGE_SIZE) : 1;

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // FIX D: surface the real provider outcome; only close on response.
  // `sent` = Semaphore returned a message_id; `queued` = accepted but
  // unconfirmed (check the SMS Log). Never claim success on a 200 alone.
  const handleSendSMS = async (tx) => {
    const message = smsMessage.trim();
    if (!message || sendingSms) return;
    setSendingSms(true);
    try {
      const res = await api.post('/sms/send', {
        profileId: tx.customerId,
        transactionId: tx.id,
        message,
      });
      setSendingSms(false);
      closeSmsModal();
      setSmsResult({ status: res?.status || 'sent', to: customerLabel(tx.customer), message });
    } catch (err) {
      setSendingSms(false);
      closeSmsModal();
      setSmsResult({ status: 'error', to: customerLabel(tx?.customer), error: err?.message || 'Failed to send SMS.' });
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
                  tx,
                })),
                ...pickupToday.slice(0, 2).map(tx => ({
                  key: `pk-${tx.id}`,
                  icon: Package,
                  tone: 'text-blue-600',
                  bg: 'bg-blue-50 border-blue-200/70',
                  label: `Prepare pickup for ${customerLabel(tx.customer)}`,
                  sub: `${itemLabel(tx.item)} due today`,
                  action: () => setReleaseTx(tx),
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
                <div key={f.key}
                  onClick={() => { if (f.tx && onNavigateDetail) onNavigateDetail(f.tx); else if (f.action) f.action(); }}
                  title={f.tx ? 'View transaction details' : undefined}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all hover:shadow-sm hover:scale-[1.01] ${f.bg} ${f.tx && onNavigateDetail ? 'cursor-pointer' : ''}`}>
                  <f.icon size={16} className={`${f.tone} shrink-0`} />
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-bold text-gray-900 truncate">{f.label}</p>
                    <p className="text-[11px] text-gray-500 truncate">{f.sub}</p>
                  </div>
                  {f.tx && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openSmsModal(f.tx); }}
                      title="Send SMS reminder"
                      className="p-2 text-[#bf4a53] bg-white hover:bg-[#bf4a53] hover:text-white rounded-full transition-colors shadow-sm shrink-0">
                      <MessageCircle size={14} />
                      <span className="sr-only">Send SMS</span>
                    </button>
                  )}
                  <ChevronRight size={16} className="text-gray-300 shrink-0" />
                </div>
              ));
            })()}
          </div>
        </div>



        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {/* Recent Activity Card — fixed height so it doesn't collapse when empty/filtered */}
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-6 flex flex-col min-h-[480px]">
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

            {/* Filter capsule — single row on all screens */}
            <div className="flex justify-center mb-5 px-1">
              <div className="inline-flex flex-nowrap items-center justify-center gap-1 bg-gray-100/80 rounded-2xl px-1.5 py-1.5 max-w-full overflow-x-auto hide-scrollbar">
                <button
                  onClick={() => setActivityFilter('All')}
                  className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    activityFilter === 'All' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setActivityFilter('Reserved')}
                  className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    activityFilter === 'Reserved' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                  Reserved
                </button>
                <button
                  onClick={() => setActivityFilter('Active')}
                  className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    activityFilter === 'Active' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  Active
                </button>
                <button
                  onClick={() => setActivityFilter('Returned')}
                  className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    activityFilter === 'Returned' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  Returned
                </button>
              </div>
            </div>

            {/* Activity list — flex-1 keeps the card tall even when empty */}
            <div className="space-y-1 flex-1 flex flex-col">
              {recentActivity.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-8">
                  <p className="text-sm text-gray-400 text-center">No recent activity.</p>
                </div>
              ) : (
                recentActivity.map((tx, i) => {
                  const initial = (tx.customer || '?').charAt(0).toUpperCase();
                  const dueDate = new Date(tx.dueDate || tx.date);
                  const now = new Date(); now.setHours(0, 0, 0, 0);
                  const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
                  const showActions = tx.status === 'Active' || tx.status === 'Overdue';
                  const isItemRented = showActions && inventory.some(i => i.id === tx.itemId && i.status === 'Rented');
                  const openDetail = () => { if (onNavigateDetail) onNavigateDetail(tx); };
                  return (
                    <div key={tx.id}>
                      <div
                        onClick={openDetail}
                        title={onNavigateDetail ? 'View transaction details' : undefined}
                        className={`flex items-center gap-3.5 px-1 py-3 ${onNavigateDetail ? 'cursor-pointer hover:bg-gray-50/70 rounded-xl transition-colors' : ''}`}>
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
                              <button onClick={(e) => { e.stopPropagation(); openSmsModal(tx); }}
                                className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-full transition-colors" title="Send SMS">
                                <MessageCircle size={14} />
                              </button>
                              {!isReleased(tx) && (tx.status === 'Active' || tx.status === 'Reserved') && (
                                <button onClick={(e) => { e.stopPropagation(); setReleaseTx(tx); }}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full transition-colors" title="Release Item">
                                  <Package size={14} />
                                </button>
                              )}
                              {onReturn && isItemRented && isReleased(tx) && (
                                <button onClick={(e) => { e.stopPropagation(); onReturn(tx); }}
                                  className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-full transition-colors" title="Process Return">
                                  <Undo2 size={14} />
                                </button>
                              )}
                            </>
                          )}
                          <span className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap text-center ${txPill(tx.status).bg} ${txPill(tx.status).text}`}>
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
            {selectedDate && selectedDateBookings.length > 0 && (
              bookingsTotalPages > 1 ? (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                  <span className="text-[11px] text-gray-400 font-semibold tabular-nums">
                    Page {bookingsPage} of {bookingsTotalPages} · {selectedDateBookings.length} bookings
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setBookingsPage(p => Math.max(1, p - 1))} disabled={bookingsPage === 1}
                      aria-label="Previous bookings page"
                      className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30">
                      <ChevronLeft size={15} />
                    </button>
                    <button onClick={() => setBookingsPage(p => Math.min(bookingsTotalPages, p + 1))} disabled={bookingsPage === bookingsTotalPages}
                      aria-label="Next bookings page"
                      className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30">
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 pt-4 border-t border-gray-100 text-center">
                  <p className="text-[11px] text-gray-400 font-semibold">
                    Showing all {selectedDateBookings.length} booking{selectedDateBookings.length === 1 ? '' : 's'} — that&rsquo;s everything for this day ✓
                  </p>
                </div>
              )
            )}
          </div>

          {/* Calendar Card — stretches to match Recent Activity; the day grid
              fills the leftover height so there's no dead space at the bottom */}
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-6 flex flex-col">
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

            {/* Calendar grid — flex-1 + stretched cells fill the card height */}
            <div className="grid grid-cols-7 flex-1 content-stretch">
              {calendarWeeks.map((week, wi) =>
                week.map((cell, ci) => {
                  if (!cell) {
                    return <div key={`${wi}-${ci}`} className="flex flex-col items-center justify-center py-1 h-full" aria-hidden="true"><div className="w-9 h-9" /></div>;
                  }
                  const day = cell.day;
                  const status = statusMap[day] || 'none';
                  const isSelected = !!selectedDate
                    && day === selectedDate.getDate()
                    && currentMonth === selectedDate.getMonth()
                    && currentYear === selectedDate.getFullYear();

                  return (
                    <div key={`${wi}-${ci}`} className="flex flex-col items-center justify-center py-1 h-full">
                      <div
                        onClick={() => setSelectedDate(new Date(currentYear, currentMonth, day))}
                        className={`w-9 h-9 flex items-center justify-center text-sm font-medium rounded-full cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-gray-900 text-white'
                            : status === 'active'
                            ? 'bg-blue-500 text-white'
                            : status === 'returned'
                            ? 'bg-emerald-500 text-white'
                            : status === 'reserved'
                            ? 'bg-indigo-400 text-white'
                            : status === 'mixed'
                            ? 'text-white bg-[linear-gradient(135deg,#3b82f6_50%,#10b981_50%)]'
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

            {/* Legend — single centered row on all screens (desktop too) */}
            <div className="flex items-center justify-center gap-x-3 mt-4 pt-4 border-t border-gray-100">
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 font-medium whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" /> Active
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 font-medium whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" /> Reserved
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 font-medium whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" /> Returned
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 font-medium whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-[linear-gradient(135deg,#3b82f6_50%,#10b981_50%)] shrink-0" /> Mixed
              </span>
            </div>

          </div>
        </div>

        {/* Pickup + Overdue — paired action queues (latest 5 each) */}
        {(pendingPickup.length > 0 || overdueItems.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Ready for Pickup */}
            {pendingPickup.length > 0 ? (
              <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-6 flex flex-col">
                <div className="flex items-center mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-lg text-gray-900">Ready for Pickup</h3>
                    <span className="inline-flex items-center justify-center bg-blue-100 text-blue-600 text-[10px] font-bold min-w-[22px] h-5 rounded-full px-1.5">
                      {pendingPickup.length}
                    </span>
                  </div>
                </div>
                <div className="space-y-2 flex-1">
                  {pendingPickup.slice(0, 5).map(tx => (
                    <div key={tx.id} className="flex items-center justify-between p-3 bg-blue-50/60 rounded-2xl border border-blue-100/50 gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 text-xs font-bold">
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
                <button onClick={() => goHistoryFiltered('Reserved')}
                  className="mt-3 w-full py-2.5 text-sm font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors">
                  View All ({pendingPickup.length})
                </button>
              </div>
            ) : <div className="hidden lg:block" />}

            {/* Overdue Rentals */}
            {overdueItems.length > 0 ? (
              <div className="bg-white rounded-3xl border border-red-100/50 shadow-sm p-6 flex flex-col">
                <div className="flex items-center mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-lg text-gray-900">Overdue Rentals</h3>
                    <span className="inline-flex items-center justify-center bg-red-100 text-red-600 text-[10px] font-bold min-w-[22px] h-5 rounded-full px-1.5">
                      {overdueItems.length}
                    </span>
                  </div>
                </div>
                <div className="space-y-2 flex-1">
                  {overdueItems.slice(0, 5).map(tx => {
                    const dueDate = new Date(tx.dueDate || tx.date);
                    const now = new Date(); now.setHours(0,0,0,0);
                    const daysOverdue = Math.max(0, Math.floor((now - dueDate) / 86400000));
                    return (
                      <div key={tx.id}
                        onClick={() => { if (onNavigateDetail) onNavigateDetail(tx); }}
                        title={onNavigateDetail ? 'View transaction details' : undefined}
                        className={`flex items-center justify-between p-3 bg-red-50/60 rounded-2xl border border-red-100/50 gap-3 ${onNavigateDetail ? 'cursor-pointer hover:bg-red-50 transition-colors' : ''}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0 text-xs font-bold">
                            {(tx.customer || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900 truncate">{customerLabel(tx.customer)}</p>
                            <p className="text-xs text-gray-600 truncate">{itemLabel(tx.item)}</p>
                            <p className="text-[10px] font-bold text-red-500">
                              {daysOverdue === 0 ? 'Due today' : `${daysOverdue}d overdue`}
                            </p>
                          </div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); openSmsModal(tx); }}
                          className="shrink-0 p-2 text-[#bf4a53] bg-white hover:bg-[#bf4a53] hover:text-white rounded-full transition-colors shadow-sm">
                          <MessageCircle size={14} />
                          <span className="sr-only">Send SMS</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => goHistoryFiltered('Overdue')}
                  className="mt-3 w-full py-2.5 text-sm font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-colors">
                  View All ({overdueItems.length})
                </button>
              </div>
            ) : <div className="hidden lg:block" />}
          </div>
        )}

      {/* SMS Log — read-only here (delete is admin-only in the panel).
          Lets staff verify what actually went out without leaving Tasks. */}
      <details className="bg-white rounded-3xl border border-gray-100/50 shadow-sm overflow-hidden group">
        <summary className="flex items-center gap-3 p-6 cursor-pointer list-none">
          <span className="w-10 h-10 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
            <MessageCircle size={18} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold text-lg text-gray-900">SMS Log</span>
            <span className="block text-xs text-gray-500 font-medium mt-0.5">Manual + automatic sends and their delivery status</span>
          </span>
          <span className="text-xs font-bold text-gray-400 group-open:rotate-180 transition-transform">▾</span>
        </summary>
        <div className="px-6 pb-6">
          <SmsLogPanel />
        </div>
      </details>

      {/* SMS Confirmation Modal — message is editable per send.
          z-[9999] matches the other full-screen modals so it always sits on
          top (it was getting buried under nav/tutorial layers). */}
      {smsModalTx && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          onClick={closeSmsModal}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-gray-100/80">
              <div>
                <h3 className="font-bold text-lg text-gray-900">Confirm SMS</h3>
                <p className="text-xs text-gray-500 font-medium mt-1">Send overdue reminder to customer?</p>
              </div>
              <button onClick={closeSmsModal}
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
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Custom message</label>
                  <button onClick={() => setSmsMessage(defaultOverdueMessage(smsModalTx))}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-400 hover:text-gray-600 transition-colors"
                    title="Restore the default message">
                    <RotateCcw size={11} /> Reset
                  </button>
                </div>
                <textarea
                  value={smsMessage}
                  onChange={(e) => setSmsMessage(e.target.value.slice(0, 1600))}
                  rows={4}
                  className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm leading-relaxed min-h-[100px] focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/20 transition-all"
                />
                <p className={`text-[11px] text-right font-medium ${smsMessage.length > 160 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {smsMessage.length}/1600{ smsMessage.length > 160 ? ` · ~${Math.ceil(smsMessage.length / 160)} segments` : '' }
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={closeSmsModal}
                  className="flex-1 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-full transition-colors">Cancel</button>
                <button onClick={() => handleSendSMS(smsModalTx)} disabled={sendingSms || !smsMessage.trim()}
                  className="flex-1 py-2.5 text-sm font-bold text-white bg-[#bf4a53] hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors shadow-sm shadow-red-500/20">
                  {sendingSms ? 'Sending...' : 'Send SMS'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {releaseTx && (
        <ReleaseItemModal transaction={releaseTx} onClose={() => setReleaseTx(null)} onReleased={(updated) => { onRelease(updated); setReleaseTx(null); }} onSwapItem={(updated, prevItemId) => onSwapItem?.(updated, prevItemId)} />
      )}

      {/* Post-send outcome — sent vs queued vs failed, stated honestly. */}
      {smsResult && (
        <SmsResultModal result={smsResult} onClose={() => setSmsResult(null)} />
      )}
    </div>
  );
}

