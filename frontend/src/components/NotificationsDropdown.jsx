import { useState, useEffect } from 'react';
import {
  Bell, ShoppingBag, CalendarClock, Clock, CheckCircle2,
  AlertTriangle, Smartphone, X, Circle,
} from 'lucide-react';
import { notificationsService } from '../services/notifications';
import { Skeleton } from '../components/Skeleton';

const TYPE_CONFIG = {
  new_booking: { icon: ShoppingBag, iconBg: 'bg-[#bf4a53]/10', iconColor: 'text-[#bf4a53]', chip: 'New Booking' },
  booking_confirmation: { icon: CheckCircle2, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-500', chip: 'Confirmation' },
  due_today: { icon: CalendarClock, iconBg: 'bg-amber-50', iconColor: 'text-amber-500', chip: 'Due Today' },
  overdue: { icon: AlertTriangle, iconBg: 'bg-red-50', iconColor: 'text-red-500', chip: 'Overdue' },
  late_return: { icon: Clock, iconBg: 'bg-orange-50', iconColor: 'text-orange-500', chip: 'Late Return' },
  reminder: { icon: Smartphone, iconBg: 'bg-blue-50', iconColor: 'text-blue-500', chip: 'Reminder' },
  default: { icon: Bell, iconBg: 'bg-gray-100', iconColor: 'text-gray-500', chip: 'Notification' },
};

const timeAgo = (iso) => {
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

export default function NotificationsDropdown({ role, showNotifications, toggle }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [offlineToast, setOfflineToast] = useState(false);

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

  const mapNotification = (n) => {
    const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.default;
    return {
      id: n.id,
      isRead: !!n.isRead,
      type: n.type,
      title: n.title || cfg.chip,
      text: n.message || n.text || '',
      time: n.createdAt,
      cfg,
    };
  };

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

  const allRead = notifications.length > 0 && notifications.every((n) => n.isRead);

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

  const hasNew = unreadCount > 0;

  return (
    <div className="relative">
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
        <div className="absolute right-0 mt-3 w-80 sm:w-96 bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl shadow-gray-200/60 border border-gray-100 animate-in fade-in slide-in-from-top-2 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100/70">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-gray-900 text-sm">Notifications</h3>
              {hasNew && (
                <span className="text-[10px] font-bold text-[#bf4a53] bg-[#bf4a53]/10 px-2 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {hasNew && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-[11px] font-semibold text-gray-400 hover:text-[#bf4a53] px-2 py-1 rounded-full hover:bg-gray-50 transition-colors"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={toggle}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto hide-scrollbar p-3 space-y-1.5">
            {loading ? (
              <div className="space-y-1.5 py-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5">
                    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-2.5 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                  <Bell size={20} className="text-gray-300" />
                </div>
                <p className="text-sm font-semibold text-gray-600">You're all caught up</p>
                <p className="text-xs text-gray-400 mt-1">New notifications will appear here.</p>
              </div>
            ) : (
              <div className="stagger">
                {notifications.map((n) => {
                  const Icon = n.cfg.icon;
                  return (
                    <button
                      key={n.id}
                      onClick={() => !n.isRead && handleMarkRead(n.id)}
                      className={`w-full text-left flex items-start gap-3 p-3 rounded-2xl transition-colors group ${
                        n.isRead ? 'opacity-60 hover:opacity-100 hover:bg-gray-50' : 'bg-gray-50/70 hover:bg-gray-100/70'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${n.cfg.iconBg}`}>
                        <Icon size={17} className={n.cfg.iconColor} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[13px] font-bold text-gray-900 truncate">{n.title}</p>
                          {!n.isRead && <Circle size={7} className="text-[#bf4a53] fill-[#bf4a53] shrink-0" />}
                        </div>
                        <p className="text-[12px] text-gray-500 leading-snug mt-0.5 line-clamp-2">{n.text}</p>
                        <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.time)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {allRead && notifications.length > 0 && (
            <div className="px-5 py-3 border-t border-gray-100/70 text-center">
              <span className="text-[11px] text-gray-400">All caught up</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
