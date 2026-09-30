import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, CheckCheck, CheckCircle2, Clock, Trash2, Inbox, ExternalLink, X, XCircle } from 'lucide-react';
import { notificationsService } from '../services/notifications';
import { transactionsService } from '../services/transactions';
import { Skeleton } from '../components/Skeleton';
import { mapNotification, timeAgo } from '../components/NotificationsDropdown';
import ConfirmModal from '../components/ConfirmModal';

// Admin inbox for customer messages (cancellation requests, questions).
// Reads the signed-in admin's own `customer_message` notifications — the
// contact endpoint fans one out per admin, so this is each admin's
// personal copy (marking read/deleting never affects other admins).
export default function MessagesView({ onOpenBooking }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all' | 'new'
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [detail, setDetail] = useState(null); // message open in the reader
  const [approving, setApproving] = useState(false);
  const [approveResult, setApproveResult] = useState(null); // { ok, text }
  // Handled (done) state per message, persisted locally so it survives reloads.
  const [handled, setHandled] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('rentech_msg_handled') || '[]'));
    } catch {
      return new Set();
    }
  });
  const markHandled = (id, done) => {
    setHandled((prev) => {
      const next = new Set(prev);
      if (done) next.add(id);
      else next.delete(id);
      try {
        localStorage.setItem('rentech_msg_handled', JSON.stringify([...next]));
      } catch { /* private mode */ }
      return next;
    });
  };
  // Live status of the linked booking while the reader is open (unknown when
  // the booking can't be fetched). A booking that's already Cancelled counts
  // as done even if nobody pressed approve here.
  const [bookingStatus, setBookingStatus] = useState(null);
  useEffect(() => {
    if (!detail?.transactionId) {
      setBookingStatus(null);
      return;
    }
    const msgId = detail.id;
    setBookingStatus('loading');
    let live = true;
    transactionsService
      .get(detail.transactionId)
      .then((tx) => {
        if (!live) return;
        const st = tx?.status || 'unknown';
        setBookingStatus(st);
        if (st === 'Cancelled') markHandled(msgId, true);
      })
      .catch(() => { if (live) setBookingStatus('unknown'); });
    return () => { live = false; };
  }, [detail]);

  const load = useCallback(() => {
    setLoading(true);
    notificationsService
      .list({ type: 'customer_message', limit: 200 })
      .then((data) => {
        const items = (Array.isArray(data) ? data : data?.notifications ?? [])
          .map(mapNotification)
          .filter((n) => n.type === 'customer_message');
        setMessages(items);
      })
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleMarkAllRead = async () => {
    const prev = messages;
    setMessages((p) => p.map((n) => ({ ...n, isRead: true })));
    try {
      await Promise.all(prev.filter((n) => !n.isRead).map((n) => notificationsService.markRead(n.id)));
    } catch {
      setMessages(prev);
    }
  };

  const handleOpen = async (n) => {
    if (!n.isRead) {
      const prev = messages;
      setMessages((p) => p.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      try {
        await notificationsService.markRead(n.id);
      } catch {
        setMessages(prev);
      }
    }
    setApproveResult(null);
    setDetail(n);
  };

  // Approve the cancellation the customer asked for, then tell them: the
  // backend notifies the customer in-app + by email on every cancel.
  const handleApprove = async () => {
    if (!detail?.transactionId || approving || approveResult?.ok) return;
    setApproving(true);
    try {
      await transactionsService.cancel(detail.transactionId);
      setMessages((p) => p.map((x) => (x.id === detail.id ? { ...x, isRead: true } : x)));
      markHandled(detail.id, true);
      setApproveResult({ ok: true, text: 'Booking cancelled — the customer was notified in-app and by email.' });
    } catch (err) {
      setApproveResult({ ok: false, text: err?.message || 'Could not cancel the booking.' });
    } finally {
      setApproving(false);
    }
  };

  const handleDelete = async (id) => {
    const prev = messages;
    setMessages((p) => p.filter((n) => n.id !== id));
    try {
      await notificationsService.remove(id);
    } catch {
      setMessages(prev);
    }
  };

  const handleConfirmDelete = () => {
    if (!confirmDelete) return;
    handleDelete(confirmDelete.id);
    setConfirmDelete(null);
  };

  const unread = messages.filter((n) => !n.isRead);
  const visible = filter === 'new' ? unread : messages;

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
                <MessageCircle size={20} />
              </div>
              <div className="min-w-0">
                <h1 className="font-bold text-white text-base leading-tight">Customer Messages</h1>
                <p className="text-xs text-white/80 leading-tight mt-0.5">
                  {unread.length > 0
                    ? `${unread.length} unread · cancellation requests land here`
                    : messages.length > 0
                      ? 'You are all caught up'
                      : 'No messages yet'}
                </p>
              </div>
            </div>
            {unread.length > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold text-white/80 hover:text-white hover:bg-white/15 transition-colors"
              >
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="relative flex items-center gap-1.5 mt-4">
            {[
              { key: 'all', label: 'All', count: messages.length },
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
              {Array.from({ length: 4 }).map((_, i) => (
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
                {filter === 'new' ? 'No new messages' : 'No messages yet'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                When a customer messages the boutique, it appears here.
              </p>
            </div>
          ) : (
            <div className="stagger">
              {visible.map((n) => (
                <div
                  key={n.id}
                  className={`group relative w-full text-left p-4 rounded-2xl transition-colors duration-150 hover:bg-[#bf4a53]/5 hover:ring-1 hover:ring-[#bf4a53]/10 ${
                    n.isRead ? '' : 'bg-gradient-to-r from-[#bf4a53]/[0.06] to-transparent'
                  }`}
                >
                  {!n.isRead && (
                    <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-[#bf4a53]" />
                  )}
                  <button
                    onClick={() => handleOpen(n)}
                    className="w-full min-w-0 flex items-start gap-3 text-left"
                    aria-label={`Open message: ${n.title}`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center shrink-0 shadow-sm">
                      <MessageCircle size={17} />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-[13px] font-bold text-gray-900 break-words">{n.title}</p>
                        {handled.has(n.id) && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-px rounded-full bg-emerald-50 text-emerald-600 shrink-0">
                            <CheckCircle2 size={10} /> Done
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] text-gray-600 leading-snug mt-1 break-words whitespace-pre-wrap">{n.text}</p>
                      <p className="text-[10px] text-gray-400 mt-1.5">{timeAgo(n.time)}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 mt-2.5 ml-[52px]">
                    {n.transactionId && onOpenBooking && (
                      <button
                        onClick={() => handleOpen(n).then(() => onOpenBooking(n.transactionId))}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold text-[#bf4a53] bg-[#bf4a53]/5 hover:bg-[#bf4a53]/10 transition-colors"
                      >
                        <ExternalLink size={12} /> View booking
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmDelete({ id: n.id, title: n.title })}
                      aria-label={`Delete message: ${n.title}`}
                      title="Delete"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm" onClick={() => setDetail(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-message"
            className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
                <MessageCircle size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 id="dialog-title-message" className="font-bold text-gray-900 leading-tight break-words">{detail.title}</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">{timeAgo(detail.time)}</p>
              </div>
              <button onClick={() => setDetail(null)} aria-label="Close message"
                className="text-gray-400 hover:bg-gray-100 rounded-full p-1.5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
                <X size={18} />
              </button>
            </div>

            <div className="bg-gray-50 rounded-2xl p-4 mb-4">
              <p className="text-sm text-gray-700 leading-relaxed break-words whitespace-pre-wrap">{detail.text}</p>
            </div>

            {/* Done / pending state */}
            {(() => {
              const done = handled.has(detail.id);
              if (done) {
                return (
                  <p className="text-sm font-semibold rounded-2xl px-4 py-3 mb-4 flex items-center gap-2 bg-emerald-50 text-emerald-700">
                    <CheckCircle2 size={16} className="shrink-0" /> Done — this message was handled.
                  </p>
                );
              }
              if (detail.transactionId && bookingStatus && bookingStatus !== 'loading' && bookingStatus !== 'unknown') {
                const cancelled = bookingStatus === 'Cancelled';
                return (
                  <p className={`text-sm font-semibold rounded-2xl px-4 py-3 mb-4 flex items-center gap-2 ${cancelled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {cancelled
                      ? <><CheckCircle2 size={16} className="shrink-0" /> Done — booking already {bookingStatus.toLowerCase()}.</>
                      : <><Clock size={16} className="shrink-0" /> Pending — booking is {bookingStatus}.</>}
                  </p>
                );
              }
              return null;
            })()}

            {approveResult && (
              <p className={`text-sm font-semibold rounded-2xl px-4 py-3 mb-4 flex items-start gap-2 ${approveResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                {approveResult.ok
                  ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                  : <XCircle size={16} className="shrink-0 mt-0.5" />}
                {approveResult.text}
              </p>
            )}

            <div className="flex flex-col gap-2.5">
              {detail.transactionId && !approveResult?.ok && bookingStatus !== 'Cancelled' && (
                <button onClick={handleApprove} disabled={approving}
                  className="w-full py-3 font-bold text-sm text-white bg-red-500 hover:bg-red-600 rounded-full transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                  <XCircle size={15} /> {approving ? 'Cancelling…' : 'Approve cancellation'}
                </button>
              )}
              {detail.transactionId && onOpenBooking && (
                <button
                  onClick={() => { const id = detail.transactionId; setDetail(null); onOpenBooking(id); }}
                  className="w-full py-3 font-bold text-sm text-[#bf4a53] bg-[#bf4a53]/5 hover:bg-[#bf4a53]/10 rounded-full transition-colors flex items-center justify-center gap-1.5"
                >
                  <ExternalLink size={14} /> View booking
                </button>
              )}
              <div className="flex gap-2.5">
                <button onClick={() => markHandled(detail.id, !handled.has(detail.id))}
                  className="flex-1 py-3 font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 rounded-full transition-colors">
                  {handled.has(detail.id) ? 'Reopen' : 'Mark done'}
                </button>
                <button onClick={() => setDetail(null)}
                  className="flex-1 py-3 font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 rounded-full transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete message?"
          subtitle={confirmDelete.title}
          message="This message will be permanently removed from your inbox. Other staff keep their own copies."
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
