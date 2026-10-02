import { useState, useEffect, useCallback } from 'react';
import { Bell, CheckCheck, CheckCircle2, Trash2, Inbox, MessageCircle, BookOpen, ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { notificationsService } from '../services/notifications';
import { transactionsService } from '../services/transactions';
import { Skeleton } from '../components/Skeleton';
import SmsLogPanel from '../components/SmsLogPanel';
import { mapNotification, timeAgo, targetTabForNotification } from '../components/NotificationsDropdown';
import ConfirmModal from '../components/ConfirmModal';
import MessageReaderModal from '../components/MessageReaderModal';
import { useHandledMessages } from '../hooks/useHandledMessages';
import { useBookingStatus } from '../hooks/useBookingStatus';

// Calendar-day group label for the timeline ("Today" / "Yesterday" / date).
function dayLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((todayStart - day) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Group items by calendar day, newest day first. Items arrive newest-first
// from the API, so first-seen order is already correct.
function groupByDay(items) {
  const groups = [];
  const byLabel = new Map();
  for (const n of items) {
    const label = dayLabel(n.time);
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      groups.push([label, byLabel.get(label)]);
    }
    byLabel.get(label).push(n);
  }
  return groups;
}

// The chip echoes the title on most system rows ("New Booking" / "New
// Booking") — only show it when it adds information.
function showChip(n) {
  const chip = (n.cfg?.chip || '').trim().toLowerCase();
  const title = (n.title || '').trim().toLowerCase();
  if (!chip || !title) return false;
  return !title.includes(chip) && !chip.includes(title);
}

// Full-page view of every notification (the dropdown only shows the latest 50).
// Same visual language as the dropdown so the two stay consistent.
// Split into two separated sections: system Notifications and Customer
// Messages (type customer_message), each with its own All/New filter.
export default function NotificationsView({ role, onNavigateTab, onOpenBooking }) {
  const PAGE_SIZE = 10;
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  // Deep-link hint from the bell dropdown ("open on Messages"): consumed +
  // cleared on arrival so later visits start on All.
  const [section, setSection] = useState(() => {
    try {
      const hint = sessionStorage.getItem('rentech_notif_section');
      sessionStorage.removeItem('rentech_notif_section');
      return hint === 'messages' || hint === 'notifications' || hint === 'sms' ? hint : 'all';
    } catch {
      return 'all';
    }
  }); // 'all' | 'notifications' | 'messages'
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Delete confirmation: { mode: 'one', id, title } | { mode: 'all' } | null
  const [confirmDelete, setConfirmDelete] = useState(null);
  // Message reader (same functions as the Messages inbox: full text, approve
  // cancellation, mark done, view booking).
  const [msgDetail, setMsgDetail] = useState(null);
  const [approving, setApproving] = useState(false);
  const [approveResult, setApproveResult] = useState(null);
  const { handled, markHandled } = useHandledMessages();
  const bookingStatus = useBookingStatus(msgDetail?.transactionId);
  useEffect(() => {
    if (msgDetail && bookingStatus === 'Cancelled') markHandled(msgDetail.id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgDetail, bookingStatus]);

  const openMessage = async (n) => {
    if (!n.isRead) handleMarkRead(n.id);
    setApproveResult(null);
    setMsgDetail(n);
  };

  // Approve the cancellation the customer asked for (same as the inbox).
  const handleApproveMessage = async () => {
    if (!msgDetail?.transactionId || approving || approveResult?.ok) return;
    setApproving(true);
    try {
      await transactionsService.cancel(msgDetail.transactionId);
      setNotifications((p) => p.map((x) => (x.id === msgDetail.id ? { ...x, isRead: true } : x)));
      markHandled(msgDetail.id, true);
      setApproveResult({ ok: true, text: 'Booking cancelled — the customer was notified in-app and by email.' });
    } catch (err) {
      setApproveResult({ ok: false, text: err?.message || 'Could not cancel the booking.' });
    } finally {
      setApproving(false);
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    notificationsService
      .list({ limit: 500 })
      .then((data) => {
        const items = (Array.isArray(data) ? data : data?.notifications ?? []).map(mapNotification);
        setNotifications(items);
      })
      .catch(() => setNotifications([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Optimistic mark-all-read, reverted on failure.
  const handleMarkAllRead = async () => {
    const prev = notifications;
    setNotifications((p) => p.map((n) => ({ ...n, isRead: true })));
    try {
      await notificationsService.readAll();
    } catch {
      setNotifications(prev);
    }
  };

  // Optimistic mark-one-read, reverted on failure.
  const handleMarkRead = async (id) => {
    const prev = notifications;
    setNotifications((p) => p.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    try {
      await notificationsService.markRead(id);
    } catch {
      setNotifications(prev);
    }
  };

  // Tapping a notification marks it read and jumps to its page.
  const handleOpen = (n) => {
    if (!n.isRead) handleMarkRead(n.id);
    if (onNavigateTab) onNavigateTab(targetTabForNotification(n.type, role));
  };

  // Optimistic per-item delete, reverted on failure.
  const handleDelete = async (id) => {
    const prev = notifications;
    setNotifications((p) => p.filter((n) => n.id !== id));
    try {
      await notificationsService.remove(id);
    } catch {
      setNotifications(prev);
    }
  };

  // Optimistic clear-all, reverted on failure.
  const handleClearAll = async () => {
    const prev = notifications;
    setNotifications([]);
    try {
      await notificationsService.clearAll();
    } catch {
      setNotifications(prev);
    }
  };

  const handleConfirmDelete = () => {
    if (!confirmDelete) return;
    if (confirmDelete.mode === 'all') {
      handleClearAll();
    } else {
      handleDelete(confirmDelete.id);
    }
    setConfirmDelete(null);
  };

  const unread = notifications.filter((n) => !n.isRead);
  const messageNotes = notifications.filter((n) => n.type === 'customer_message');
  const systemNotes = notifications.filter((n) => n.type !== 'customer_message');
  const systemUnread = systemNotes.filter((n) => !n.isRead);
  const messageUnread = messageNotes.filter((n) => !n.isRead);

  // Merged view: one switchable, paginated list. "All" interleaves both
  // types chronologically (API returns newest-first). The SMS Log is a
  // separate dataset (sent-SMS rows, not notifications) rendered by its own
  // panel with Manual/Automatic + status filters — staff roles only
  // (GET /sms/history 403s customers, so don't show them the tab at all).
  const canSeeSmsLog = role === 'Admin' || role === 'Staff';
  // Customer messages are fanned out to Admin profiles only
  // (customer.controller contactAdmin) — staff and customers never have
  // message rows, so the section is admin-only instead of an empty tab.
  const canSeeMessages = role === 'Admin';
  // Customers see a single dataset (their All == Notifications — they never
  // have message rows), so the switcher itself is clutter: hide it and lock
  // them to the full list.
  const showSwitcher = canSeeMessages || canSeeSmsLog;
  const safeSection = !showSwitcher
    ? 'all'
    : (section === 'sms' && !canSeeSmsLog) || (section === 'messages' && !canSeeMessages)
      ? 'all'
      : section;
  const dataset = safeSection === 'sms' ? [] : safeSection === 'messages' ? messageNotes : safeSection === 'notifications' ? systemNotes : notifications;
  const datasetUnread = section === 'messages' ? messageUnread : section === 'notifications' ? systemUnread : unread;
  const filtered = unreadOnly ? datasetUnread : dataset;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset to page 1 whenever the dataset changes underneath.
  useEffect(() => { setPage(1); }, [section, unreadOnly, notifications.length]);
  const switchSection = (s) => { setSection(s); setUnreadOnly(false); setPage(1); };

  const handleViewBooking = (n) => {
    if (!n.isRead) handleMarkRead(n.id);
    if (n.transactionId && onOpenBooking) onOpenBooking(n.transactionId);
    else if (onNavigateTab) onNavigateTab(targetTabForNotification(n.type, role));
  };

  const renderSystemRow = (n) => {
    const Icon = n.cfg.icon;
    return (
      <div
        key={n.id}
        className={`group relative w-full text-left flex items-start gap-3 p-3 rounded-2xl transition-colors duration-150 hover:bg-[#bf4a53]/5 hover:ring-1 hover:ring-[#bf4a53]/10 ${
          n.isRead ? '' : 'bg-gradient-to-r from-[#bf4a53]/[0.06] to-transparent'
        }`}
      >
        {!n.isRead && (
          <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-[#bf4a53]" />
        )}
        <button
          onClick={() => handleOpen(n)}
          className="flex-1 min-w-0 flex items-start gap-3 text-left"
          aria-label={`Open ${n.title}`}
        >
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${n.cfg.iconBg}`}>
            <Icon size={16} className={n.cfg.iconColor} />
          </div>
          <div className="flex-1 min-w-0 py-px">
            <div className="flex items-center gap-1.5">
              <p className="text-[13px] font-bold text-gray-900 truncate">{n.title}</p>
              {showChip(n) && (
                <span className={`text-[10px] font-bold px-1.5 py-px rounded-full bg-gray-100 text-gray-400 shrink-0 ${n.cfg.iconColor}`}>
                  {n.cfg.chip}
                </span>
              )}
            </div>
            <p className="text-[12px] text-gray-500 leading-snug mt-0.5 line-clamp-2">{n.text}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(n.time)}</p>
          </div>
        </button>
        <button
          onClick={() => setConfirmDelete({ mode: 'one', id: n.id, title: n.title })}
          aria-label={`Delete ${n.title}`}
          title="Delete"
          className="p-2 text-gray-300 group-hover:text-red-600 group-hover:bg-red-50 rounded-full transition-colors self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60"
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  };

  const renderMessageRow = (n) => (
    <div
      key={n.id}
      className={`group relative w-full text-left p-3 rounded-2xl border transition-colors duration-150 ${
        n.isRead
          ? 'border-gray-100 bg-white'
          : 'border-blue-100 bg-gradient-to-r from-blue-50/70 to-transparent'
      }`}
    >
      {!n.isRead && (
        <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-blue-500" />
      )}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm bg-blue-50">
          <MessageCircle size={16} className="text-blue-500" />
        </div>
        <div className="flex-1 min-w-0 py-px">
          <button onClick={() => openMessage(n)} className="block w-full text-left" aria-label={`Open message: ${n.title}`}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-[13px] font-bold text-gray-900">{n.title}</p>
                          {n.transactionId && !/\(booking\s+\d+\)/i.test(n.title || '') && (
                            <span className="text-[10px] font-bold px-1.5 py-px rounded-full bg-gray-100 text-gray-400 shrink-0">
                              booking {String(n.transactionId).slice(0, 8)}
                            </span>
                          )}
              {handled.has(n.id) && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-px rounded-full bg-emerald-50 text-emerald-600 shrink-0">
                  <CheckCircle2 size={10} /> Done
                </span>
              )}
            </div>
            <p className="text-[12px] text-gray-500 leading-snug mt-0.5 whitespace-pre-wrap line-clamp-3">{n.text}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(n.time)}</p>
          </button>
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            {n.transactionId && onOpenBooking && (
              <button
                onClick={() => handleViewBooking(n)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-bold text-white bg-gray-900 hover:bg-gray-700 active:scale-[0.98] transition-all"
              >
                <BookOpen size={12} /> View booking
              </button>
            )}
            <button
              onClick={() => markHandled(n.id, !handled.has(n.id))}
              title={handled.has(n.id) ? 'Reopen this message' : 'Mark this message as done'}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-bold active:scale-[0.98] transition-all ${
                handled.has(n.id)
                  ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                  : 'text-gray-500 bg-gray-100 hover:bg-gray-200'
              }`}
            >
              <CheckCircle2 size={12} /> {handled.has(n.id) ? 'Done' : 'Mark done'}
            </button>
            <button
              onClick={() => setConfirmDelete({ mode: 'one', id: n.id, title: n.title })}
              aria-label={`Delete ${n.title}`}
              title="Delete"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-bold text-gray-400 hover:text-red-600 hover:bg-red-50 active:scale-[0.98] transition-all"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header card */}
      <div className="bg-white rounded-3xl shadow-sm ring-1 ring-black/5 overflow-hidden mb-5">
        <div className="relative px-4 sm:px-6 pt-5 pb-4 bg-gradient-to-br from-[#8e323a] via-[#a63f47] to-[#bf4a53] overflow-hidden">
          <div className="absolute -right-8 -top-10 w-36 h-36 rounded-full bg-white/10" />
          <div className="absolute -right-2 top-10 w-20 h-20 rounded-full bg-white/5" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center text-white shadow-inner shrink-0">
                <Bell size={20} />
              </div>
              <div className="min-w-0">
                <h1 className="font-bold text-white text-base leading-tight">Notifications</h1>
                <p className="text-xs text-white/80 leading-tight mt-0.5">
                  {unread.length > 0
                    ? `${unread.length} unread · stay on top of things`
                    : notifications.length > 0
                      ? 'You are all caught up'
                      : 'No notifications yet'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:shrink-0">
              {safeSection !== 'sms' && (
              <>
              <button
                onClick={() => { setUnreadOnly((v) => !v); setPage(1); }}
                aria-pressed={unreadOnly}
                title="Show unread only"
                className={`inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-3 py-2.5 sm:py-2 rounded-xl text-[11px] font-bold transition-colors whitespace-nowrap ${
                  unreadOnly
                    ? 'bg-white text-[#bf4a53] shadow-sm'
                    : 'text-white/80 hover:text-white hover:bg-white/15 bg-white/10 sm:bg-transparent'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${unreadOnly ? 'bg-[#bf4a53]' : 'bg-white/70'}`} />
                New
                {datasetUnread.length > 0 && (
                  <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold inline-flex items-center justify-center tabular-nums ${
                    unreadOnly ? 'bg-[#bf4a53]/15 text-[#bf4a53]' : 'bg-white/20 text-white'
                  }`}>
                    {datasetUnread.length}
                  </span>
                )}
              </button>
              {unread.length > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-3 py-2.5 sm:py-2 rounded-xl text-[11px] font-bold text-white/80 hover:text-white hover:bg-white/15 bg-white/10 sm:bg-transparent transition-colors whitespace-nowrap"
                >
                  <CheckCheck size={14} /> Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={() => setConfirmDelete({ mode: 'all' })}
                  className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-3 py-2.5 sm:py-2 rounded-xl text-[11px] font-bold text-white/80 hover:text-white hover:bg-white/15 bg-white/10 sm:bg-transparent transition-colors whitespace-nowrap"
                >
                  <Trash2 size={14} /> Clear all
                </button>
              )}
              </>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Merged timeline: notifications | messages switcher + pagination ── */}
      <div className="bg-white rounded-3xl shadow-sm ring-1 ring-black/5 overflow-hidden">
        <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-gray-100/80 space-y-3">
          {/* Section switcher (hidden when only one section exists) */}
          {showSwitcher && (
          <div className={`grid gap-0.5 sm:gap-1 p-1 rounded-2xl bg-gray-100 ${canSeeMessages && canSeeSmsLog ? 'grid-cols-4' : canSeeMessages || canSeeSmsLog ? 'grid-cols-3' : 'grid-cols-2'}`} role="tablist" aria-label="Notifications, messages, or SMS log">
            {[
              { key: 'all', label: 'All', icon: Inbox, total: notifications.length, unread: unread.length },
              { key: 'notifications', label: 'Notifications', icon: Bell, total: systemNotes.length, unread: systemUnread.length },
              ...(canSeeMessages ? [{ key: 'messages', label: 'Messages', icon: MessageCircle, total: messageNotes.length, unread: messageUnread.length }] : []),
              ...(canSeeSmsLog ? [{ key: 'sms', label: 'SMS Log', icon: Send, total: null, unread: 0 }] : []),
            ].map(({ key, label, icon: Icon, total, unread: unreadCount }) => {
              const isActive = safeSection === key;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => switchSection(key)}
                  className={`relative inline-flex items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-[11px] sm:text-xs font-bold transition-all min-w-0 ${
                    isActive ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon size={14} className={`shrink-0 hidden min-[400px]:block ${isActive ? (key === 'messages' ? 'text-blue-500' : key === 'sms' ? 'text-violet-500' : key === 'all' ? 'text-gray-700' : 'text-[#bf4a53]') : ''}`} />
                  <span className="truncate">{label}</span>
                  {total != null && (
                  <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold inline-flex items-center justify-center tabular-nums ${
                    isActive ? 'bg-gray-900 text-white' : 'bg-gray-200/70 text-gray-500'
                  }`}>
                    {total}
                  </span>
                  )}
                  {unreadCount > 0 && !isActive && (
                    <span className="absolute top-1 right-1 sm:top-1.5 sm:right-2 w-2 h-2 rounded-full bg-[#bf4a53]" />
                  )}
                </button>
              );
            })}
          </div>
          )}
        </div>
      {/* List */}
        {safeSection === 'sms' ? (
          <div className="p-4"><SmsLogPanel /></div>
        ) : (
        <div className="p-4 space-y-3">
          {loading ? (
            <div className="space-y-3 py-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-3">
                {section === 'messages'
                  ? <MessageCircle size={24} className="text-gray-300" />
                  : <Inbox size={24} className="text-gray-300" />}
              </div>
              <p className="text-sm font-semibold text-gray-600">
                {section === 'messages' ? 'No messages yet' : 'No notifications yet'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {section === 'messages' ? 'Customer messages will appear here.' : 'New notifications will appear here.'}
              </p>
            </div>
          ) : (
            <div className="stagger space-y-4">
              {groupByDay(pageItems).map(([day, items]) => (
                <div key={day}>
                  <p className="px-1 pb-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{day}</p>
                  <div className="space-y-1">
                    {items.map((n) => (n.type === 'customer_message' ? renderMessageRow(n) : renderSystemRow(n)))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-t border-gray-100/80">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-xs font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={15} /> Prev
            </button>
            <span className="text-xs font-bold text-gray-400 tabular-nums">
              Page {safePage} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-xs font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>

      <MessageReaderModal
        message={msgDetail}
        done={msgDetail ? handled.has(msgDetail.id) : false}
        bookingStatus={bookingStatus}
        approving={approving}
        approveResult={approveResult}
        onApprove={handleApproveMessage}
        onViewBooking={onOpenBooking ? (txId) => { setMsgDetail(null); onOpenBooking(txId); } : null}
        onToggleDone={msgDetail ? () => markHandled(msgDetail.id, !handled.has(msgDetail.id)) : null}
        onClose={() => setMsgDetail(null)}
      />

      {confirmDelete && (
        <ConfirmModal
          title={confirmDelete.mode === 'all' ? 'Delete all notifications?' : 'Delete notification?'}
          subtitle={confirmDelete.mode === 'all' ? null : confirmDelete.title}
          message={
            confirmDelete.mode === 'all'
              ? 'This will permanently remove every notification from your list. This cannot be undone.'
              : 'This notification will be permanently removed. This cannot be undone.'
          }
          confirmLabel="Delete"
          cancelLabel="Keep it"
          variant="danger"
          icon={<Trash2 size={18} />}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
