import { useState, useEffect, useCallback } from 'react';
import { Bell, CheckCheck, Trash2, Inbox } from 'lucide-react';
import { notificationsService } from '../services/notifications';
import { Skeleton } from '../components/Skeleton';
import { mapNotification, timeAgo } from '../components/NotificationsDropdown';
import ConfirmModal from '../components/ConfirmModal';

// Full-page view of every notification (the dropdown only shows the latest 50).
// Same visual language as the dropdown so the two stay consistent.
export default function NotificationsView() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all' | 'new'
  // Delete confirmation: { mode: 'one', id, title } | { mode: 'all' } | null
  const [confirmDelete, setConfirmDelete] = useState(null);

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
  const visible = filter === 'new' ? unread : notifications;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header card */}
      <div className="bg-white rounded-3xl shadow-sm ring-1 ring-black/5 overflow-hidden mb-5">
        <div className="relative px-6 pt-5 pb-4 bg-gradient-to-br from-[#8e323a] via-[#a63f47] to-[#bf4a53] overflow-hidden">
          <div className="absolute -right-8 -top-10 w-36 h-36 rounded-full bg-white/10" />
          <div className="absolute -right-2 top-10 w-20 h-20 rounded-full bg-white/5" />
          <div className="relative flex items-center justify-between gap-3">
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
            <div className="flex items-center gap-1.5 shrink-0">
              {unread.length > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold text-white/80 hover:text-white hover:bg-white/15 transition-colors"
                >
                  <CheckCheck size={14} /> Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={() => setConfirmDelete({ mode: 'all' })}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold text-white/80 hover:text-white hover:bg-white/15 transition-colors"
                >
                  <Trash2 size={14} /> Clear all
                </button>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="relative flex items-center gap-1.5 mt-4">
            {[
              { key: 'all', label: 'All', count: notifications.length },
              { key: 'new', label: 'New', count: unread.length },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold backdrop-blur transition-colors ${
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
          </div>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-3xl shadow-sm ring-1 ring-black/5 overflow-hidden">
        <div className="p-3 space-y-1.5">
          {loading ? (
            <div className="space-y-1.5 py-4">
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
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-3">
                <Inbox size={24} className="text-gray-300" />
              </div>
              <p className="text-sm font-semibold text-gray-600">
                {filter === 'new' ? 'No new notifications' : 'No notifications yet'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {filter === 'new'
                  ? 'Everything is read — nice work!'
                  : 'New notifications will appear here.'}
              </p>
            </div>
          ) : (
            <div className="stagger">
              {visible.map((n) => {
                const Icon = n.cfg.icon;
                return (
                  <div
                    key={n.id}
                    className={`group relative w-full text-left flex items-start gap-3 p-3 rounded-2xl transition-colors ${
                      n.isRead ? 'hover:bg-gray-50' : 'bg-gradient-to-r from-[#bf4a53]/[0.06] to-transparent hover:bg-gray-50/80'
                    }`}
                  >
                    {!n.isRead && (
                      <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-[#bf4a53]" />
                    )}
                    <button
                      onClick={() => !n.isRead && handleMarkRead(n.id)}
                      className="flex-1 min-w-0 flex items-start gap-3 text-left"
                      aria-label={n.isRead ? n.title : `Mark ${n.title} as read`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${n.cfg.iconBg}`}>
                        <Icon size={17} className={n.cfg.iconColor} />
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
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
                      className="p-2 text-gray-300 group-hover:text-red-600 group-hover:bg-red-50 rounded-full transition-colors self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

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
