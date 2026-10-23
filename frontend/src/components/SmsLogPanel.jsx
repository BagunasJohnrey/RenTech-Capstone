import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Search, Send, Bot, User, Trash2, ChevronLeft, ChevronRight, ArrowDownWideNarrow, RotateCw } from 'lucide-react';
import { smsService } from '../services/sms';
import { useAuth } from '../hooks/useAuth';
import { Skeleton } from './Skeleton';
import SmsResultModal from './SmsResultModal';

const PAGE_SIZE = 6;

const fmtTime = (t) => {
  if (!t) return '—';
  try {
    return new Date(t).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return String(t); }
};

// Admin SMS Log: every send in one place — manual (staff-composed, shows
// who sent it) and automatic (scheduler/booking confirmations, sentBy is
// null). Source + status filters answer "did it actually go out?" without
// guessing: only `sent` rows got a provider message_id.
export default function SmsLogPanel() {
  const { role } = useAuth();
  const canDelete = role === 'Admin'; // staff keep read access (audit trail)
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState('all'); // all | manual | auto
  const [status, setStatus] = useState('all'); // all | sent | queued
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest'); // newest | oldest
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState(null); // armed row id
  const [deleteError, setDeleteError] = useState('');
  const [resendingId, setResendingId] = useState(null);
  const [smsResult, setSmsResult] = useState(null); // resend outcome dialog
  const armTimer = useRef(null);
  useEffect(() => () => clearTimeout(armTimer.current), []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await smsService.history({ limit: 200 });
      setRows(Array.isArray(data) ? data : []);
    } catch {
      if (!silent) setRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isAuto = (r) => !r.sentById && !r.sentBy;
  const visible = rows.filter((r) => {
    if (source === 'manual' && isAuto(r)) return false;
    if (source === 'auto' && !isAuto(r)) return false;
    if (status !== 'all' && (r.status || '').toLowerCase() !== status) return false;
    if (query) {
      const hay = `${r.profile?.name || ''} ${r.profile?.phone || ''} ${r.message || ''}`.toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => {
    const t = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    return sort === 'newest' ? -t : t;
  });

  // Reset to page 1 whenever the result set changes shape.
  useEffect(() => { setPage(1); }, [source, status, query, sort, rows.length]);
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const autoCount = rows.filter(isAuto).length;

  // Two-tap admin delete (log cleanup only — the SMS already left Semaphore,
  // deleting never unsends). Staff don't get the button at all.
  const handleDeleteTap = async (id) => {
    if (pendingDelete !== id) {
      setPendingDelete(id);
      setDeleteError('');
      clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setPendingDelete(null), 3000);
      return;
    }
    clearTimeout(armTimer.current);
    setPendingDelete(null);
    try {
      await smsService.remove(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setDeleteError(err?.message || 'Could not delete that row.');
    }
  };

  const handleResend = async (r) => {
    setResendingId(r.id);
    try {
      const res = await smsService.resend(r.id);
      setSmsResult({
        status: res?.status || 'sent',
        to: res?.to || r.profile?.phone,
        message: r.message,
      });
      await load({ silent: true });
    } catch (err) {
      setSmsResult({
        status: 'error',
        to: r.profile?.phone,
        message: r.message,
        error: err?.message || 'Failed to resend SMS.',
      });
    } finally {
      setResendingId(null);
    }
  };

  const chip = (active, onClick, children) => (
    <button key={children} onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
        active ? 'bg-gray-900 text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      }`}>
      {children}
    </button>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chip(source === 'all', () => setSource('all'), `All (${rows.length})`)}
        {chip(source === 'manual', () => setSource('manual'), `Manual (${rows.length - autoCount})`)}
        {chip(source === 'auto', () => setSource('auto'), `Automatic (${autoCount})`)}
        <span className="w-px h-5 bg-gray-200 mx-1" />
        {chip(status === 'all', () => setStatus('all'), 'Any status')}
        {chip(status === 'sent', () => setStatus('sent'), 'Sent')}
        {chip(status === 'queued', () => setStatus('queued'), 'Queued')}
        <button onClick={() => setSort((s) => (s === 'newest' ? 'oldest' : 'newest'))}
          title={sort === 'newest' ? 'Newest first — tap for oldest' : 'Oldest first — tap for newest'}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">
          <ArrowDownWideNarrow size={11} /> {sort === 'newest' ? 'Newest' : 'Oldest'}
        </button>
        <button onClick={() => load()} disabled={loading} title="Refresh"
          className="ml-auto p-2 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="relative mt-3">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, number, or message…"
          className="w-full pl-9 pr-4 py-2.5 text-sm bg-gray-50 border border-gray-100 rounded-2xl focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/20 transition-all placeholder:text-gray-400" />
      </div>

      {deleteError && (
        <p className="mt-2 text-xs font-semibold text-red-500">{deleteError}</p>
      )}

      <div className="mt-3 space-y-1.5">
        {loading ? (
          <div className="space-y-1.5 py-2">
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
          <p className="text-center text-sm text-gray-400 font-medium py-10">
            {rows.length === 0 ? 'No SMS sent yet.' : 'Nothing matches these filters.'}
          </p>
        ) : (
          pageItems.map((r) => {
            const sent = (r.status || '').toLowerCase() === 'sent';
            const auto = isAuto(r);
            return (
              <details key={r.id} className="group p-3.5 rounded-2xl bg-gray-50/70 border border-gray-100 open:bg-white">
                <summary className="flex items-center gap-3 cursor-pointer list-none">
                  <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${auto ? 'bg-violet-50 text-violet-600' : 'bg-blue-50 text-blue-600'}`}
                    title={auto ? 'Automatic (scheduler / booking flow)' : `Manual — sent by ${r.sentBy?.name || 'staff'}`}>
                    {auto ? <Bot size={15} /> : <Send size={14} />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-bold text-gray-900 truncate">{r.profile?.name || 'Unknown'}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-px rounded-full ${sent ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                        {sent ? 'Sent' : (r.status || 'Queued')}
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-px rounded-full bg-gray-100 text-gray-500">
                        {auto ? 'Automatic' : 'Manual'}
                      </span>
                    </span>
                    <span className="block text-xs text-gray-500 truncate mt-0.5">{r.message}</span>
                  </span>
                  {!sent && (
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleResend(r); }}
                      disabled={resendingId === r.id} title="Resend this SMS" aria-label="Resend this SMS"
                      className="shrink-0 p-1.5 rounded-full text-[#bf4a53] hover:bg-[#bf4a53]/10 transition-colors disabled:opacity-50">
                      <RotateCw size={13} className={resendingId === r.id ? 'animate-spin' : ''} />
                    </button>
                  )}
                  <span className="shrink-0 text-[10px] text-gray-400 font-medium tabular-nums">{fmtTime(r.createdAt)}</span>
                </summary>
                <div className="mt-2.5 ml-12 text-[13px] text-gray-700 leading-relaxed break-words whitespace-pre-wrap">{r.message}</div>
                <div className="mt-2 ml-12 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400 font-medium">
                  {r.profile?.phone && <span>{r.profile.phone}</span>}
                  {!auto && r.sentBy?.name && (
                    <span className="inline-flex items-center gap-1"><User size={10} /> {r.sentBy.name}</span>
                  )}
                  <span className="tabular-nums">{fmtTime(r.createdAt)}</span>
                  {(!sent || canDelete) && (
                    <span className="ml-auto inline-flex items-center gap-1">
                      {!sent && (
                        <button onClick={() => handleResend(r)} disabled={resendingId === r.id}
                          title="Send this message again"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] font-bold text-[#bf4a53] hover:bg-[#bf4a53]/10 transition-colors disabled:opacity-50">
                          <RotateCw size={11} className={resendingId === r.id ? 'animate-spin' : ''} />
                          {resendingId === r.id ? 'Sending…' : 'Resend'}
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => handleDeleteTap(r.id)}
                          title={pendingDelete === r.id ? 'Tap again to confirm delete' : 'Delete this log row (admin)'}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] font-bold transition-colors ${
                            pendingDelete === r.id
                              ? 'bg-red-600 text-white'
                              : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                          }`}>
                          <Trash2 size={11} /> {pendingDelete === r.id ? 'Confirm?' : 'Delete'}
                        </button>
                      )}
                    </span>
                  )}
                </div>
              </details>
            );
          })
        )}
      </div>

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 px-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-xs font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft size={14} /> Prev
          </button>
          <span className="text-xs font-bold text-gray-400 tabular-nums">
            Page {safePage} of {totalPages} · {visible.length} found
          </span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-xs font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Resend outcome — sent vs queued vs failed, stated honestly. */}
      {smsResult && <SmsResultModal result={smsResult} onClose={() => setSmsResult(null)} />}
    </div>
  );
}
