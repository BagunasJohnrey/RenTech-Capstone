import { useState, useEffect, useRef } from 'react';
import {
  Bell, ShoppingBag, CalendarClock, Clock, CheckCircle2,
  AlertTriangle, Smartphone, MessageCircle, XCircle, X, Circle, Trash2, CheckCheck, Inbox, FileText,
  ClipboardCheck, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { notificationsService } from '../services/notifications';
import { Skeleton } from '../components/Skeleton';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useHandledMessages } from '../hooks/useHandledMessages';
import ConfirmModal from './ConfirmModal';

export const TYPE_CONFIG = {
  new_booking: { icon: ShoppingBag, iconBg: 'bg-[#bf4a53]/10', iconColor: 'text-[#bf4a53]', chip: 'New Booking' },
  booking_confirmation: { icon: CheckCircle2, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-500', chip: 'Confirmation' },
  booking_updated: { icon: CalendarClock, iconBg: 'bg-blue-50', iconColor: 'text-blue-500', chip: 'Updated' },
  booking_cancelled: { icon: XCircle, iconBg: 'bg-red-50', iconColor: 'text-red-500', chip: 'Cancelled' },
  alteration_needed: { icon: AlertTriangle, iconBg: 'bg-amber-50', iconColor: 'text-amber-500', chip: 'Alteration' },
  due_today: { icon: CalendarClock, iconBg: 'bg-amber-50', iconColor: 'text-amber-500', chip: 'Due Today' },
  overdue: { icon: AlertTriangle, iconBg: 'bg-red-50', iconColor: 'text-red-500', chip: 'Overdue' },
  late_return: { icon: Clock, iconBg: 'bg-orange-50', iconColor: 'text-orange-500', chip: 'Late Return' },
  no_show: { icon: AlertTriangle, iconBg: 'bg-red-50', iconColor: 'text-red-600', chip: 'No-Show' },
  reminder: { icon: Smartphone, iconBg: 'bg-blue-50', iconColor: 'text-blue-500', chip: 'Reminder' },
  customer_message: { icon: MessageCircle, iconBg: 'bg-blue-50', iconColor: 'text-blue-500', chip: 'Customer Message' },
  ai_report: { icon: FileText, iconBg: 'bg-violet-50', iconColor: 'text-violet-600', chip: 'Report' },
  payment_proof: { icon: ClipboardCheck, iconBg: 'bg-amber-50', iconColor: 'text-amber-500', chip: 'Payment Proof' },
  payment_proof_pending: { icon: ClipboardCheck, iconBg: 'bg-amber-50', iconColor: 'text-amber-500', chip: 'Payment Review' },
  payment_proof_approved: { icon: ShieldCheck, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-500', chip: 'Payment Verified' },
  payment_proof_rejected: { icon: ShieldAlert, iconBg: 'bg-red-50', iconColor: 'text-red-500', chip: 'Payment Issue' },
  default: { icon: Bell, iconBg: 'bg-gray-100', iconColor: 'text-gray-500', chip: 'Notification' },
};

export const mapNotification = (n) => {
  const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.default;
  return {
    id: n.id,
    isRead: !!n.isRead,
    type: n.type,
    title: n.title || cfg.chip,
    text: n.message || n.text || '',
    time: n.createdAt,
    transactionId: n.transactionId ?? null,
    // Weekly auto-report deep-link: the scheduler embeds `report:<id>` in the
    // message body (see autoReport.service). Extracted once here so both the
    // dropdown and the Notifications page share the redirect logic.
    reportId: n.type === 'ai_report' ? reportIdFromMessage(n.message || n.text || '') : null,
    cfg,
  };
};

// Parses the `report:<id>` trailer the weekly scheduler appends to the
// notification message. Returns null for anything else (manual rows, other
// types) so the tap falls back to the normal tab navigation.
export const reportIdFromMessage = (message) => {
  const m = String(message || '').match(/report:([A-Za-z0-9][A-Za-z0-9-_]*)/);
  return m ? m[1] : null;
};

export const timeAgo = (iso) => {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Tab each notification type opens. Staff actionables go to Tasks; admin
// customer messages go to the Messages inbox; weekly auto-reports deep-link
// into the saved report (via the `rentech_open_report` hint consumed by the
// BI page); everything record-related goes to History; plain notices go home.
export const targetTabForNotification = (type, role) => {
  if (type === 'ai_report') return 'AI Insights';
  if (type === 'customer_message') {
    if (role === 'Admin') return 'Messages';
    if (role === 'Staff') return 'Tasks';
    return 'History';
  }
  if (role === 'Staff' && ['new_booking', 'due_today', 'overdue', 'late_return', 'no_show', 'reminder', 'payment_proof'].includes(type)) {
    return 'Tasks';
  }
  if (!type || type === 'default') return role === 'Customer' ? 'Home' : 'Dashboard';
  return 'History';
};

export default function NotificationsDropdown({ role, showNotifications, toggle, onViewAll, onNavigateTab }) {
  useEscapeClose(toggle, showNotifications);
  const rootRef = useRef(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [offlineToast, setOfflineToast] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all' | 'new'
  // Done messages don't count toward the Messages pill number.
  const { handled } = useHandledMessages();
  // Delete confirmation: { mode: 'one', id, title } | { mode: 'all' } | null
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Close when clicking outside the dropdown (desktop + touch). Skipped while
  // the delete-confirm modal is up, so dismissing that modal's scrim doesn't
  // also yank the dropdown open state out from under the user.
  useEffect(() => {
    if (!showNotifications || confirmDelete) return;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        toggle();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showNotifications, confirmDelete, toggle]);

  useEffect(() => {
    const goOnline = () => { setIsOffline(false); setOfflineToast(false); };
    const goOffline = () => { setIsOffline(true); setOfflineToast(true); setTimeout(() => setOfflineToast(false), 5000); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  // Persistent unread badge driven by the backend unread-count endpoint.
  useEffect(() => {
    const refresh = () =>
      notificationsService.unreadCount()
        .then((data) => setUnreadCount(data?.count ?? 0))
        .catch(() => {});
    const t = setTimeout(refresh, 0);
    const id = setInterval(refresh, 30000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, []);

  // Load notifications when dropdown opens
  useEffect(() => {
    if (showNotifications) {
      setLoading(true);
      notificationsService.list()
        .then((data) => {
          const items = (Array.isArray(data) ? data : data?.notifications ?? []).map(mapNotification);
          setNotifications(items);
        })
        .catch(() => setNotifications([]))
        .finally(() => setLoading(false));
    }
  }, [showNotifications]);

  const visible = filter === 'new' ? notifications.filter((n) => !n.isRead) : notifications;

  // Optimistic mark-all-read, reverted on failure.
  const handleMarkAllRead = async () => {
    const prev = notifications;
    setNotifications((p) => p.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
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
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await notificationsService.markRead(id);
    } catch {
      setNotifications(prev);
    }
  };

  // Jump to the main Notifications page with a preselected section (the
  // page consumes + clears the hint on arrival).
  const goNotificationsSection = (section) => {
    try {
      sessionStorage.setItem('rentech_notif_section', section);
    } catch { /* private mode */ }
    toggle();
    if (onNavigateTab) onNavigateTab('Notifications');
  };

  // Tapping a notification marks it read and jumps to its page. Customer
  // messages land on the main Notifications page (Messages section) instead
  // of the standalone inbox. Weekly auto-reports drop a `rentech_open_report`
  // hint (the saved report id) that the BI page consumes + clears on arrival
  // to auto-open the report modal.
  const handleOpen = (n) => {
    if (!n.isRead) handleMarkRead(n.id);
    if (n.type === 'customer_message') {
      goNotificationsSection('messages');
      return;
    }
    if (n.type === 'ai_report' && n.reportId) {
      try {
        sessionStorage.setItem('rentech_open_report', n.reportId);
      } catch { /* private mode — still navigates, just no auto-open */ }
    }
    toggle();
    if (onNavigateTab) onNavigateTab(targetTabForNotification(n.type, role));
  };

  // Optimistic per-item delete, reverted on failure.
  const handleDelete = async (id) => {
    const prev = notifications;
    const target = notifications.find((n) => n.id === id);
    setNotifications((p) => p.filter((n) => n.id !== id));
    if (target && !target.isRead) setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await notificationsService.remove(id);
    } catch {
      setNotifications(prev);
    }
  };

  // Optimistic clear-all, reverted on failure.
  const handleClearAll = async () => {
    const prev = notifications;
    const hadUnread = unreadCount;
    setNotifications([]);
    setUnreadCount(0);
    try {
      await notificationsService.clearAll();
    } catch {
      setNotifications(prev);
      setUnreadCount(hadUnread);
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

  const hasNew = unreadCount > 0;

  return (
    <div className="relative" ref={rootRef}>
      {offlineToast && (
        <div className="absolute -top-10 right-0 bg-orange-500 text-white text-[11px] font-semibold px-3 py-1.5 rounded-full shadow-lg whitespace-nowrap animate-in fade-in slide-in-from-top-2 z-50">
          You're offline. Changes will sync when connected.
        </div>
      )}
      <button onClick={toggle}
        className={`p-2.5 rounded-full relative transition-colors btn-press ${
          showNotifications ? 'bg-[#bf4a53]/10 text-[#bf4a53]' : 'bg-gray-50/80 text-gray-500 hover:bg-gray-100'
        }`}>
        <Bell size={18} />
        {hasNew && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#bf4a53] rounded-full ring-2 ring-white" />
        )}
        {isOffline && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-orange-400 rounded-full animate-pulse border-2 border-white" style={{ animationDuration: '3s' }} />
        )}
      </button>

      {showNotifications && (
        <div className="absolute right-0 mt-3 w-80 sm:w-[380px] bg-white rounded-3xl shadow-[0_18px_50px_-12px_rgba(0,0,0,0.28)] ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2 z-50 overflow-hidden">
          {/* Header */}
          <div className="relative px-5 pt-4 pb-3 bg-gradient-to-br from-[#8e323a] via-[#a63f47] to-[#bf4a53] overflow-hidden">
            <div className="absolute -right-8 -top-10 w-36 h-36 rounded-full bg-white/10" />
            <div className="absolute -right-2 top-10 w-20 h-20 rounded-full bg-white/5" />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center text-white shadow-inner">
                  <Bell size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm leading-tight">Notifications</h3>
                  <p className="text-[10px] text-white/80 leading-tight">
                    {hasNew ? `${unreadCount} unread · stay on top of things` : 'You are all caught up'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {hasNew && (
                  <button
                    onClick={handleMarkAllRead}
                    title="Mark all as read"
                    className="p-1.5 text-white/80 hover:text-white hover:bg-white/15 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <CheckCheck size={15} />
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={() => setConfirmDelete({ mode: 'all' })}
                    title="Delete all notifications"
                    className="p-1.5 text-white/80 hover:text-white hover:bg-white/15 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
                <button
                  onClick={toggle}
                  aria-label="Close notifications"
                  className="p-1 text-white/80 hover:text-white hover:bg-white/15 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Filter tabs + Messages shortcut (jumps to the main page) */}
            <div className="relative flex items-center gap-1.5 mt-3 flex-wrap">
              {[
                { key: 'all', label: 'All', count: notifications.length },
                { key: 'new', label: 'New', count: notifications.filter((n) => !n.isRead).length },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold backdrop-blur transition-colors ${
                    filter === tab.key
                      ? 'bg-white text-[#bf4a53] shadow-sm'
                      : 'bg-white/15 text-white/80 hover:bg-white/25'
                  }`}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className={`ml-1.5 ${filter === tab.key ? 'text-[#bf4a53]/70' : 'text-white/70'}`}>{tab.count}</span>
                  )}
                </button>
              ))}
              {role === 'Admin' && (() => {
                const openMsgs = notifications.filter((n) => n.type === 'customer_message' && !handled.has(n.id));
                const msgCount = openMsgs.length;
                const msgUnread = openMsgs.filter((n) => !n.isRead).length;
                return (
                  <button
                    onClick={() => goNotificationsSection('messages')}
                    title="Open customer messages on the Notifications page"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold backdrop-blur transition-colors bg-blue-400/25 text-white hover:bg-blue-400/40"
                  >
                    <MessageCircle size={12} />
                    Messages
                    {msgCount > 0 && (
                      <span className="ml-1 rounded-full bg-white text-blue-600 text-[10px] font-bold min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center tabular-nums">
                        {msgUnread > 0 ? msgUnread : msgCount}
                      </span>
                    )}
                  </button>
                );
              })()}
            </div>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto hide-scrollbar p-4 space-y-3">
            {loading ? (
              <div className="space-y-3 py-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5">
                    <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-2.5 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
                <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mb-3">
                  <Inbox size={20} className="text-gray-300" />
                </div>
                <p className="text-sm font-semibold text-gray-600">
                  {filter === 'new' ? 'No new notifications' : "You're all caught up"}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {filter === 'new' ? 'Everything is read — nice work!' : 'New notifications will appear here.'}
                </p>
              </div>
            ) : (
              <div className="stagger space-y-2">
                {visible.map((n) => {
                  const Icon = n.cfg.icon;
                  return (
                    <div
                      key={n.id}
                      className={`group relative w-full text-left flex items-start gap-4 p-4 rounded-2xl transition-colors duration-150 hover:bg-[#bf4a53]/5 hover:ring-1 hover:ring-[#bf4a53]/10 ${
                        n.isRead ? '' : 'bg-gradient-to-r from-[#bf4a53]/[0.06] to-transparent'
                      }`}
                    >
                      {!n.isRead && (
                        <span className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full bg-[#bf4a53]" />
                      )}
                      <button
                        onClick={() => handleOpen(n)}
                        className="flex-1 min-w-0 flex items-start gap-4 text-left"
                        aria-label={`Open ${n.title}`}
                      >
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${n.cfg.iconBg}`}>
                          <Icon size={16} className={n.cfg.iconColor} />
                        </div>
                        <div className="flex-1 min-w-0 py-0.5">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[13px] font-bold text-gray-900 truncate">{n.title}</p>
                            <span className={`text-[10px] font-bold px-1.5 py-px rounded-full bg-gray-100 text-gray-400 shrink-0 ${n.cfg.iconColor}`}>
                              {n.cfg.chip}
                            </span>
                          </div>
                          <p className="text-[12px] text-gray-500 leading-snug mt-0.5 line-clamp-2">{n.text}</p>
                          <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.time)}</p>
                        </div>
                      </button>
                      <button
                        onClick={() => setConfirmDelete({ mode: 'one', id: n.id, title: n.title })}
                        aria-label={`Delete ${n.title}`}
                        title="Delete"
                        className="absolute top-2 right-2 p-1.5 text-gray-300 group-hover:text-red-600 group-hover:bg-red-50 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-gray-100/70">
            <button
              onClick={onViewAll}
              className="w-full py-2.5 rounded-xl text-[12px] font-bold text-[#bf4a53] hover:bg-[#bf4a53]/5 active:bg-[#bf4a53]/10 transition-colors"
            >
              View all notifications
            </button>
          </div>
        </div>
      )}

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
